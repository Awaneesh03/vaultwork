import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

/**
 * The one file in Vaultwork that imports a Tauri API.
 *
 * Everything else — components, features, hooks, services, the knowledge layer,
 * the Obsidian sync logic — reaches the desktop runtime through the ports it
 * already used in the browser. That is enforced by `tests/architecture.test.ts`
 * and by ESLint, not by convention: exactly one module may name
 * `@tauri-apps/*`, and this is it.
 *
 * Two consequences worth stating:
 *
 *  - The adapters in this folder take a bridge *object* rather than importing
 *    `invoke` themselves, so `tauriVault.ts` and `tauriNotifications.ts` are
 *    plain TypeScript that can be unit-tested in Node against a fake. The
 *    untestable part — the IPC call itself — is confined to the functions
 *    below, which contain no logic to get wrong.
 *
 *  - The command surface is closed. There is no `invokeAny(command, args)`
 *    here, because a generic escape hatch would make the Rust allow-list
 *    decorative.
 */

/** Mirrors `VaultConnectionDto` in `src-tauri/src/vault.rs`. */
export interface BridgeConnection {
  name: string
  restorable: boolean
}

/** Mirrors `VaultEntryDto`. */
export interface BridgePdfText {
  text: string
  chars: number
  empty: boolean
  truncated: boolean
  bytes: number
}

export interface BridgeEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
}

/** Mirrors `BotIdentity` in `src-tauri/src/telegram.rs`. Never carries a token. */
export interface BridgeBotIdentity {
  id: number
  username: string | null
  first_name: string | null
}

/** Mirrors `TelegramStatus`. Note the absence of any token field. */
export interface BridgeTelegramStatus {
  configured: boolean
  running: boolean
  bot_username: string | null
  authorized_chat_id: string | null
  pending_chat_id: string | null
  pending_chat_name: string | null
  auto_start: boolean
  last_error: string | null
  keychain_reads: number
}

/** Mirrors `IncomingMessage` — already normalised on the Rust side. */
export interface BridgeIncomingMessage {
  source: 'telegram'
  external_id: string
  chat_id: string
  sender_id: string | null
  text: string
  received_at: number
}

/** Mirrors `TelegramError`. */
export interface BridgeTelegramFailure {
  kind: string
  message: string
}

/** Mirrors `AiStatus` in `src-tauri/src/ai.rs`. Note the absence of any key field. */
export interface BridgeAiStatus {
  configured: boolean
  enabled: boolean
  provider: string
  model: string
  last_error: string | null
  keychain_reads: number
}

/** Mirrors `CompletionRequest`. Carries no url, host, header, key or model. */
export interface BridgeAiRequest {
  messages: { role: string; content: string }[]
  json: boolean
  max_output_tokens: number | null
  temperature: number | null
}

/** Mirrors `CompletionResult` — already normalised on the Rust side. */
export interface BridgeAiCompletion {
  text: string
  model: string
  finish_reason: string
  usage: { input_tokens: number; output_tokens: number } | null
}

/** Mirrors `AiProbe`. */
export interface BridgeAiProbe {
  model: string
  text: string
}

/** Mirrors `AiError`. */
export interface BridgeAiFailure {
  kind: string
  message: string
}

/** Mirrors `VaultFailure`. Rejected promises carry this shape, not a string. */
export interface BridgeFailure {
  kind: string
  message: string
  path: string | null
}

export interface BridgeRuntimeInfo {
  platform: string
  arch: string
  tauriVersion: string
  appVersion: string
}

/**
 * What the Tauri adapters are allowed to ask the native side for.
 *
 * Named as an interface so the adapters depend on the *contract* rather than on
 * `invoke`, which is what makes them testable without a running desktop app.
 */
export interface TauriBridge {
  vaultConnect(): Promise<BridgeConnection | null>
  vaultDisconnect(): Promise<void>
  vaultCurrent(): Promise<BridgeConnection | null>
  vaultRestore(): Promise<BridgeConnection | null>
  vaultPermission(): Promise<string>
  vaultRead(path: string): Promise<string>
  vaultWrite(path: string, contents: string): Promise<void>
  vaultDelete(path: string): Promise<void>
  vaultExists(path: string): Promise<boolean>
  vaultCreateDirectory(path: string): Promise<void>
  vaultList(path: string | undefined): Promise<BridgeEntry[]>
  /** Text from one PDF. Bytes stay in the native process. */
  vaultReadPdfText(path: string): Promise<BridgePdfText>
  runtimeInfo(): Promise<BridgeRuntimeInfo>

  /** Launch at login. Reads and writes the real macOS login item. */
  desktopLaunchAtLogin(): Promise<boolean>
  desktopSetLaunchAtLogin(enabled: boolean): Promise<boolean>

  notificationPermission(): Promise<boolean>
  requestNotificationPermission(): Promise<boolean>
  notify(title: string, body: string | undefined): Promise<void>

  /** Menu clicks from the native menu bar. Returns an unsubscribe function. */
  onMenu(handler: (id: string) => void): Promise<() => void>

  /*
   * Telegram.
   *
   * Note what is missing: there is no `telegramGetToken`, because the Rust side
   * exposes no such command. `telegramConfigure` sends a token *in* and gets an
   * identity back; nothing sends one out. There is also no `httpRequest` — the
   * three operations M14 performs are named, and the host they talk to is a
   * constant in Rust that the renderer cannot influence.
   */
  telegramStatus(): Promise<BridgeTelegramStatus>
  telegramConfigure(token: string): Promise<BridgeBotIdentity>
  telegramTest(): Promise<BridgeBotIdentity>
  telegramStart(): Promise<BridgeTelegramStatus>
  telegramStop(): Promise<BridgeTelegramStatus>
  telegramAuthorize(chatId: string): Promise<BridgeTelegramStatus>
  telegramDisconnect(): Promise<BridgeTelegramStatus>
  telegramSetAutoStart(enabled: boolean): Promise<BridgeTelegramStatus>
  telegramSend(chatId: string, text: string): Promise<void>
  telegramAck(updateId: string): Promise<void>
  onTelegramUpdate(handler: (message: BridgeIncomingMessage) => void): Promise<() => void>
  onTelegramStatus(handler: (status: BridgeTelegramStatus) => void): Promise<() => void>

  /*
   * The AI provider (M15.1).
   *
   * The same closed shape as Telegram, for the same reasons. There is no
   * `aiGetKey`, because the Rust side exposes no such command. `aiConfigure`
   * sends a key *in* and gets a status back; nothing sends one out. And
   * `aiComplete` carries messages only — the host, the endpoint and the
   * credential are all decided natively, so the renderer cannot redirect a
   * request or discover what pays for it.
   */
  aiStatus(): Promise<BridgeAiStatus>
  aiConfigure(key: string): Promise<BridgeAiStatus>
  aiDisconnect(): Promise<BridgeAiStatus>
  aiSetEnabled(enabled: boolean): Promise<BridgeAiStatus>
  aiSetModel(model: string): Promise<BridgeAiStatus>
  aiTest(): Promise<BridgeAiProbe>
  aiComplete(request: BridgeAiRequest): Promise<BridgeAiCompletion>
}

/** The event `src-tauri/src/menu.rs` emits. Kept in step by name, deliberately. */
export const MENU_EVENT = 'vaultwork://menu'
/** The events `src-tauri/src/telegram.rs` emits. */
export const TELEGRAM_UPDATE_EVENT = 'vaultwork://telegram-update'
export const TELEGRAM_STATUS_EVENT = 'vaultwork://telegram-status'

interface RawRuntimeInfo {
  platform: string
  arch: string
  tauri_version: string
  app_version: string
}

export const tauriBridge: TauriBridge = {
  vaultConnect: () => invoke<BridgeConnection | null>('vault_connect'),
  vaultDisconnect: () => invoke<void>('vault_disconnect'),
  vaultCurrent: () => invoke<BridgeConnection | null>('vault_current'),
  vaultRestore: () => invoke<BridgeConnection | null>('vault_restore'),
  vaultPermission: () => invoke<string>('vault_permission'),
  vaultRead: (path) => invoke<string>('vault_read', { path }),
  vaultWrite: (path, contents) => invoke<void>('vault_write', { path, contents }),
  vaultDelete: (path) => invoke<void>('vault_delete', { path }),
  vaultExists: (path) => invoke<boolean>('vault_exists', { path }),
  vaultCreateDirectory: (path) => invoke<void>('vault_create_dir', { path }),
  vaultList: (path) => invoke<BridgeEntry[]>('vault_list', { path: path ?? null }),
  vaultReadPdfText: (path) => invoke<BridgePdfText>('vault_read_pdf_text', { path }),

  desktopLaunchAtLogin: () => invoke<boolean>('desktop_launch_at_login'),
  desktopSetLaunchAtLogin: (enabled) => invoke<boolean>('desktop_set_launch_at_login', { enabled }),

  async runtimeInfo() {
    const raw = await invoke<RawRuntimeInfo>('runtime_info')
    return {
      platform: raw.platform,
      arch: raw.arch,
      tauriVersion: raw.tauri_version,
      appVersion: raw.app_version,
    }
  },

  notificationPermission: () => isPermissionGranted(),

  async requestNotificationPermission() {
    return (await requestPermission()) === 'granted'
  },

  async notify(title, body) {
    sendNotification(body === undefined ? { title } : { title, body })
  },

  async onMenu(handler) {
    const unlisten: UnlistenFn = await listen<string>(MENU_EVENT, (event) => {
      handler(event.payload)
    })
    return unlisten
  },

  telegramStatus: () => invoke<BridgeTelegramStatus>('telegram_status'),
  telegramConfigure: (token) => invoke<BridgeBotIdentity>('telegram_configure', { token }),
  telegramTest: () => invoke<BridgeBotIdentity>('telegram_test'),
  telegramStart: () => invoke<BridgeTelegramStatus>('telegram_start'),
  telegramStop: () => invoke<BridgeTelegramStatus>('telegram_stop'),
  telegramAuthorize: (chatId) => invoke<BridgeTelegramStatus>('telegram_authorize', { chatId }),
  telegramDisconnect: () => invoke<BridgeTelegramStatus>('telegram_disconnect'),
  telegramSetAutoStart: (enabled) =>
    invoke<BridgeTelegramStatus>('telegram_set_auto_start', { enabled }),
  telegramSend: (chatId, text) => invoke<void>('telegram_send', { chatId, text }),
  telegramAck: (updateId) => invoke<void>('telegram_ack', { updateId }),

  async onTelegramUpdate(handler) {
    const unlisten: UnlistenFn = await listen<BridgeIncomingMessage>(
      TELEGRAM_UPDATE_EVENT,
      (event) => handler(event.payload),
    )
    return unlisten
  },

  async onTelegramStatus(handler) {
    const unlisten: UnlistenFn = await listen<BridgeTelegramStatus>(
      TELEGRAM_STATUS_EVENT,
      (event) => handler(event.payload),
    )
    return unlisten
  },

  aiStatus: () => invoke<BridgeAiStatus>('ai_status'),
  aiConfigure: (key) => invoke<BridgeAiStatus>('ai_configure', { key }),
  aiDisconnect: () => invoke<BridgeAiStatus>('ai_disconnect'),
  aiSetEnabled: (enabled) => invoke<BridgeAiStatus>('ai_set_enabled', { enabled }),
  aiSetModel: (model) => invoke<BridgeAiStatus>('ai_set_model', { model }),
  aiTest: () => invoke<BridgeAiProbe>('ai_test'),
  aiComplete: (request) => invoke<BridgeAiCompletion>('ai_complete', { request }),
}
