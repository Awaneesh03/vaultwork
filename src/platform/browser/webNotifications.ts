import type { NotificationPort } from '../ports'

/**
 * Web notifications only fire while a tab is open, which for a reminder is
 * close to useless. Real reminders arrive with Tauri (M13); this exists so the
 * seam is real and the UI can report the limitation truthfully.
 */
export const webNotifications: NotificationPort = {
  get isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window
  },

  permission() {
    if (!this.isSupported) return 'denied'
    return Notification.permission
  },

  async requestPermission() {
    if (!this.isSupported) return 'denied'
    try {
      return await Notification.requestPermission()
    } catch {
      return 'denied'
    }
  },

  async notify(title, body) {
    if (!this.isSupported || Notification.permission !== 'granted') return
    new Notification(title, body === undefined ? undefined : { body })
  },
}
