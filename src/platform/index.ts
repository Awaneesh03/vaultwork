import { browserVault, isFileSystemAccessSupported } from './browser/browserVault'
import { downloadFileSystem } from './browser/downloadFileSystem'
import { noDesktop } from './browser/noDesktop'
import { noMenu } from './browser/noMenu'
import { nullAi } from './browser/nullAi'
import { unsupportedTelegram } from './browser/unsupportedTelegram'
import { createMemorySnapshotStore, opfsSnapshotStore } from './browser/opfsSnapshotStore'
import { systemClock } from './browser/systemClock'
import { unsupportedVault } from './browser/unsupportedVault'
import { webNotifications } from './browser/webNotifications'
import { deriveCapabilities, type Capabilities } from './capabilities'
import { currentRuntime, isBrowser, isTauri, type RuntimeKind } from './runtime'
import { tauriBridge } from './tauri/bridge'
import { createTauriAi } from './tauri/tauriAi'
import { createTauriDesktop } from './tauri/tauriDesktop'
import { createTauriMenu } from './tauri/tauriMenu'
import { createTauriTelegram } from './tauri/tauriTelegram'
import { createTauriNotifications } from './tauri/tauriNotifications'
import { createTauriVault } from './tauri/tauriVault'
import type {
  AiPort,
  ClockPort,
  FileSystemPort,
  MenuPort,
  TelegramPort,
  NotificationPort,
  SnapshotStore,
  DesktopPort,
  VaultPort,
} from './ports'

export interface Platform {
  runtime: RuntimeKind
  clock: ClockPort
  fileSystem: FileSystemPort
  notifications: NotificationPort
  /** Telegram. Desktop only — a browser tab cannot hold a poll open. */
  telegram: TelegramPort
  ai: AiPort
  snapshots: SnapshotStore
  /** The Obsidian vault, when this build can reach one. */
  vault: VaultPort
  /** The native menu bar. Never fires in a browser. */
  menu: MenuPort
  /** Login items and other OS integration. Inert in a browser. */
  desktop: DesktopPort
  capabilities: Capabilities
}

/**
 * Adapters are resolved once, here, by runtime and capability detection.
 *
 * M13 is the branch this function was written for in M1. Note what did *not*
 * change to add a desktop runtime: no component, no hook, no service, no
 * repository, no schema. The vault the notes feature uses is whichever one this
 * function returns, and it has never known which.
 *
 * The desktop branch is chosen by `currentRuntime()` rather than by feature
 * detection, because in Tauri the browser filesystem API is *also* absent —
 * asking "does `showDirectoryPicker` exist?" would silently fall through to the
 * unsupported adapter on the one runtime with the best filesystem access.
 */
export function resolvePlatform(): Platform {
  const snapshots: SnapshotStore = opfsSnapshotStore.isAvailable
    ? opfsSnapshotStore
    : createMemorySnapshotStore()

  const desktop = isTauri()

  // Chromium has the File System Access API; Firefox and Safari do not, and
  // the honest adapter says so rather than failing somewhere less obvious.
  const browserVaultPort: VaultPort = isFileSystemAccessSupported()
    ? browserVault
    : unsupportedVault

  const vault: VaultPort = desktop ? createTauriVault(tauriBridge) : browserVaultPort
  const notifications: NotificationPort = desktop
    ? createTauriNotifications(tauriBridge)
    : webNotifications
  const menu: MenuPort = desktop ? createTauriMenu(tauriBridge) : noMenu
  const desktopPort: DesktopPort = desktop ? createTauriDesktop(tauriBridge) : noDesktop
  const telegram: TelegramPort = desktop ? createTauriTelegram(tauriBridge) : unsupportedTelegram

  // The provider key lives in the OS keychain and is spent in the native
  // process. A browser bundle cannot hold a secret, so it keeps the inert
  // adapter rather than a half-working one.
  const ai: AiPort = desktop ? createTauriAi(tauriBridge) : nullAi

  const parts = {
    runtime: currentRuntime(),
    clock: systemClock,
    fileSystem: downloadFileSystem,
    notifications,
    telegram,
    ai,
    snapshots,
    vault,
    menu,
    desktop: desktopPort,
  }

  return { ...parts, capabilities: deriveCapabilities(parts) }
}

export const platform: Platform = resolvePlatform()

export { currentRuntime, isBrowser, isTauri }
export type { RuntimeKind } from './runtime'
export type { Capabilities } from './capabilities'
export * from './ports'
export {
  estimateStorage,
  isStoragePersisted,
  requestPersistentStorage,
} from './browser/storagePersistence'
export type { PersistenceStatus, StorageEstimateResult } from './browser/storagePersistence'
export { createMemorySnapshotStore } from './browser/opfsSnapshotStore'
