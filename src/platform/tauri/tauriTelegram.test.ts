import { beforeEach, describe, expect, it } from 'vitest'
import { unsupportedTelegram } from '../browser/unsupportedTelegram'
import { TelegramError, type TelegramPort } from '../ports'
import { createFakeTauriBridge, type FakeTauriBridge } from './fakeBridge'
import { createTauriTelegram } from './tauriTelegram'

/**
 * The desktop Telegram adapter, against a fake native side.
 *
 * The claim being tested is mostly negative: the adapter can send a token in
 * and can never get one out, native failures arrive as typed errors rather than
 * raw strings, and nothing here can address a host of its own choosing.
 */

let bridge: FakeTauriBridge
let telegram: TelegramPort

beforeEach(() => {
  bridge = createFakeTauriBridge()
  telegram = createTauriTelegram(bridge)
})

describe('configuration', () => {
  it('saves a token and answers with the bot, never the token', async () => {
    const identity = await telegram.configure('123456:secret-token-value')

    expect(identity.username).toBe('vaultwork_test_bot')
    // The token reached the keychain…
    expect(bridge.telegramStoredToken()).toBe('123456:secret-token-value')
    // …and nothing in the answer carries it.
    expect(JSON.stringify(identity)).not.toContain('secret-token-value')
  })

  it('offers no way to read the token back', () => {
    // Not a runtime check — a shape check. If a `getToken` ever appears on the
    // port, this fails and somebody has to justify it.
    expect(Object.keys(telegram)).not.toContain('getToken')
    expect(Object.keys(telegram)).not.toContain('token')
    expect(Object.keys(bridge).filter((key) => /token/i.test(key))).toEqual([
      'telegramStoredToken',
    ])
  })

  it('reports an invalid token as invalid, and keeps nothing', async () => {
    await expect(telegram.configure('invalid')).rejects.toMatchObject({
      name: 'TelegramError',
      kind: 'invalid-token',
    })
    expect(bridge.telegramStoredToken()).toBeNull()
  })

  it('starts out unconfigured', async () => {
    const status = await telegram.status()
    expect(status.configured).toBe(false)
    expect(status.running).toBe(false)
    expect(status.authorizedChatId).toBeNull()
  })

  it('reports configured once a token is saved', async () => {
    await telegram.configure('123:abc')
    const status = await telegram.status()

    expect(status.configured).toBe(true)
    // Configured is not connected: nothing is polling yet.
    expect(status.running).toBe(false)
  })

  it('never throws from status, so Settings can always render', async () => {
    const broken = createTauriTelegram({
      ...bridge,
      telegramStatus: async () => {
        throw new Error('bridge is down')
      },
    })

    const status = await broken.status()
    expect(status.configured).toBe(false)
    expect(status.lastError).toBeTruthy()
  })
})

describe('the credential store is consulted rarely, and never per request', () => {
  /*
   * The regression this guards.
   *
   * The token used to be read from the OS credential store inside every Bot API
   * call — so a 25-second long poll meant a read every 25 seconds, a reply
   * meant another, and `status()` meant another still. Measured on the real
   * binary: 15,081 reads in 33 seconds, each one a potential macOS
   * authorization prompt. The token is now read once per worker session and
   * held in Rust memory for that session's lifetime.
   *
   * `keychainReads` is reported so this stays observable rather than becoming
   * folklore.
   */
  it('reports a read count', async () => {
    await telegram.configure('123:abc')
    const status = await telegram.status()

    expect(typeof status.keychainReads).toBe('number')
    expect(status.keychainReads).toBeLessThanOrEqual(1)
  })

  it('does not climb as messages are sent', async () => {
    await telegram.configure('123:abc')
    const before = (await telegram.status()).keychainReads

    for (let n = 0; n < 20; n += 1) {
      await telegram.sendMessage('1000', `message ${n}`)
      await telegram.ack(String(n))
    }

    expect((await telegram.status()).keychainReads).toBe(before)
  })

  it('does not climb as status is polled', async () => {
    await telegram.configure('123:abc')
    const before = (await telegram.status()).keychainReads

    for (let n = 0; n < 20; n += 1) await telegram.status()

    expect((await telegram.status()).keychainReads).toBe(before)
  })

  it('reports zero in a browser, which has no credential store to read', async () => {
    expect((await unsupportedTelegram.status()).keychainReads).toBe(0)
  })
})

describe('start and stop', () => {
  it('refuses to start without a token', async () => {
    await expect(telegram.start()).rejects.toMatchObject({ kind: 'not-configured' })
  })

  it('starts once a token exists', async () => {
    await telegram.configure('123:abc')
    const status = await telegram.start()
    expect(status.running).toBe(true)
  })

  it('starting twice leaves one worker, not two', async () => {
    await telegram.configure('123:abc')
    await telegram.start()
    await telegram.start()

    // The native side is idempotent by generation counter; from here the
    // observable property is that the state is simply "running".
    expect((await telegram.status()).running).toBe(true)
  })

  it('stops', async () => {
    await telegram.configure('123:abc')
    await telegram.start()
    expect((await telegram.stop()).running).toBe(false)
  })
})

describe('authorization', () => {
  it('refuses to authorize a chat that is not waiting', async () => {
    await expect(telegram.authorize('9999')).rejects.toMatchObject({ kind: 'no-pending-chat' })
    expect((await telegram.status()).authorizedChatId).toBeNull()
  })

  it('approves only the chat that is actually pending', async () => {
    bridge.telegramSetPending('1000', 'Awaneesh')

    // An arbitrary id cannot be smuggled in even while something is pending.
    await expect(telegram.authorize('4242')).rejects.toMatchObject({ kind: 'no-pending-chat' })

    const status = await telegram.authorize('1000')
    expect(status.authorizedChatId).toBe('1000')
    expect(status.pendingChatId).toBeNull()
  })
})

describe('messages', () => {
  it('delivers a normalised message to a subscriber', async () => {
    const seen: unknown[] = []
    await telegram.subscribe((message) => seen.push(message))

    bridge.deliverTelegram({ text: '/today', external_id: '77', chat_id: '1000' })

    expect(seen).toEqual([
      {
        source: 'telegram',
        externalId: '77',
        chatId: '1000',
        senderId: null,
        text: '/today',
        receivedAt: 1_700_000_000_000,
      },
    ])
  })

  it('stops delivering after unsubscribe', async () => {
    const seen: unknown[] = []
    const off = await telegram.subscribe((message) => seen.push(message))
    off()

    bridge.deliverTelegram({ text: '/today' })
    expect(seen).toEqual([])
  })

  it('sends a reply', async () => {
    await telegram.sendMessage('1000', 'Task created')
    expect(bridge.telegramSent).toEqual([{ chatId: '1000', text: 'Task created' }])
  })

  it('acknowledges an update so the cursor may move', async () => {
    await telegram.ack('77')
    expect(bridge.telegramAcked).toEqual(['77'])
  })
})

describe('errors are typed, and never leak a URL', () => {
  it('maps a native failure onto a known kind', async () => {
    bridge.failNext('telegramSend', { kind: 'rate-limited', message: 'Slow down.' })

    await expect(telegram.sendMessage('1000', 'hi')).rejects.toMatchObject({
      kind: 'rate-limited',
    })
  })

  it('falls back safely on an unrecognised kind', async () => {
    bridge.failNext('telegramSend', { kind: 'meltdown', message: 'Odd.' })
    const error = await telegram.sendMessage('1000', 'hi').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TelegramError)
    expect((error as TelegramError).kind).toBe('network')
  })

  it('never surfaces a raw native error, which could contain the token in a URL', async () => {
    const leaky = createTauriTelegram({
      ...bridge,
      telegramSend: async () => {
        throw new Error('POST https://api.telegram.org/bot123456:SECRET/sendMessage failed')
      },
    })

    const error = await leaky.sendMessage('1000', 'hi').catch((e: unknown) => e)
    expect((error as TelegramError).message).not.toContain('SECRET')
    expect((error as TelegramError).message).not.toContain('api.telegram.org')
  })
})

describe('disconnecting forgets the bot and nothing else', () => {
  it('clears the token, the authorization and the running state', async () => {
    await telegram.configure('123:abc')
    bridge.telegramSetPending('1000', 'Me')
    await telegram.authorize('1000')
    await telegram.start()

    const status = await telegram.disconnect()

    expect(status.configured).toBe(false)
    expect(status.running).toBe(false)
    expect(status.authorizedChatId).toBeNull()
    expect(bridge.telegramStoredToken()).toBeNull()
  })

  it('leaves the vault alone — a bot and a vault are different things', async () => {
    bridge.seed('notes/a.md', 'kept')
    await telegram.configure('123:abc')
    await telegram.disconnect()

    expect(bridge.files.get('notes/a.md')).toBe('kept')
  })
})

describe('the browser is honest about not supporting this', () => {
  it('reports itself unsupported', () => {
    expect(unsupportedTelegram.isSupported).toBe(false)
  })

  it('reports a status rather than throwing, so Settings can explain', async () => {
    const status = await unsupportedTelegram.status()
    expect(status.configured).toBe(false)
    expect(status.running).toBe(false)
  })

  it('refuses every operation with a message a person can read', async () => {
    for (const run of [
      () => unsupportedTelegram.configure('123:abc'),
      () => unsupportedTelegram.start(),
      () => unsupportedTelegram.test(),
      () => unsupportedTelegram.sendMessage('1', 'hi'),
    ]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(TelegramError)
      expect((error as TelegramError).kind).toBe('unsupported')
      expect((error as TelegramError).message).toContain('desktop')
    }
  })

  it('subscribes without ever firing, so the shell need not branch', async () => {
    const seen: unknown[] = []
    const off = await unsupportedTelegram.subscribe((message) => seen.push(message))
    expect(seen).toEqual([])
    expect(() => off()).not.toThrow()
  })
})
