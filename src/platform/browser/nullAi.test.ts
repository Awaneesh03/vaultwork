import { describe, expect, it } from 'vitest'
import { AiError, type AiPort } from '../ports'
import { nullAi } from './nullAi'

/**
 * AI in a browser.
 *
 * The claim being pinned is a security one, not a feature one: a browser bundle
 * is public, so this adapter must refuse everything rather than half-work. The
 * rest of Vaultwork keeps running — AI is optional, and `capabilities.ai` is
 * how the UI asks.
 */

describe('nullAi', () => {
  it('reports itself unavailable, with a stable id', () => {
    expect(nullAi.isAvailable).toBe(false)
    expect(nullAi.id).toBe('ai-null')
  })

  it('reads as unconfigured rather than throwing', async () => {
    // Settings calls this on mount in both runtimes. An unavailable provider is
    // a state to display, not an error to handle.
    const status = await nullAi.status()

    expect(status.configured).toBe(false)
    expect(status.enabled).toBe(false)
    expect(status.keychainReads).toBe(0)
    expect(status.lastError).toBeNull()
  })

  it('refuses every operation with a typed rejection', async () => {
    // Rejections, never synchronous throws: the port promises promises, and a
    // synchronous throw would escape a caller's `.catch` entirely.
    const operations: [string, () => Promise<unknown>][] = [
      ['configure', () => nullAi.configure('a-key')],
      ['disconnect', () => nullAi.disconnect()],
      ['setEnabled', () => nullAi.setEnabled(true)],
      ['setModel', () => nullAi.setModel('some-model')],
      ['test', () => nullAi.test()],
      ['complete', () => nullAi.complete({ messages: [{ role: 'user', content: 'hi' }] })],
    ]

    for (const [name, run] of operations) {
      const error = (await run().catch((caught: unknown) => caught)) as AiError
      expect(error, `${name} should reject`).toBeInstanceOf(AiError)
      expect(error.kind, `${name} should be refused as unsupported`).toBe('unsupported')
      expect(error.message).toContain('desktop app')
    }
  })

  it('stores nothing a key could hide in, even when handed one', async () => {
    await nullAi.configure('sk-should-never-be-kept').catch(() => undefined)

    // Nothing on the adapter retained it, and nothing on it could return it.
    expect(JSON.stringify(nullAi)).not.toContain('sk-should-never-be-kept')
    expect(Object.keys(nullAi).some((name) => /key|secret|token/i.test(name))).toBe(false)
  })

  it('satisfies the same port the desktop adapter does', () => {
    // Structural: the two adapters must stay interchangeable, so a caller can
    // never need to know which runtime it is in.
    const port: AiPort = nullAi
    const required: (keyof AiPort)[] = [
      'id',
      'isAvailable',
      'status',
      'configure',
      'disconnect',
      'setEnabled',
      'setModel',
      'test',
      'complete',
    ]
    for (const member of required) {
      expect(port[member], `nullAi is missing ${member}`).toBeDefined()
    }
  })
})
