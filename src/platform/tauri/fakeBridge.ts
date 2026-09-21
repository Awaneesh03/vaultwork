import type {
  BridgeAiCompletion,
  BridgeAiProbe,
  BridgeAiStatus,
  BridgeBotIdentity,
  BridgeConnection,
  BridgeEntry,
  BridgeFailure,
  BridgeIncomingMessage,
  BridgeRuntimeInfo,
  BridgeAiFailure,
  BridgeTelegramFailure,
  BridgeTelegramStatus,
  TauriBridge,
} from './bridge'

/**
 * A stand-in for the native side.
 *
 * The real bridge is four lines of `invoke` per command and nothing else, which
 * makes it the wrong place to look for bugs. The bugs live in the *adapter* —
 * in how a `BridgeFailure` becomes a `VaultError`, in whether `exists` treats
 * a permission problem as absence, in what `disconnect` forgets. This fake
 * exists so all of that can be driven in Node.
 *
 * It deliberately mimics the Rust semantics rather than being permissive: it
 * refuses paths that escape the root, refuses to write when nothing is
 * connected, and rejects with the same `{ kind, message, path }` shape Tauri
 * serialises a `VaultFailure` into. A fake that is kinder than the real thing
 * only proves the tests pass.
 */

export interface FakeBridgeOptions {
  name?: string
  /** Files present before the test starts, keyed by vault-relative path. */
  files?: Record<string, string>
  /** Simulates a folder the user picked in a previous session. */
  remembered?: string | null
  /** What the picker returns; null simulates the user cancelling. */
  picks?: string | null
  notificationsGranted?: boolean
  /** Telegram: a token already in the keychain. */
  telegramToken?: string | null
  telegramAuthorizedChatId?: string | null
  telegramBotUsername?: string | null
  /** AI: a provider key already in the keychain. */
  aiKey?: string | null
  aiModel?: string | null
  /** Defaults to false, as a fresh installation does. */
  aiEnabled?: boolean
  /** What a completion returns, so a test can drive the adapter deterministically. */
  aiReply?: string
}

export interface FakeTauriBridge extends TauriBridge {
  readonly files: Map<string, string>
  readonly directories: Set<string>
  readonly calls: string[]
  /** The notifications this bridge was asked to show. */
  readonly sent: { title: string; body: string | undefined }[]
  /** Fails the next matching call once, with the shape that command rejects with. */
  failNext(
    command: keyof TauriBridge,
    failure: BridgeFailure | BridgeTelegramFailure | BridgeAiFailure,
  ): void
  /** Emits a native menu event to every subscriber. */
  emitMenu(id: string): void
  setPicks(path: string | null): void
  setNotificationsGranted(granted: boolean): void
  /** Writes a file as an external editor would, bypassing the path rules. */
  seed(path: string, contents: string): void
  /** Puts a PDF in the vault, described by the text it extracts to. */
  seedPdf(path: string, text: string): void

  /** Snapshots the renderer has exported, newest last. M18.1. */
  readonly mcpSnapshots: string[]

  // ------------------------------------------------------------- telegram
  /** Messages the bot was asked to deliver, in order. */
  readonly telegramSent: { chatId: string; text: string }[]
  /** Update ids the renderer has acknowledged as durably handled. */
  readonly telegramAcked: string[]
  /** Delivers an update to whoever has subscribed, as the worker would. */
  deliverTelegram(message: Partial<BridgeIncomingMessage> & { text: string }): void
  /** What the keychain currently holds. Tests assert this; the app cannot read it. */
  telegramStoredToken(): string | null
  telegramSetPending(chatId: string | null, name?: string | null): void

  // ------------------------------------------------------------------- ai
  /** The completion requests the provider was asked for, in order. */
  readonly aiRequests: { messages: { role: string; content: string }[]; json: boolean }[]
  /** What the keychain currently holds. Tests assert this; the app cannot read it. */
  aiStoredKey(): string | null
}

function failure(kind: string, message: string, path: string | null = null): BridgeFailure {
  return { kind, message, path }
}

/** The same rules `src-tauri/src/paths.rs` applies, so the fake refuses what Rust refuses. */
function reject(path: string): BridgeFailure | null {
  if (path.trim().length === 0) return failure('invalid-path', 'Refused: the path is empty.', path)
  if (path.includes('\0')) {
    return failure('invalid-path', 'Refused: the path contains a NUL byte.', path)
  }
  if (/%2e%2e/i.test(path)) {
    return failure('invalid-path', 'Refused: percent-encoded traversal.', path)
  }

  const candidate = path.replace(/\\/g, '/')
  if (candidate.startsWith('//')) return failure('invalid-path', 'Refused: a UNC path.', path)
  if (candidate.startsWith('/')) return failure('invalid-path', 'Refused: an absolute path.', path)
  if (/^[A-Za-z]:/.test(candidate)) return failure('invalid-path', 'Refused: a drive letter.', path)
  if (candidate.includes('://')) return failure('invalid-path', 'Refused: a URL.', path)

  for (const segment of candidate.split('/')) {
    if (segment === '') return failure('invalid-path', 'Refused: an empty segment.', path)
    if (segment === '.') return failure('invalid-path', 'Refused: a "." segment.', path)
    if (segment === '..')
      return failure('invalid-path', 'Refused: the path leaves the vault.', path)
  }
  return null
}

export function createFakeTauriBridge(options: FakeBridgeOptions = {}): FakeTauriBridge {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  /** Extracted text per PDF path — the bridge only ever returns text. */
  const pdfTexts = new Map<string, string>()
  /** The login item, as the fake OS has it. Starts off, like a fresh install. */
  let launchAtLogin = false
  const calls: string[] = []
  const sent: { title: string; body: string | undefined }[] = []
  const failures = new Map<string, BridgeFailure | BridgeTelegramFailure | BridgeAiFailure>()
  const menuHandlers = new Set<(id: string) => void>()

  let connected: string | null = null
  // The "keychain". A test can look; the port under test never can.
  // The "keychain", AI half. A test can look; the port under test never can.
  let aiKey: string | null = options.aiKey ?? null
  let aiModel: string = options.aiModel ?? 'fake-model-v1'
  // Off unless a test says otherwise, mirroring `store::AI_ENABLED_BY_DEFAULT`.
  // A fake that is kinder than the real thing only proves the tests pass.
  let aiEnabled: boolean = options.aiEnabled ?? false
  const aiReply: string = options.aiReply ?? '{"ok":true}'
  const aiRequests: { messages: { role: string; content: string }[]; json: boolean }[] = []
  const mcpSnapshots: string[] = []

  let telegramToken: string | null = options.telegramToken ?? null
  let telegramAuthorized: string | null = options.telegramAuthorizedChatId ?? null
  const telegramUsername: string | null = options.telegramBotUsername ?? 'vaultwork_test_bot'
  let telegramRunning = false
  let telegramAutoStart = false
  let telegramPendingId: string | null = null
  let telegramPendingName: string | null = null
  let telegramError: string | null = null
  let telegramUpdateSeq = 0
  const telegramSent: { chatId: string; text: string }[] = []
  const telegramAcked: string[] = []
  const telegramHandlers = new Set<(message: BridgeIncomingMessage) => void>()
  const telegramStatusHandlers = new Set<(status: BridgeTelegramStatus) => void>()

  const telegramStatusNow = (): BridgeTelegramStatus => ({
    configured: telegramToken !== null,
    running: telegramRunning,
    bot_username: telegramToken === null ? null : telegramUsername,
    authorized_chat_id: telegramAuthorized,
    pending_chat_id: telegramPendingId,
    pending_chat_name: telegramPendingName,
    auto_start: telegramAutoStart,
    last_error: telegramError,
    // The fake never touches a real credential store; the count it reports is
    // the number of times a token was handed to it.
    keychain_reads: telegramToken === null ? 0 : 1,
  })

  const announce = () => {
    const status = telegramStatusNow()
    for (const handler of telegramStatusHandlers) handler(status)
  }
  let remembered: string | null = options.remembered ?? null
  let picks: string | null = options.picks ?? options.name ?? 'Vault'
  let granted = options.notificationsGranted ?? true

  const ensureParents = (path: string) => {
    const segments = path.split('/')
    segments.pop()
    let current = ''
    for (const segment of segments) {
      current = current.length === 0 ? segment : `${current}/${segment}`
      directories.add(current)
    }
  }

  for (const [path, contents] of Object.entries(options.files ?? {})) {
    files.set(path, contents)
    ensureParents(path)
  }

  const aiFailure = (kind: string, message: string): BridgeAiFailure => ({ kind, message })

  const aiStatusNow = (): BridgeAiStatus => ({
    configured: aiKey !== null,
    enabled: aiEnabled,
    provider: 'groq',
    model: aiModel,
    last_error: null,
    keychain_reads: 1,
  })

  const record = (
    command: string,
  ): BridgeFailure | BridgeTelegramFailure | BridgeAiFailure | null => {
    calls.push(command)
    const planned = failures.get(command)
    if (planned) {
      failures.delete(command)
      return planned
    }
    return null
  }

  /** Every command runs this: connection first, then the planned failure, then the path. */
  const guard = (
    command: keyof TauriBridge,
    path: string | null,
  ): BridgeFailure | BridgeTelegramFailure | null => {
    const planned = record(command)
    if (planned) return planned
    if (connected === null) {
      return failure('not-connected', 'No Obsidian vault is connected.')
    }
    if (path !== null) return reject(path)
    return null
  }

  return {
    files,
    directories,
    calls,
    sent,

    failNext(command, planned) {
      failures.set(command, planned)
    },

    emitMenu(id) {
      for (const handler of menuHandlers) handler(id)
    },

    setPicks(path) {
      picks = path
    },

    setNotificationsGranted(value) {
      granted = value
    },

    seed(path, contents) {
      files.set(path, contents)
      ensureParents(path)
    },

    seedPdf(path, text) {
      // Listed like any other file so the walk sees it; the stored string
      // stands in for bytes and is never read as text.
      files.set(path, '%PDF-1.4 (test fixture)')
      pdfTexts.set(path, text)
      ensureParents(path)
    },

    async vaultConnect(): Promise<BridgeConnection | null> {
      const planned = record('vaultConnect')
      if (planned) throw planned
      if (picks === null) throw failure('aborted', 'No folder was chosen.')
      connected = picks
      remembered = picks
      return { name: picks, restorable: true }
    },

    async vaultDisconnect() {
      const planned = record('vaultDisconnect')
      if (planned) throw planned
      connected = null
      remembered = null
    },

    async vaultCurrent() {
      record('vaultCurrent')
      return connected === null ? null : { name: connected, restorable: true }
    },

    async vaultRestore() {
      const planned = record('vaultRestore')
      if (planned) throw planned
      if (connected !== null) return { name: connected, restorable: true }
      if (remembered === null) return null
      connected = remembered
      return { name: remembered, restorable: true }
    },

    async vaultPermission() {
      const planned = record('vaultPermission')
      if (planned) throw planned
      if (connected === null) return 'prompt'
      return granted ? 'granted' : 'denied'
    },

    async vaultRead(path) {
      const problem = guard('vaultRead', path)
      if (problem) throw problem
      const contents = files.get(path)
      if (contents === undefined) {
        throw failure('not-found', `“${path}” is not in the vault.`, path)
      }
      return contents
    },

    async vaultWrite(path, contents) {
      const problem = guard('vaultWrite', path)
      if (problem) throw problem
      // Matches `fs::write` after `create_dir_all`: the parent is made, not required.
      ensureParents(path)
      files.set(path, contents)
    },

    async vaultDelete(path) {
      const problem = guard('vaultDelete', path)
      if (problem) throw problem
      if (directories.has(path)) {
        throw failure('invalid-path', `“${path}” is a folder, not a file.`, path)
      }
      if (!files.has(path)) {
        throw failure('not-found', `“${path}” is not in the vault.`, path)
      }
      files.delete(path)
    },

    async vaultExists(path) {
      const problem = guard('vaultExists', path)
      if (problem) throw problem
      return files.has(path)
    },

    async vaultCreateDirectory(path) {
      const problem = guard('vaultCreateDirectory', path)
      if (problem) throw problem
      // Idempotent, like `create_dir_all`.
      ensureParents(`${path}/x`)
      directories.add(path)
    },

    async vaultReadPdfText(path) {
      const problem = guard('vaultReadPdfText', path)
      if (problem) throw problem
      const found = pdfTexts.get(path)
      if (found === undefined) {
        throw failure('not-found', `“${path}” is not in the vault.`, path)
      }
      return {
        text: found,
        chars: found.length,
        empty: found.trim().length === 0,
        truncated: false,
        bytes: Math.max(1024, found.length * 4),
      }
    },

    async vaultList(path) {
      const relative = path ?? ''
      const problem = guard('vaultList', relative.length === 0 ? null : relative)
      if (problem) throw problem

      const prefix = relative.length === 0 ? '' : `${relative}/`
      if (relative.length > 0 && !directories.has(relative)) {
        throw failure('not-found', `“${relative}” is not in the vault.`, relative)
      }

      const seen = new Map<string, BridgeEntry>()
      const consider = (full: string, kind: 'file' | 'directory') => {
        if (!full.startsWith(prefix)) return
        const rest = full.slice(prefix.length)
        if (rest.length === 0) return
        const [head] = rest.split('/')
        if (head === undefined || head.length === 0) return
        const isDirect = rest === head
        const entry: BridgeEntry = {
          name: head,
          path: `${prefix}${head}`,
          kind: isDirect ? kind : 'directory',
        }
        if (!seen.has(head)) seen.set(head, entry)
      }

      for (const full of files.keys()) consider(full, 'file')
      for (const full of directories) consider(full, 'directory')

      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    },

    async desktopLaunchAtLogin() {
      const problem = guard('desktopLaunchAtLogin', null)
      if (problem) throw problem
      return launchAtLogin
    },

    async desktopSetLaunchAtLogin(enabled: boolean) {
      const problem = guard('desktopSetLaunchAtLogin', null)
      if (problem) throw problem
      launchAtLogin = enabled
      // The real command re-reads the OS rather than echoing the request, so
      // the fake returns the stored value for the same reason.
      return launchAtLogin
    },

    async runtimeInfo(): Promise<BridgeRuntimeInfo> {
      record('runtimeInfo')
      return { platform: 'macos', arch: 'aarch64', tauriVersion: '2.0.0', appVersion: '0.13.0' }
    },

    async notificationPermission() {
      const planned = record('notificationPermission')
      if (planned) throw planned
      return granted
    },

    async requestNotificationPermission() {
      const planned = record('requestNotificationPermission')
      if (planned) throw planned
      return granted
    },

    async notify(title, body) {
      const planned = record('notify')
      if (planned) throw planned
      sent.push({ title, body })
    },

    async onMenu(handler) {
      record('onMenu')
      menuHandlers.add(handler)
      return () => menuHandlers.delete(handler)
    },

    // --------------------------------------------------------- telegram

    telegramSent,
    telegramAcked,

    telegramStoredToken() {
      return telegramToken
    },

    telegramSetPending(chatId, name = null) {
      telegramPendingId = chatId
      telegramPendingName = name
      announce()
    },

    deliverTelegram(message) {
      telegramUpdateSeq += 1
      const full: BridgeIncomingMessage = {
        source: 'telegram',
        external_id: message.external_id ?? String(telegramUpdateSeq),
        chat_id: message.chat_id ?? telegramAuthorized ?? '1000',
        sender_id: message.sender_id ?? null,
        text: message.text,
        received_at: message.received_at ?? 1_700_000_000_000,
      }
      for (const handler of telegramHandlers) handler(full)
    },

    async telegramStatus() {
      record('telegramStatus')
      return telegramStatusNow()
    },

    async telegramConfigure(token): Promise<BridgeBotIdentity> {
      const planned = record('telegramConfigure')
      if (planned) throw planned
      // Mirrors the Rust behaviour: a token Telegram rejects is not kept.
      if (token.trim().length === 0 || token === 'invalid') {
        telegramToken = null
        telegramError = 'Telegram rejected the bot token.'
        announce()
        throw { kind: 'invalid-token', message: 'Telegram rejected the bot token.' }
      }
      telegramToken = token
      telegramError = null
      announce()
      return { id: 424242, username: telegramUsername, first_name: 'Vaultwork' }
    },

    async telegramTest(): Promise<BridgeBotIdentity> {
      const planned = record('telegramTest')
      if (planned) throw planned
      if (telegramToken === null) {
        throw { kind: 'not-configured', message: 'No Telegram bot token has been saved.' }
      }
      return { id: 424242, username: telegramUsername, first_name: 'Vaultwork' }
    },

    async telegramStart() {
      const planned = record('telegramStart')
      if (planned) throw planned
      if (telegramToken === null) {
        throw { kind: 'not-configured', message: 'No Telegram bot token has been saved.' }
      }
      telegramRunning = true
      announce()
      return telegramStatusNow()
    },

    async telegramStop() {
      record('telegramStop')
      telegramRunning = false
      announce()
      return telegramStatusNow()
    },

    async telegramAuthorize(chatId) {
      const planned = record('telegramAuthorize')
      if (planned) throw planned
      if (telegramPendingId === null || telegramPendingId !== chatId) {
        throw { kind: 'no-pending-chat', message: 'That chat is not waiting for approval.' }
      }
      telegramAuthorized = chatId
      telegramPendingId = null
      telegramPendingName = null
      announce()
      return telegramStatusNow()
    },

    async telegramDisconnect() {
      record('telegramDisconnect')
      telegramToken = null
      telegramAuthorized = null
      telegramRunning = false
      telegramAutoStart = false
      telegramPendingId = null
      telegramPendingName = null
      telegramError = null
      announce()
      return telegramStatusNow()
    },

    async telegramSetAutoStart(enabled) {
      record('telegramSetAutoStart')
      telegramAutoStart = enabled
      announce()
      return telegramStatusNow()
    },

    async telegramSend(chatId, text) {
      const planned = record('telegramSend')
      if (planned) throw planned
      telegramSent.push({ chatId, text })
    },

    async telegramAck(updateId) {
      const planned = record('telegramAck')
      if (planned) throw planned
      telegramAcked.push(updateId)
    },

    async onTelegramUpdate(handler) {
      record('onTelegramUpdate')
      telegramHandlers.add(handler)
      return () => telegramHandlers.delete(handler)
    },

    async onTelegramStatus(handler) {
      record('onTelegramStatus')
      telegramStatusHandlers.add(handler)
      return () => telegramStatusHandlers.delete(handler)
    },

    // --------------------------------------------------------------- ai
    //
    // Mirrors the Rust semantics rather than being permissive: a completion
    // without a configured key is refused the way `ai.rs` refuses it, and no
    // path returns the key.

    aiRequests,
    aiStoredKey: () => aiKey,

    mcpSnapshots,

    async mcpSnapshotWrite(contents) {
      const planned = record('mcpSnapshotWrite')
      if (planned) throw planned
      // Rust parses before it writes, so a fake that accepted anything would
      // let a broken projection pass a test the real command would reject.
      JSON.parse(contents)
      mcpSnapshots.push(contents)
    },

    async aiStatus(): Promise<BridgeAiStatus> {
      // Honours a planned failure, because `invoke` really can reject here and
      // the adapter's job is to turn that into a displayable status rather than
      // letting it escape into a screen that never finishes loading.
      const planned = record('aiStatus')
      if (planned) throw planned
      return aiStatusNow()
    },

    async aiConfigure(key): Promise<BridgeAiStatus> {
      const planned = record('aiConfigure')
      if (planned) throw planned
      const trimmed = key.trim()
      if (trimmed.length === 0) throw aiFailure('invalid-key', 'The API key is empty.')
      aiKey = trimmed
      return aiStatusNow()
    },

    async aiDisconnect(): Promise<BridgeAiStatus> {
      const planned = record('aiDisconnect')
      if (planned) throw planned
      aiKey = null
      return aiStatusNow()
    },

    async aiSetEnabled(enabled): Promise<BridgeAiStatus> {
      const planned = record('aiSetEnabled')
      if (planned) throw planned
      aiEnabled = enabled
      return aiStatusNow()
    },

    async aiSetModel(model): Promise<BridgeAiStatus> {
      const planned = record('aiSetModel')
      if (planned) throw planned
      const trimmed = model.trim()
      if (trimmed.length === 0 || /\s|\/\//.test(trimmed)) {
        throw aiFailure('protocol', 'That is not a model name.')
      }
      aiModel = trimmed
      return aiStatusNow()
    },

    async aiTest(): Promise<BridgeAiProbe> {
      const planned = record('aiTest')
      if (planned) throw planned
      // Gated in the same order Rust gates it: `ai_test` goes through
      // `complete_with`, which refuses a disabled provider before it looks for
      // a key. A probe is still a paid request.
      if (!aiEnabled) throw aiFailure('disabled', 'The AI provider is switched off.')
      if (aiKey === null) throw aiFailure('not-configured', 'No AI provider key has been saved.')
      return { model: aiModel, text: 'ok' }
    },

    async aiComplete(request): Promise<BridgeAiCompletion> {
      const planned = record('aiComplete')
      if (planned) throw planned
      if (!aiEnabled) throw aiFailure('disabled', 'The AI provider is switched off.')
      if (aiKey === null) throw aiFailure('not-configured', 'No AI provider key has been saved.')
      aiRequests.push({ messages: request.messages, json: request.json })
      return {
        text: aiReply,
        model: aiModel,
        finish_reason: 'stop',
        usage: { input_tokens: 7, output_tokens: 3 },
      }
    },
  }
}
