import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStorageReport, requestPersistence } from './storageService'

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function stubNavigator(storage: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: storage === undefined ? {} : { storage },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original)
})

/**
 * navigator.storage.persist() can be absent, refused, or throw. None of those
 * may interrupt start-up: an app that fails to boot because a browser declined
 * an optional request is worse than one that is merely evictable.
 */
describe('requestPersistence', () => {
  it('reports unsupported without throwing when there is no Storage API', async () => {
    stubNavigator(undefined)
    const status = await requestPersistence()

    expect(status).toEqual({
      supported: false,
      persisted: false,
      reason: 'This browser has no Storage API.',
    })
  })

  it('does not ask twice when storage is already persistent', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubNavigator({ persisted: vi.fn().mockResolvedValue(true), persist })

    const status = await requestPersistence()

    expect(status).toEqual({ supported: true, persisted: true })
    expect(persist).not.toHaveBeenCalled()
  })

  it('explains a refusal rather than pretending it worked', async () => {
    stubNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    })

    const status = await requestPersistence()

    expect(status.supported).toBe(true)
    expect(status.persisted).toBe(false)
    expect(status.reason).toMatch(/declined/)
  })

  it('grants when the browser agrees', async () => {
    stubNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(true),
    })

    expect(await requestPersistence()).toEqual({ supported: true, persisted: true })
  })

  it('catches a thrown request', async () => {
    stubNavigator({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error('SecurityError: blocked')),
    })

    const status = await requestPersistence()

    expect(status.persisted).toBe(false)
    expect(status.reason).toMatch(/blocked/)
  })
})

describe('getStorageReport', () => {
  it('returns a usable report even with no Storage API', async () => {
    stubNavigator(undefined)
    const report = await getStorageReport()

    expect(report.persistence.supported).toBe(false)
    expect(report.estimate).toBeNull()
  })

  it('includes the quota estimate when available', async () => {
    stubNavigator({
      persisted: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 2048, quota: 1_000_000 }),
    })

    const report = await getStorageReport()

    expect(report.persistence.persisted).toBe(true)
    expect(report.estimate).toEqual({ usageBytes: 2048, quotaBytes: 1_000_000 })
  })
})
