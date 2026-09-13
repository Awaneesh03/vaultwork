import type { DateStr, Timestamp } from '@/types/entities'

/**
 * Ports.
 *
 * Everything outside the application — the clock, the file system, the OS
 * notification centre, an inbound message channel, a model — is reached through
 * an interface declared here. Adapters live in platform/browser (today) and
 * platform/tauri (M13). Nothing else in the codebase asks "am I in Tauri?"; it
 * asks the capability flags instead.
 */

export interface ClockPort {
  now(): Timestamp
  today(): DateStr
}

export interface FileSystemCapabilities {
  canRead: boolean
  canWrite: boolean
  canWatch: boolean
  canChooseFolder: boolean
}

export interface FileSystemPort {
  readonly id: string
  readonly capabilities: FileSystemCapabilities
  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string): Promise<void>
  listDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
}

/**
 * A connected vault directory.
 *
 * Deliberately a *separate* port from `FileSystemPort` rather than an extension
 * of it. The two answer different questions: `FileSystemPort` hands the user a
 * file (a backup download) and is stateless, whereas a vault is a live
 * connection with a handle, a permission grant and a lifecycle. Folding the
 * second into the first would force the download adapter to pretend it can hold
 * a directory, and would conflate "save this file" with "I have standing
 * permission to that folder".
 *
 * Every implementation — the browser's File System Access API today, Tauri in
 * M13 — satisfies exactly this interface, which is the whole reason the notes
 * feature can gain a native backend without a line of its own code changing.
 */
export type VaultPermission = 'granted' | 'prompt' | 'denied' | 'unavailable'

export interface VaultConnection {
  /** The folder's name. Never an absolute path — see VaultPort docs. */
  name: string
  /** Whether the connection can be restored after a reload, on this adapter. */
  restorable: boolean
}

export interface VaultEntry {
  name: string
  /** Vault-relative, always using forward slashes. */
  path: string
  kind: 'file' | 'directory'
}

/**
 * A PDF's text layer, and nothing else.
 *
 * The bytes never cross this port. Extraction happens wherever the file is —
 * natively in Rust on the desktop — and what comes back is bounded text plus
 * the few facts change detection needs. A port that handed back a PDF's bytes
 * would be handing every caller a binary-file reader, which is a much larger
 * capability than "read the text of a document the user imported".
 */
export interface PdfText {
  /** Extracted text, already bounded by the adapter. Never the raw file. */
  text: string
  /** Characters actually returned, after any truncation. */
  chars: number
  /**
   * True when the document yielded no usable text.
   *
   * The ordinary case for a scan or a photographed page. There is no OCR, and
   * this says so rather than leaving a caller to infer it from an empty string.
   */
  empty: boolean
  /** True when the adapter's ceiling cut the text short. */
  truncated: boolean
  /** The file's size on disk. */
  bytes: number
}

/**
 * Desktop integration that belongs to no other port.
 *
 * Currently one setting: whether the operating system opens Vaultwork after
 * login. Deliberately its own port rather than a field on the Telegram one —
 * Telegram auto-start decides what happens once Vaultwork is running, this
 * decides whether it is running at all, and conflating them would make the
 * Settings copy impossible to write honestly.
 */
export interface DesktopPort {
  readonly id: string
  /** False in the browser, where there is no login item to register. */
  readonly isSupported: boolean

  /**
   * Whether Vaultwork opens after login, as the OS currently has it.
   *
   * Asked of the system rather than remembered, so removing the login item in
   * System Settings is reflected here instead of leaving a checkbox that lies.
   */
  launchAtLogin(): Promise<boolean>

  /** Returns the state the OS ended up in, which may differ from the request. */
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
}

export interface VaultPort {
  readonly id: string
  /** False when the environment cannot reach a vault at all. */
  readonly isSupported: boolean

  /** Prompts the user to choose a folder. Must be called from a user gesture. */
  connect(): Promise<VaultConnection>
  /** Forgets the current handle. Does not touch the vault itself. */
  disconnect(): Promise<void>
  /** The connection this runtime currently holds, if any. */
  current(): VaultConnection | null

  /**
   * The live permission state. Asked rather than assumed: a handle can survive
   * a reload while its permission does not, and reporting "connected" on the
   * strength of a handle alone is how a UI lies to its user.
   */
  permission(): Promise<VaultPermission>
  /** Re-prompts. Must be called from a user gesture. */
  requestPermission(): Promise<VaultPermission>

  /** Attempts to restore a previously granted handle. Null when it cannot. */
  restore(): Promise<VaultConnection | null>

  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string): Promise<void>
  deleteFile(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** Idempotent: creating a directory that exists is not an error. */
  createDirectory(path: string): Promise<void>
  /** Immediate children of a directory; the vault root when omitted. */
  listDirectory(path?: string): Promise<VaultEntry[]>

  /**
   * The text layer of a PDF inside the vault.
   *
   * Separate from `readFile` because a PDF is not text on disk: `readFile`
   * returns a string and would hand back mojibake for a binary file. Adapters
   * that cannot parse PDFs say so with an `unsupported` VaultError rather than
   * returning an empty document, so "this runtime cannot read PDFs" and "this
   * PDF has no text" stay distinguishable.
   */
  readPdfText(path: string): Promise<PdfText>
}

/** Vault failures a user can be told about, rather than a raw DOMException. */
export type VaultErrorKind =
  | 'unsupported'
  | 'not-connected'
  | 'permission-denied'
  | 'not-found'
  | 'invalid-path'
  | 'write-failed'
  | 'read-failed'
  | 'aborted'

export class VaultError extends Error {
  readonly kind: VaultErrorKind
  readonly path: string | null

  constructor(kind: VaultErrorKind, message: string, path: string | null = null) {
    super(message)
    this.name = 'VaultError'
    this.kind = kind
    this.path = path
  }
}

export interface NotificationPort {
  readonly isSupported: boolean
  permission(): 'granted' | 'denied' | 'default'
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  notify(title: string, body?: string): Promise<void>
}

/**
 * Telegram, as the application sees it.
 *
 * This replaces M1's speculative `MessagePort`. That port had the renderer
 * calling `poll()` and `ack()`, which M14 cannot use: a long-polling loop must
 * live in the native process, not in React, so updates *arrive* rather than
 * being fetched. The shape below is the one the real integration needed.
 *
 * Note what is not on it. There is no `getToken`, and `configure` returns the
 * bot's identity rather than an echo of what it was given — the token goes to
 * the OS credential store inside the adapter and no caller can read it back.
 * There is also no `sendRequest`: the adapter exposes the three operations M14
 * performs and nothing else, so this port cannot become a general-purpose
 * network client.
 */
export interface TelegramBotIdentity {
  id: number
  username: string | null
  firstName: string | null
}

export interface TelegramStatus {
  /** A token is saved in the OS credential store. */
  configured: boolean
  /** The polling worker is alive. */
  running: boolean
  botUsername: string | null
  /** The single chat allowed to drive this installation. */
  authorizedChatId: string | null
  /** A chat that has written in but has not been approved. */
  pendingChatId: string | null
  pendingChatName: string | null
  autoStart: boolean
  lastError: string | null
  /**
   * How many times this process has read the OS credential store.
   *
   * A diagnostic, because each read is a potential authorization prompt. The
   * healthy number is small and *constant*: one when the application decides
   * whether a token exists, one when a worker session starts. If it climbs
   * with traffic, something is reading the token per request again.
   */
  keychainReads: number
}

/** Telegram's own message identity, normalised at the adapter boundary. */
export interface IncomingTelegramMessage {
  source: 'telegram'
  /** Telegram's `update_id`. The deduplication identity. */
  externalId: string
  chatId: string
  senderId: string | null
  text: string
  receivedAt: Timestamp
}

export type TelegramErrorKind =
  | 'unsupported'
  | 'not-configured'
  | 'invalid-token'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'keychain'
  | 'protocol'
  | 'no-pending-chat'
  | 'api'

export class TelegramError extends Error {
  readonly kind: TelegramErrorKind

  constructor(kind: TelegramErrorKind, message: string) {
    super(message)
    this.name = 'TelegramError'
    this.kind = kind
  }
}

export interface TelegramPort {
  readonly id: string
  /** False in a browser, which cannot hold a polling loop open. */
  readonly isSupported: boolean

  status(): Promise<TelegramStatus>
  /** Saves a token and proves it works. Never returns the token. */
  configure(token: string): Promise<TelegramBotIdentity>
  /** Asks Telegram who this bot is. */
  test(): Promise<TelegramBotIdentity>

  start(): Promise<TelegramStatus>
  stop(): Promise<TelegramStatus>
  /** Approves the chat currently waiting. Explicit, never automatic. */
  authorize(chatId: string): Promise<TelegramStatus>
  /** Forgets the token and the authorization. Touches no application data. */
  disconnect(): Promise<TelegramStatus>
  setAutoStart(enabled: boolean): Promise<TelegramStatus>

  sendMessage(chatId: string, text: string): Promise<void>
  /**
   * Confirms an update is durably handled, so the cursor may move past it.
   * Called only after the mutation *and* the message log have committed.
   */
  ack(externalId: string): Promise<void>

  /** Incoming messages. Resolves to an unsubscribe function. */
  subscribe(handler: (message: IncomingTelegramMessage) => void): Promise<() => void>
  /** Status changes pushed from the worker. */
  subscribeStatus(handler: (status: TelegramStatus) => void): Promise<() => void>
}

/*
 * The model.
 *
 * Everything here is provider-agnostic on purpose: there is no Groq concept in
 * this file, and no other layer names one. Swapping provider is meant to be a
 * new adapter in platform/tauri plus a constant in Rust — not a change to the
 * application.
 *
 * Note what a request cannot say. There is no url, no host, no header, no api
 * key and no model: the destination and the credential are decided natively,
 * where the renderer cannot reach them. A caller supplies content and nothing
 * that could redirect the request or change who pays for it.
 */

export type AiRole = 'system' | 'user' | 'assistant'

export interface AiMessage {
  role: AiRole
  content: string
}

export interface AiCompletionRequest {
  messages: AiMessage[]
  /**
   * Ask the provider to answer with a single JSON object rather than prose.
   *
   * The later M15 phases depend on structured output; this is the switch that
   * makes it the provider's job rather than a regex over prose.
   */
  json?: boolean
  maxOutputTokens?: number
  temperature?: number
}

/** Why the provider stopped. Normalised, so no provider vocabulary leaks up. */
export type AiFinishReason = 'stop' | 'length' | 'filter' | 'other'

export interface AiUsage {
  inputTokens: number
  outputTokens: number
}

export interface AiCompletionResult {
  text: string
  /** The model that actually answered, as the provider reported it. */
  model: string
  finishReason: AiFinishReason
  usage: AiUsage | null
}

/** What the UI is allowed to know. Note the absence of any credential field. */
export interface AiStatus {
  /** A key is in the OS credential store. */
  configured: boolean
  /** The user has not switched the provider off. */
  enabled: boolean
  provider: string
  model: string
  lastError: string | null
  /**
   * How many times this process has read the OS credential store.
   *
   * The same diagnostic `TelegramStatus` carries, for the same reason: each
   * read is a potential authorization prompt, and the healthy number is small
   * and constant. If it climbs with traffic, something is reading the key per
   * request again.
   */
  keychainReads: number
}

/** The answer to "does this key work?", with nothing sensitive in it. */
export interface AiProbe {
  model: string
  text: string
}

/*
 * Two families, deliberately in one union.
 *
 * The first ten are *transport* failures: the native side could not reach the
 * provider, or the provider refused. Those are the only kinds Rust emits, and
 * `tauriAi` accepts no others across the bridge.
 *
 * The last three are *interpretation* failures, raised in `src/ai` when a
 * response arrives intact but says something this application will not accept.
 * They share the union because a caller handles one `AiError`, and they are
 * kept out of the bridge's accepted set so the native side cannot claim one.
 */
export type AiErrorKind =
  | 'unsupported'
  | 'not-configured'
  | 'disabled'
  | 'invalid-key'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'keychain'
  | 'protocol'
  | 'api'
  /** The reply did not satisfy the response contract. */
  | 'invalid-response'
  /** A well-formed action outside the allowlist. */
  | 'unsupported-intent'
  /** A reference this application will not accept — an id, most of all. */
  | 'invalid-reference'

export class AiError extends Error {
  readonly kind: AiErrorKind

  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

export interface AiPort {
  readonly id: string
  /**
   * Whether this runtime can reach a provider at all.
   *
   * A *build* property, not a configuration one — false in a browser, which
   * cannot hold a credential, because anything in the bundle is public.
   * Whether a key has actually been saved is `status().configured`.
   */
  readonly isAvailable: boolean

  status(): Promise<AiStatus>
  /** Saves a key to the OS credential store. Never returns it. */
  configure(apiKey: string): Promise<AiStatus>
  /** Forgets the key. Touches no application data. */
  disconnect(): Promise<AiStatus>
  setEnabled(enabled: boolean): Promise<AiStatus>
  setModel(model: string): Promise<AiStatus>
  /** The smallest round trip that proves the credential works. */
  test(): Promise<AiProbe>
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>
}

export interface SnapshotMeta {
  id: string
  createdAt: Timestamp
  bytes: number
}

export interface SnapshotStore {
  readonly id: string
  readonly isAvailable: boolean
  save(id: string, contents: string): Promise<void>
  read(id: string): Promise<string>
  list(): Promise<SnapshotMeta[]>
  remove(id: string): Promise<void>
}

/**
 * The native application menu.
 *
 * A port rather than a Tauri detail, so the shell can subscribe unconditionally
 * and the browser build simply never receives an action. The actions are a
 * closed union: a menu item that does not correspond to something the
 * application can already do has no business existing.
 */
export const MENU_ACTIONS = [
  'settings',
  'new-task',
  'new-note',
  'export',
  'import',
  'undo',
  'go-dashboard',
  'go-tasks',
  'go-calendar',
  'go-notes',
] as const

export type MenuAction = (typeof MENU_ACTIONS)[number]

const MENU_ACTION_SET: ReadonlySet<string> = new Set<string>(MENU_ACTIONS)

export function isMenuAction(value: string): value is MenuAction {
  return MENU_ACTION_SET.has(value)
}

export interface MenuPort {
  readonly isSupported: boolean
  /** Subscribes to native menu clicks. Resolves to an unsubscribe function. */
  subscribe(handler: (action: MenuAction) => void): Promise<() => void>
}

export class PortNotSupportedError extends Error {
  constructor(port: string, operation: string) {
    super(`${port} does not support ${operation} in this environment`)
    this.name = 'PortNotSupportedError'
  }
}
