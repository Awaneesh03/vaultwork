import { AiError, type AiPort, type AiStatus } from '../ports'

/**
 * AI in a browser: honestly unavailable.
 *
 * A browser cannot hold an API key. Anything in the bundle is public, and a
 * key shipped to the client is a key published — `VITE_`-prefixed or not. The
 * provider therefore lives entirely in the native process, where the credential
 * sits in the OS keychain and never crosses into JavaScript.
 *
 * Rather than pretending and failing somewhere less obvious, this reports
 * `configured: false` and refuses every operation with a message the UI can
 * show verbatim. Every other part of Vaultwork keeps working: AI is an optional
 * capability, and `capabilities.ai` is how the UI asks.
 */
const UNSUPPORTED = 'AI needs the desktop app. A browser cannot hold a provider key.'

const IDLE: AiStatus = {
  configured: false,
  enabled: false,
  provider: 'none',
  model: '',
  lastError: null,
  // A browser reads no credential store at all.
  keychainReads: 0,
}

/**
 * Rejects, rather than throwing synchronously.
 *
 * The port declares every operation as promise-returning, so a caller writing
 * `ai.complete(...).catch(show)` is entitled to have its failure arrive as a
 * rejection. A synchronous throw would escape that `catch` entirely and surface
 * as an unhandled error somewhere unrelated.
 */
const refuse = async (): Promise<never> => {
  throw new AiError('unsupported', UNSUPPORTED)
}

export const nullAi: AiPort = {
  id: 'ai-null',
  isAvailable: false,

  /**
   * Reading a status never throws, on either adapter.
   *
   * Settings calls it on mount, and an unconfigured provider is a state to
   * display, not an error to handle.
   */
  async status() {
    return IDLE
  },

  configure: refuse,
  disconnect: refuse,
  setEnabled: refuse,
  setModel: refuse,
  test: refuse,
  complete: refuse,
}
