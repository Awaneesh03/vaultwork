import { describe, expect, it } from 'vitest'
import { isId, newId } from './id'

describe('newId', () => {
  it('produces a valid v4 UUID', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(isId(id)).toBe(true)
  })

  it('does not collide across a large batch', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId()))
    expect(ids.size).toBe(20_000)
  })

  it('falls back to getRandomValues when randomUUID is missing', () => {
    const original = globalThis.crypto.randomUUID
    // Older Safari and insecure contexts do not expose randomUUID at all.
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    })
    try {
      const id = newId()
      expect(isId(id)).toBe(true)
      expect(id[14]).toBe('4')
      expect('89ab').toContain(id[19])
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      })
    }
  })

  it('rejects things that are not ids', () => {
    expect(isId('')).toBe(false)
    expect(isId('not-a-uuid')).toBe(false)
    expect(isId(42)).toBe(false)
  })
})
