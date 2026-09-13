import {
  AiError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiErrorKind,
  type AiFinishReason,
  type AiPort,
  type AiProbe,
  type AiStatus,
} from '../ports'
import type { BridgeAiCompletion, BridgeAiProbe, BridgeAiStatus, TauriBridge } from './bridge'

/**
 * The desktop AI adapter.
 *
 * Thin on purpose, exactly as `tauriTelegram` is. The HTTP request, the API key
 * and the provider's schema all live in Rust; this translates between the
 * bridge's snake_case DTOs and the port's vocabulary, and turns native failures
 * into `AiError` so the UI never sees a raw string from a provider.
 *
 * The one thing it cannot do is read the key. There is no bridge command that
 * returns it, so there is nothing here to forget to leave out.
 */

/**
 * The kinds the native side is allowed to claim.
 *
 * Deliberately narrower than `AiErrorKind`. The interpretation kinds —
 * `invalid-response`, `unsupported-intent`, `invalid-reference` — are raised by
 * the parser in `src/ai` after a reply arrives intact, so a native failure that
 * named one would be describing something it cannot know about. Anything not in
 * this set falls back to the caller's transport-level default.
 */
const NATIVE_KINDS: ReadonlySet<string> = new Set<AiErrorKind>([
  'unsupported',
  'not-configured',
  'disabled',
  'invalid-key',
  'rate-limited',
  'network',
  'timeout',
  'keychain',
  'protocol',
  'api',
])

const FINISH: ReadonlySet<string> = new Set<AiFinishReason>(['stop', 'length', 'filter', 'other'])

function toAiError(error: unknown, fallback: AiErrorKind): AiError {
  if (error instanceof AiError) return error

  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const raw = error as { kind: unknown; message?: unknown }
    const kind =
      typeof raw.kind === 'string' && NATIVE_KINDS.has(raw.kind)
        ? (raw.kind as AiErrorKind)
        : fallback
    const message =
      typeof raw.message === 'string' && raw.message.length > 0
        ? raw.message
        : 'The AI provider could not complete that request.'
    return new AiError(kind, message)
  }

  // Deliberately not `String(error)`: an unexpected native failure could carry
  // a request URL or a header, and neither belongs in the interface.
  return new AiError(fallback, 'The AI provider could not complete that request.')
}

const toStatus = (raw: BridgeAiStatus): AiStatus => ({
  configured: raw.configured,
  enabled: raw.enabled,
  provider: raw.provider,
  model: raw.model,
  lastError: raw.last_error,
  keychainReads: raw.keychain_reads,
})

const toFinish = (raw: string): AiFinishReason =>
  FINISH.has(raw) ? (raw as AiFinishReason) : 'other'

const toCompletion = (raw: BridgeAiCompletion): AiCompletionResult => ({
  text: raw.text,
  model: raw.model,
  finishReason: toFinish(raw.finish_reason),
  usage:
    raw.usage === null
      ? null
      : { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens },
})

const toProbe = (raw: BridgeAiProbe): AiProbe => ({ model: raw.model, text: raw.text })

/** The unconfigured answer, used when a status cannot be read at all. */
const UNKNOWN: AiStatus = {
  configured: false,
  enabled: false,
  provider: 'groq',
  model: '',
  lastError: 'Could not read the AI provider status.',
  keychainReads: 0,
}

export function createTauriAi(bridge: TauriBridge): AiPort {
  const guard = async <T>(run: () => Promise<T>, fallback: AiErrorKind): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      throw toAiError(error, fallback)
    }
  }

  return {
    id: 'ai-tauri',
    isAvailable: true,

    async status() {
      try {
        return toStatus(await bridge.aiStatus())
      } catch {
        // Reading status must never throw: Settings calls it on mount, and a
        // momentary failure should show as "not configured", not a crash.
        return UNKNOWN
      }
    },

    configure: (apiKey) =>
      guard(async () => toStatus(await bridge.aiConfigure(apiKey)), 'invalid-key'),
    disconnect: () => guard(async () => toStatus(await bridge.aiDisconnect()), 'keychain'),
    setEnabled: (enabled) => guard(async () => toStatus(await bridge.aiSetEnabled(enabled)), 'api'),
    setModel: (model) => guard(async () => toStatus(await bridge.aiSetModel(model)), 'protocol'),
    test: () => guard(async () => toProbe(await bridge.aiTest()), 'network'),

    complete: (request: AiCompletionRequest) =>
      guard(
        async () =>
          toCompletion(
            await bridge.aiComplete({
              messages: request.messages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              json: request.json ?? false,
              max_output_tokens: request.maxOutputTokens ?? null,
              temperature: request.temperature ?? null,
            }),
          ),
        'network',
      ),
  }
}
