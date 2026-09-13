import type {
  AiPort,
  FileSystemPort,
  MenuPort,
  TelegramPort,
  NotificationPort,
  SnapshotStore,
  VaultPort,
} from './ports'
import { isTauri } from './runtime'

/**
 * What this build can actually do. Components ask these questions — never
 * "am I running in Tauri?" — which is why adding the Tauri adapters in M13
 * changed no UI code, only what these flags report.
 */
export interface Capabilities {
  readVault: boolean
  writeVault: boolean
  watchVault: boolean
  receiveMessages: boolean
  backgroundNotifications: boolean
  nativeMenu: boolean
  ai: boolean
  snapshots: boolean
  isDesktop: boolean
}

export { isTauri }

export function deriveCapabilities(parts: {
  fileSystem: FileSystemPort
  telegram: TelegramPort
  ai: AiPort
  snapshots: SnapshotStore
  notifications: NotificationPort
  vault: VaultPort
  menu: MenuPort
}): Capabilities {
  const desktop = isTauri()
  return {
    // These describe the *vault*, so they come from the vault port rather than
    // the download port that happens to share the word "file".
    readVault: parts.vault.isSupported,
    writeVault: parts.vault.isSupported,
    // Still false on desktop: M13 gives Vaultwork native filesystem *access*,
    // not a file watcher. Detecting external edits remains M11's explicit
    // rescan, which is a deliberate choice — see the M11 sync philosophy —
    // rather than something M13 quietly left out.
    watchVault: false,
    receiveMessages: parts.telegram.isSupported,
    // A web notification only fires while a tab is open, which does not count.
    backgroundNotifications: desktop && parts.notifications.isSupported,
    nativeMenu: parts.menu.isSupported,
    ai: parts.ai.isAvailable,
    snapshots: parts.snapshots.isAvailable,
    isDesktop: desktop,
  }
}
