import { TelegramError, type TelegramPort, type TelegramStatus } from '../ports'

/**
 * Telegram in a browser: honestly unavailable.
 *
 * Long polling needs a process that is running, which a closed tab is not, and
 * a webhook needs a public HTTPS endpoint, which is a server. Rather than
 * pretending and failing somewhere less obvious, this reports `configured:
 * false` and refuses every operation with a message the Settings screen can
 * show the user verbatim.
 */
const UNSUPPORTED = 'Telegram needs the desktop app. A browser tab cannot hold a connection open.'

const IDLE: TelegramStatus = {
  configured: false,
  running: false,
  botUsername: null,
  authorizedChatId: null,
  pendingChatId: null,
  pendingChatName: null,
  autoStart: false,
  lastError: null,
  // A browser reads no credential store at all.
  keychainReads: 0,
}

/**
 * Rejects, rather than throwing synchronously.
 *
 * The port declares every operation as promise-returning, so a caller writing
 * `telegram.start().catch(show)` is entitled to have its failure arrive as a
 * rejection. A synchronous throw would escape that `catch` entirely and surface
 * as an unhandled error somewhere unrelated.
 */
const refuse = async (): Promise<never> => {
  throw new TelegramError('unsupported', UNSUPPORTED)
}

export const unsupportedTelegram: TelegramPort = {
  id: 'telegram-unsupported',
  isSupported: false,

  async status() {
    return IDLE
  },

  configure: refuse,
  test: refuse,
  start: refuse,
  stop: refuse,
  authorize: refuse,
  disconnect: refuse,
  setAutoStart: refuse,
  sendMessage: refuse,

  async ack() {
    /* nothing polls, so there is no cursor to advance */
  },

  async subscribe() {
    // Subscribing succeeds and never fires, so the app shell can wire itself
    // up unconditionally rather than branching on the runtime.
    return () => {}
  },

  async subscribeStatus() {
    return () => {}
  },
}
