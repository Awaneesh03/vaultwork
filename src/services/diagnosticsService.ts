import { maintenanceRepo } from '@/repositories'
import { platform, type PersistenceStatus, type RuntimeKind } from '@/platform'
import { getStorageReport } from './storageService'

/**
 * What this build is, where its data is, and whether the browser has promised
 * to keep it.
 *
 * Kept to a developer-facing panel in Settings rather than shown in the normal
 * UI, because none of it helps somebody writing a note. It exists for the one
 * question a local-first app has to be able to answer honestly: *is my data
 * actually safe here?* — and, on desktop, *which runtime am I even in?*
 */
export interface Diagnostics {
  runtime: RuntimeKind
  vaultAdapter: string
  notificationAdapter: string
  database: { name: string; schemaVersion: number; records: number }
  storage: { persistence: PersistenceStatus; usedBytes: number | null; quotaBytes: number | null }
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const [report, counts] = await Promise.all([getStorageReport(), maintenanceRepo.counts()])
  const database = maintenanceRepo.describe()

  const records = Object.values(counts).reduce((total, n) => total + n, 0)

  return {
    runtime: platform.runtime,
    vaultAdapter: platform.vault.id,
    // Named rather than a boolean: "web" versus "tauri" is the difference
    // between a notification that needs a tab open and one that does not.
    notificationAdapter: platform.notifications.isSupported
      ? platform.capabilities.backgroundNotifications
        ? 'os'
        : 'web'
      : 'none',
    database: { ...database, records },
    storage: {
      persistence: report.persistence,
      usedBytes: report.estimate?.usageBytes ?? null,
      quotaBytes: report.estimate?.quotaBytes ?? null,
    },
  }
}

/**
 * Sends the one notification M13 ships.
 *
 * Not a scheduler and not a reminder — those need rules about *when*, which is
 * a later milestone. This proves the port is wired end to end, which is the
 * only claim M13 makes about notifications.
 */
export async function sendTestNotification(): Promise<
  { ok: true; text: string } | { ok: false; text: string }
> {
  if (!platform.notifications.isSupported) {
    return { ok: false, text: 'This build cannot show notifications.' }
  }

  const permission = platform.notifications.permission()
  if (permission === 'denied') {
    return {
      ok: false,
      text: 'Notifications are blocked. Allow them for Vaultwork in your system settings.',
    }
  }

  if (permission !== 'granted') {
    const asked = await platform.notifications.requestPermission()
    if (asked !== 'granted') {
      return { ok: false, text: 'Permission to show notifications was not granted.' }
    }
  }

  await platform.notifications.notify('Vaultwork', 'Desktop notifications are working.')

  return {
    ok: true,
    text: platform.capabilities.backgroundNotifications
      ? 'Sent. It will appear in your notification centre.'
      : 'Sent. In a browser tab this only appears while Vaultwork is open.',
  }
}
