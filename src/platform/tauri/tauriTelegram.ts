import {
  TelegramError,
  type IncomingTelegramMessage,
  type TelegramBotIdentity,
  type TelegramErrorKind,
  type TelegramPort,
  type TelegramStatus,
} from '../ports'
import type {
  BridgeBotIdentity,
  BridgeIncomingMessage,
  BridgeTelegramStatus,
  TauriBridge,
} from './bridge'

/**
 * The desktop Telegram adapter.
 *
 * Thin on purpose. The polling loop, the Bot API and the bot token all live in
 * Rust; this translates between the bridge's snake_case DTOs and the port's
 * vocabulary, and turns native failures into `TelegramError` so the UI never
 * sees a raw string from the network.
 *
 * The one thing it cannot do is read the token. There is no bridge command that
 * returns it, so there is nothing here to forget to leave out.
 */

const KINDS: ReadonlySet<string> = new Set<TelegramErrorKind>([
  'unsupported',
  'not-configured',
  'invalid-token',
  'rate-limited',
  'network',
  'timeout',
  'keychain',
  'protocol',
  'no-pending-chat',
  'api',
])

function toTelegramError(error: unknown, fallback: TelegramErrorKind): TelegramError {
  if (error instanceof TelegramError) return error

  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const raw = error as { kind: unknown; message?: unknown }
    const kind =
      typeof raw.kind === 'string' && KINDS.has(raw.kind)
        ? (raw.kind as TelegramErrorKind)
        : fallback
    const message =
      typeof raw.message === 'string' && raw.message.length > 0
        ? raw.message
        : 'Telegram could not complete that request.'
    return new TelegramError(kind, message)
  }

  // Deliberately not `String(error)`: an unexpected native failure could carry
  // a URL, and the URL contains the bot token.
  return new TelegramError(fallback, 'Telegram could not complete that request.')
}

const toStatus = (raw: BridgeTelegramStatus): TelegramStatus => ({
  configured: raw.configured,
  running: raw.running,
  botUsername: raw.bot_username,
  authorizedChatId: raw.authorized_chat_id,
  pendingChatId: raw.pending_chat_id,
  pendingChatName: raw.pending_chat_name,
  autoStart: raw.auto_start,
  lastError: raw.last_error,
  keychainReads: raw.keychain_reads,
})

const toIdentity = (raw: BridgeBotIdentity): TelegramBotIdentity => ({
  id: raw.id,
  username: raw.username,
  firstName: raw.first_name,
})

const toMessage = (raw: BridgeIncomingMessage): IncomingTelegramMessage => ({
  source: 'telegram',
  externalId: raw.external_id,
  chatId: raw.chat_id,
  senderId: raw.sender_id,
  text: raw.text,
  receivedAt: raw.received_at,
})

export function createTauriTelegram(bridge: TauriBridge): TelegramPort {
  const guard = async <T>(
    run: () => Promise<T>,
    fallback: TelegramErrorKind,
  ): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      throw toTelegramError(error, fallback)
    }
  }

  return {
    id: 'telegram-tauri',
    isSupported: true,

    async status() {
      try {
        return toStatus(await bridge.telegramStatus())
      } catch {
        // Reading status must never throw: Settings calls it on mount, and a
        // momentary failure should show as "not configured", not a crash.
        return {
          configured: false,
          running: false,
          botUsername: null,
          authorizedChatId: null,
          pendingChatId: null,
          pendingChatName: null,
          autoStart: false,
          lastError: 'Could not read the Telegram status.',
          keychainReads: 0,
        }
      }
    },

    configure: (token) =>
      guard(async () => toIdentity(await bridge.telegramConfigure(token)), 'invalid-token'),
    test: () => guard(async () => toIdentity(await bridge.telegramTest()), 'network'),
    start: () => guard(async () => toStatus(await bridge.telegramStart()), 'not-configured'),
    stop: () => guard(async () => toStatus(await bridge.telegramStop()), 'api'),
    authorize: (chatId) =>
      guard(async () => toStatus(await bridge.telegramAuthorize(chatId)), 'no-pending-chat'),
    disconnect: () => guard(async () => toStatus(await bridge.telegramDisconnect()), 'keychain'),
    setAutoStart: (enabled) =>
      guard(async () => toStatus(await bridge.telegramSetAutoStart(enabled)), 'api'),
    sendMessage: (chatId, text) => guard(() => bridge.telegramSend(chatId, text), 'network'),
    ack: (externalId) => guard(() => bridge.telegramAck(externalId), 'api'),

    async subscribe(handler) {
      return bridge.onTelegramUpdate((raw) => handler(toMessage(raw)))
    },

    async subscribeStatus(handler) {
      return bridge.onTelegramStatus((raw) => handler(toStatus(raw)))
    },
  }
}
