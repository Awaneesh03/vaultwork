import { afterEach, describe, expect, it } from 'vitest'
import { platform, type AiStatus, type GoogleStatus, type TelegramStatus } from '@/platform'
import {
  EVENT_SOURCES,
  MESSAGE_SOURCES,
  PROVENANCE_SOURCES,
  SOURCE_IDS,
  type SourceId,
} from '@/types/enums'
import * as registry from './sourceRegistryService'
import {
  describeSources,
  getSource,
  getSources,
  isSourceId,
  UnknownSourceError,
  type SourceInputs,
} from './sourceRegistryService'
import type { VaultStatus } from './obsidianService'

/**
 * M18.4: the registry says what each integration reports — no more, and never
 * anything secret. Pure mapping first, then the real composition in this (the
 * browser) runtime, then what the registry must never be able to do.
 */

const NOW = 1_790_000_000_000

const vault = (state: VaultStatus['state'], vaultName: string | null = null): VaultStatus => ({
  state,
  vaultName,
  restorable: true,
  // The port's own sentence — the registry must not repeat a path from it.
  message: 'Connected to /Users/someone/Private Vault.',
})

const telegram = (overrides: Partial<TelegramStatus> = {}): TelegramStatus => ({
  configured: true,
  running: true,
  botUsername: 'vaultwork_bot',
  authorizedChatId: '987654321',
  pendingChatId: null,
  pendingChatName: null,
  autoStart: false,
  lastError: null,
  keychainReads: 2,
  ...overrides,
})

const ai = (overrides: Partial<AiStatus> = {}): AiStatus => ({
  configured: true,
  enabled: true,
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  lastError: null,
  keychainReads: 1,
  ...overrides,
})

const inputs = (overrides: Partial<SourceInputs> = {}): SourceInputs => ({
  now: NOW,
  vault: vault('connected', 'Notes'),
  ai: ai(),
  telegram: telegram(),
  mcp: { supported: true, publishedAt: NOW - 60_000 },
  failed: new Set<SourceId>(),
  ...overrides,
})

const one = (id: SourceId, overrides: Partial<SourceInputs> = {}) => {
  const found = describeSources(inputs(overrides)).find((source) => source.id === id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

describe('the registry', () => {
  it('describes every known source, in a stable order', () => {
    expect(describeSources(inputs()).map((source) => source.id)).toEqual([...SOURCE_IDS])
    expect([...SOURCE_IDS]).toEqual([
      'vaultwork',
      'obsidian',
      'assistant',
      'mcp',
      'telegram',
      'google',
    ])
  })

  it('always has the local database available for read, write and search', () => {
    expect(one('vaultwork')).toMatchObject({
      status: 'available',
      capabilities: ['read', 'write', 'search'],
    })
  })
})

describe('Obsidian', () => {
  it('maps every connection state the vault reports', () => {
    const cases: [VaultStatus['state'], string][] = [
      ['connected', 'connected'],
      ['not-connected', 'disconnected'],
      ['permission-required', 'requiresSetup'],
      ['permission-denied', 'error'],
      ['unsupported', 'unavailable'],
    ]
    for (const [state, status] of cases) {
      expect(one('obsidian', { vault: vault(state, 'Notes') }).status, state).toBe(status)
    }
  })

  it('claims capabilities only while connected, and never search', () => {
    expect(one('obsidian').capabilities).toEqual(['read', 'write', 'import', 'export', 'sync'])
    expect(one('obsidian', { vault: vault('not-connected') }).capabilities).toEqual([])
    expect(one('obsidian', { vault: vault('permission-required') }).capabilities).toEqual([])
  })

  it("names the vault by its folder name, never by the port's path-bearing message", () => {
    expect(one('obsidian').detail).toBe('Vault “Notes”')
    expect(JSON.stringify(describeSources(inputs()))).not.toContain('/Users/')
  })
})

describe('the Assistant provider', () => {
  it('is available with a saved, enabled key — never connected, since nothing called it', () => {
    expect(one('assistant')).toMatchObject({ status: 'available', capabilities: ['reason'] })
  })

  it('reports each reason it cannot be used', () => {
    expect(one('assistant', { ai: null }).status).toBe('unavailable')
    expect(one('assistant', { ai: ai({ configured: false }) }).status).toBe('requiresSetup')
    expect(one('assistant', { ai: ai({ enabled: false }) }).status).toBe('disconnected')
    expect(one('assistant', { ai: ai({ lastError: 'boom' }) }).status).toBe('error')
    expect(one('assistant', { ai: ai({ enabled: false }) }).capabilities).toEqual([])
  })
})

describe('MCP', () => {
  it('is unavailable outside the desktop build', () => {
    expect(one('mcp', { mcp: { supported: false, publishedAt: null } })).toMatchObject({
      status: 'unavailable',
      capabilities: [],
      checkedAt: null,
    })
  })

  it('is available and read-only on desktop — never connected, which it cannot know', () => {
    const published = one('mcp')
    expect(published).toMatchObject({ status: 'available', capabilities: ['read'] })
    expect(published.checkedAt).toBe(NOW - 60_000)

    const notYet = one('mcp', { mcp: { supported: true, publishedAt: null } })
    expect(notYet.status).toBe('available')
    expect(notYet.detail).toMatch(/not published yet/)
  })
})

describe('Telegram', () => {
  it('is connected only when the worker runs for an approved chat', () => {
    expect(one('telegram')).toMatchObject({
      status: 'connected',
      capabilities: ['capture', 'read', 'write'],
      detail: '@vaultwork_bot',
    })
  })

  it('reports every other state without claiming a connection', () => {
    expect(one('telegram', { telegram: null }).status).toBe('unavailable')
    expect(one('telegram', { telegram: telegram({ configured: false }) }).status).toBe(
      'requiresSetup',
    )
    expect(one('telegram', { telegram: telegram({ running: false }) }).status).toBe('disconnected')
    expect(one('telegram', { telegram: telegram({ authorizedChatId: null }) }).status).toBe(
      'requiresSetup',
    )
    expect(one('telegram', { telegram: telegram({ lastError: 'x' }) }).status).toBe('error')
    for (const state of [
      telegram({ running: false }),
      telegram({ authorizedChatId: null }),
      telegram({ configured: false }),
    ]) {
      expect(one('telegram', { telegram: state }).capabilities).toEqual([])
    }
  })
})

describe('failures', () => {
  it('turns a status call that threw into an error row, not a missing one', () => {
    const sources = describeSources(inputs({ failed: new Set<SourceId>(['telegram', 'obsidian']) }))
    expect(sources.map((source) => source.id)).toEqual([...SOURCE_IDS])
    expect(sources.find((s) => s.id === 'telegram')?.status).toBe('error')
    expect(sources.find((s) => s.id === 'obsidian')?.status).toBe('error')
  })
})

describe('in this build (the browser runtime tests run in)', () => {
  const realTelegram = platform.telegram
  afterEach(() => {
    Object.defineProperty(platform, 'telegram', { value: realTelegram, configurable: true })
  })

  it('reports nothing desktop-only as connected or available', async () => {
    const sources = await getSources()
    const byId = Object.fromEntries(sources.map((source) => [source.id, source.status]))
    expect(byId).toEqual({
      vaultwork: 'available',
      obsidian: 'unavailable',
      assistant: 'unavailable',
      mcp: 'unavailable',
      telegram: 'unavailable',
      // M19.2: a browser cannot hold a Google grant.
      google: 'unavailable',
    })
  })

  it('reads a source through its own port, and survives that port failing', async () => {
    Object.defineProperty(platform, 'telegram', {
      value: {
        ...realTelegram,
        isSupported: true,
        status: () => Promise.reject(new Error('bridge down')),
      },
      configurable: true,
    })
    expect((await getSource('telegram')).status).toBe('error')
    // One integration failing does not take the others with it.
    expect((await getSource('vaultwork')).status).toBe('available')
  })
})

describe('what the registry refuses', () => {
  it('rejects a source it does not know rather than looking it up', async () => {
    for (const id of ['gmail', 'calendar', 'notebooklm', '__proto__', '', 'mcp ']) {
      expect(isSourceId(id), id).toBe(false)
      await expect(getSource(id)).rejects.toBeInstanceOf(UnknownSourceError)
    }
  })

  it('carries no credential, chat, keychain or provider-error detail', () => {
    const everything = JSON.stringify([
      ...describeSources(
        inputs({
          telegram: telegram({ pendingChatId: '5550001', pendingChatName: 'A Private Person' }),
        }),
      ),
      ...describeSources(
        inputs({
          ai: ai({ lastError: 'Invalid API key: gsk_THISISNOTAREALKEY' }),
          telegram: telegram({ lastError: 'Unauthorized: 123456:NOTAREALTOKEN' }),
        }),
      ),
    ])
    for (const secret of [
      '987654321',
      '5550001',
      'A Private Person',
      'keychain',
      'gsk_',
      'NOTAREALTOKEN',
      'Unauthorized',
      'Invalid API key',
    ]) {
      expect(everything, secret).not.toContain(secret)
    }
  })

  it('exposes descriptions only — no way to act on a source', () => {
    const exported = Object.keys(registry).sort()
    expect(exported).toEqual([
      'UnknownSourceError',
      'describeSources',
      'getSource',
      'getSources',
      'isSourceId',
    ])
    for (const name of exported) {
      expect(name).not.toMatch(/exec|run|perform|invoke|dispatch|action|connect|send|write|call/i)
    }
  })

  it('leaves every persisted source vocabulary exactly as it was', () => {
    // Stored rows carry these strings; the registry must not have renamed one.
    expect([...PROVENANCE_SOURCES]).toEqual([
      'user',
      'vaultwork',
      'email',
      'calendar',
      'web',
      'claude',
      'notebooklm',
      'inbox',
    ])
    expect([...MESSAGE_SOURCES]).toEqual(['telegram', 'inbox'])
    expect([...EVENT_SOURCES]).toEqual([
      'ui',
      'quickadd',
      'palette',
      'message',
      'telegram',
      'ai',
      'obsidian',
      'inbox',
    ])
    // And where a word is shared, it is the same word.
    const shared = SOURCE_IDS.filter(
      (id) =>
        (EVENT_SOURCES as readonly string[]).includes(id) ||
        (MESSAGE_SOURCES as readonly string[]).includes(id) ||
        (PROVENANCE_SOURCES as readonly string[]).includes(id),
    )
    expect(shared.sort()).toEqual(['obsidian', 'telegram', 'vaultwork'])
  })
})

describe('the Google account (M19.2)', () => {
  const google = (overrides: Partial<GoogleStatus> = {}): GoogleStatus => ({
    configuredInBuild: true,
    authorized: true,
    connecting: false,
    reconnectRequired: false,
    calendar: true,
    gmail: true,
    account: 'you@example.com',
    connectedAt: NOW - 86_400_000,
    lastCheckedAt: NOW - 1_000,
    lastError: null,
    keychainReads: 1,
    ...overrides,
  })
  const describeGoogle = (status: GoogleStatus | null) =>
    describeSources(inputs({ google: status })).find((source) => source.id === 'google')!

  it('is one source named for the account, whatever it was granted', () => {
    const source = describeGoogle(google())
    expect(source).toMatchObject({
      name: 'Google account',
      status: 'connected',
      capabilities: ['read'],
      detail: 'Calendar + Gmail · you@example.com',
      checkedAt: NOW - 1_000,
    })
  })

  it('says which service a partial grant covers', () => {
    expect(describeGoogle(google({ gmail: false })).detail).toBe('Calendar only · you@example.com')
    expect(describeGoogle(google({ calendar: false, account: null })).detail).toBe('Gmail only')
  })

  it('is connected only after a real round trip — a stored grant is merely available', () => {
    expect(describeGoogle(google({ lastCheckedAt: null })).status).toBe('available')
  })

  it('maps every other state honestly', () => {
    expect(describeGoogle(null)).toMatchObject({ status: 'unavailable', detail: 'Desktop only.' })
    expect(describeGoogle(google({ configuredInBuild: false }))).toMatchObject({
      status: 'unavailable',
      detail: 'Not in this build.',
    })
    expect(describeGoogle(google({ authorized: false }))).toMatchObject({
      status: 'requiresSetup',
      capabilities: [],
    })
    expect(describeGoogle(google({ authorized: false, reconnectRequired: true })).status).toBe(
      'error',
    )
    expect(describeGoogle(google({ lastError: 'network' }))).toMatchObject({
      status: 'error',
      capabilities: [],
    })
  })

  it('never carries anything but words and a time', () => {
    const text = JSON.stringify(describeGoogle(google()))
    expect(text).not.toMatch(/token|secret|keychain|scope|googleapis/i)
  })
})
