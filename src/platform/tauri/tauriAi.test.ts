import { describe, expect, it } from 'vitest'
import { AiError } from '../ports'
import { createFakeTauriBridge } from './fakeBridge'
import { createTauriAi } from './tauriAi'

/**
 * The desktop AI adapter.
 *
 * The adapter is where the bugs live — the bridge itself is one `invoke` per
 * command and has no logic to get wrong — so everything here is driven against
 * the fake, in Node, with no Tauri and no network.
 *
 * The properties worth pinning: a native failure becomes a typed `AiError` and
 * never a raw string, reading a status cannot throw, the request that crosses
 * the bridge carries no destination, and nothing anywhere hands the key back.
 */

const ai = (options: Parameters<typeof createFakeTauriBridge>[0] = {}) => {
  const bridge = createFakeTauriBridge(options)
  return { bridge, port: createTauriAi(bridge) }
}

describe('identity', () => {
  it('has a stable provider id and reports the runtime as capable', () => {
    // The id names the *adapter*, not the vendor: swapping Groq for another
    // provider is a Rust change, and this string should not move with it.
    const { port } = ai()
    expect(port.id).toBe('ai-tauri')
    expect(port.isAvailable).toBe(true)
  })
})

describe('status', () => {
  it('reports an unconfigured provider without throwing', async () => {
    const { port } = ai({ aiKey: null })
    const status = await port.status()

    expect(status.configured).toBe(false)
    expect(status.provider).toBe('groq')
  })

  it('reports a configured provider once a key is saved', async () => {
    const { port } = ai({ aiKey: null })
    await port.configure('a-test-key')

    expect((await port.status()).configured).toBe(true)
  })

  it('never throws, even when the native side fails', async () => {
    // Settings calls this on mount. A momentary failure is a state to show,
    // not a crash — and never a reason for the screen to hang.
    const { bridge, port } = ai()
    bridge.failNext('aiStatus', { kind: 'keychain', message: 'nope' })

    const status = await port.status()
    expect(status.configured).toBe(false)
    expect(status.lastError).toBe('Could not read the AI provider status.')
  })

  it('carries no field that could hold a key', async () => {
    const { port } = ai({ aiKey: 'super-secret-key' })
    const status = await port.status()

    expect(Object.keys(status).sort()).toEqual([
      'configured',
      'enabled',
      'keychainReads',
      'lastError',
      'model',
      'provider',
    ])
    expect(JSON.stringify(status)).not.toContain('super-secret-key')
  })
})

describe('the key', () => {
  it('goes to the credential store and is never returned', async () => {
    const { bridge, port } = ai({ aiKey: null })

    const status = await port.configure('sk-test-do-not-leak')

    // The fake's "keychain" holds it; nothing the port returned does.
    expect(bridge.aiStoredKey()).toBe('sk-test-do-not-leak')
    expect(JSON.stringify(status)).not.toContain('sk-test-do-not-leak')

    // And there is no operation on the port that could ask for it back.
    expect(Object.keys(port)).not.toContain('getKey')
    expect(Object.keys(port).some((name) => /key|secret|token/i.test(name))).toBe(false)
  })

  it('is cleared by disconnecting', async () => {
    const { bridge, port } = ai({ aiKey: 'existing-key' })

    const status = await port.disconnect()

    expect(bridge.aiStoredKey()).toBeNull()
    expect(status.configured).toBe(false)
  })

  it('refuses an empty key rather than storing one', async () => {
    const { bridge, port } = ai({ aiKey: null })

    await expect(port.configure('   ')).rejects.toBeInstanceOf(AiError)
    expect(bridge.aiStoredKey()).toBeNull()
  })
})

/**
 * M15.1.1: an external network capability is never acquired by default.
 *
 * The distinction being pinned is between *having a credential* and *being
 * switched on*. Storing a Groq key is a setup step; enabling AI is a separate,
 * explicit decision, and a fresh installation has made neither.
 */
describe('the safe default', () => {
  it('is disabled on a fresh installation', async () => {
    const { port } = ai()
    const status = await port.status()

    expect(status.enabled).toBe(false)
    expect(status.configured).toBe(false)
  })

  it('stays disabled after a key is saved', async () => {
    // The whole point of the milestone: configuring is not consenting.
    const { port } = ai({ aiKey: null })

    const status = await port.configure('sk-a-valid-looking-key')

    expect(status.configured).toBe(true)
    expect(status.enabled).toBe(false)
  })

  it('refuses to spend the key while it is still switched off', async () => {
    // A stored key with AI off must make no request at all — not a failed one.
    const { bridge, port } = ai({ aiKey: null })
    await port.configure('sk-a-valid-looking-key')

    const error = (await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)) as AiError

    expect(error.kind).toBe('disabled')
    expect(bridge.aiRequests).toHaveLength(0)
  })

  it('refuses the connection probe too, for the same reason', async () => {
    // `ai_test` is a paid request like any other, and is gated the same way.
    const { port } = ai({ aiKey: 'k' })

    const error = (await port.test().catch((caught: unknown) => caught)) as AiError
    expect(error.kind).toBe('disabled')
  })

  it('turns on only when explicitly asked, and off again the same way', async () => {
    const { port } = ai({ aiKey: 'k' })

    const on = await port.setEnabled(true)
    expect(on.enabled).toBe(true)
    await expect(port.test()).resolves.toMatchObject({ text: 'ok' })

    const off = await port.setEnabled(false)
    expect(off.enabled).toBe(false)
    await expect(port.test()).rejects.toBeInstanceOf(AiError)
  })

  it('never reports enabled without the user having said so', async () => {
    // Every path that returns a status, on an installation that never opted in.
    const { port } = ai({ aiKey: null })

    const statuses = [
      await port.status(),
      await port.configure('sk-key'),
      await port.setModel('openai/gpt-oss-120b'),
      await port.disconnect(),
    ]

    for (const status of statuses) {
      expect(status.enabled).toBe(false)
    }
  })
})

describe('completions', () => {
  it('sends only what the caller passed, and no destination', async () => {
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true, aiReply: '{"answer":42}' })

    const result = await port.complete({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'what is the answer' },
      ],
      json: true,
    })

    expect(result.text).toBe('{"answer":42}')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 })

    const sent = bridge.aiRequests[0]
    expect(sent?.json).toBe(true)
    expect(sent?.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'what is the answer' },
    ])
    // The request carries no way to say *where* it goes.
    for (const field of ['url', 'host', 'endpoint', 'headers', 'apiKey', 'model']) {
      expect(sent).not.toHaveProperty(field)
    }
  })

  it('refuses when no key has been configured', async () => {
    const { port } = ai({ aiKey: null, aiEnabled: true })

    const error = await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).kind).toBe('not-configured')
  })

  it('refuses when the provider is switched off', async () => {
    const { port } = ai({ aiKey: 'k', aiEnabled: false })

    const error = await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)

    expect((error as AiError).kind).toBe('disabled')
  })

  it('normalises an unrecognised finish reason rather than trusting it', async () => {
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true })
    // A provider that invents a new reason must not widen the union.
    const original = bridge.aiComplete.bind(bridge)
    bridge.aiComplete = async (request) => ({
      ...(await original(request)),
      finish_reason: 'something_new',
    })

    const result = await port.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result.finishReason).toBe('other')
  })
})

describe('errors', () => {
  it('turns a native failure into a typed AiError', async () => {
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true })
    bridge.failNext('aiComplete', { kind: 'rate-limited', message: 'Slow down.' })

    const error = await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).kind).toBe('rate-limited')
    expect((error as AiError).message).toBe('Slow down.')
  })

  it('falls back to a safe kind when the native side sends an unknown one', async () => {
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true })
    bridge.failNext('aiComplete', { kind: 'wormhole', message: 'Something odd.' })

    const error = (await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)) as AiError

    expect(error.kind).toBe('network')
  })

  it('never lets an unexpected native value reach the UI verbatim', async () => {
    // A raw rejection could carry a URL or a header. The adapter replaces it
    // with a sentence rather than stringifying whatever arrived.
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true })
    bridge.aiComplete = async () => {
      throw 'https://api.groq.com/openai/v1/chat/completions failed with Authorization: Bearer sk-leak'
    }

    const error = (await port
      .complete({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught)) as AiError

    expect(error).toBeInstanceOf(AiError)
    expect(error.message).toBe('The AI provider could not complete that request.')
    expect(error.message).not.toContain('sk-leak')
    expect(error.message).not.toContain('groq.com')
  })
})

describe('configuration', () => {
  it('switches the provider off without forgetting the key', async () => {
    const { bridge, port } = ai({ aiKey: 'k', aiEnabled: true })

    const status = await port.setEnabled(false)

    expect(status.enabled).toBe(false)
    expect(status.configured).toBe(true)
    expect(bridge.aiStoredKey()).toBe('k')
  })

  it('changes the model through the one configuration point', async () => {
    const { port } = ai({ aiKey: 'k' })

    const status = await port.setModel('openai/gpt-oss-120b')
    expect(status.model).toBe('openai/gpt-oss-120b')
  })

  it('refuses a model name that is really a URL', async () => {
    const { port } = ai({ aiKey: 'k' })

    const error = await port.setModel('https://evil.example/v1').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
  })
})

describe('the connection probe', () => {
  it('reports the model that answered', async () => {
    const { port } = ai({ aiKey: 'k', aiEnabled: true, aiModel: 'fake-model-v1' })

    const probe = await port.test()
    expect(probe.model).toBe('fake-model-v1')
    expect(probe.text).toBe('ok')
  })

  it('fails safely when nothing is configured', async () => {
    const { port } = ai({ aiKey: null, aiEnabled: true })

    const error = (await port.test().catch((caught: unknown) => caught)) as AiError
    expect(error.kind).toBe('not-configured')
  })
})
