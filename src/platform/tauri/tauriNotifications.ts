import type { NotificationPort } from '../ports'
import type { TauriBridge } from './bridge'

/**
 * OS notifications.
 *
 * The difference from the web adapter is not the API — it is that these arrive
 * when the window is closed. A web `Notification` only fires while a tab is
 * open, which for a reminder is close to useless; this is the reason
 * `capabilities.backgroundNotifications` has been reporting `false` since M1
 * and can now report the truth on desktop.
 *
 * The permission state is cached because the port declares `permission()`
 * synchronous (the web `Notification.permission` is a property) while the Tauri
 * plugin's is a promise. The cache is primed by `prime()` at start-up and
 * refreshed by `requestPermission()`, so the only way it can be stale is if the
 * user changes the setting in System Settings mid-session — in which case the
 * send itself still asks before giving up, and simply does nothing.
 */
export function createTauriNotifications(bridge: TauriBridge): NotificationPort & {
  prime(): Promise<void>
} {
  let granted: boolean | null = null

  const refresh = async (): Promise<boolean> => {
    try {
      granted = await bridge.notificationPermission()
    } catch {
      granted = false
    }
    return granted
  }

  return {
    isSupported: true,

    permission() {
      // `default` rather than `denied` while unknown: the user has not been
      // asked yet, and reporting a refusal they never gave would hide the
      // button that asks.
      if (granted === null) return 'default'
      return granted ? 'granted' : 'denied'
    },

    async requestPermission() {
      try {
        granted = await bridge.requestNotificationPermission()
        return granted ? 'granted' : 'denied'
      } catch {
        granted = false
        return 'denied'
      }
    },

    async notify(title, body) {
      const allowed = granted ?? (await refresh())
      if (!allowed) {
        // Asking once, on the send, is what makes "Test notification" work on a
        // first run without a separate "enable notifications" step.
        const asked = await this.requestPermission()
        if (asked !== 'granted') return
      }

      try {
        await bridge.notify(title, body)
      } catch {
        // A notification that fails to display is not worth interrupting the
        // user with a second failure about.
      }
    },

    /** Reads the current grant once, at start-up. */
    async prime() {
      await refresh()
    },
  }
}
