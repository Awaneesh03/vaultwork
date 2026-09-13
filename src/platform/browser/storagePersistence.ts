/**
 * IndexedDB is not durable by default: a browser may evict it under storage
 * pressure. For a SaaS app that is an annoyance; for the only copy of two years
 * of habit history it is data loss.
 *
 * `navigator.storage.persist()` asks the browser to exempt this origin. It can
 * be refused, and it is unavailable entirely in some contexts — so every path
 * here returns a status rather than throwing, and the Settings screen reports
 * exactly what the browser said.
 */
export interface PersistenceStatus {
  supported: boolean
  persisted: boolean
  /** Present when persistence is unavailable or was refused. */
  reason?: string
}

export interface StorageEstimateResult {
  usageBytes: number
  quotaBytes: number
}

function storageApi(): StorageManager | null {
  if (typeof navigator === 'undefined') return null
  const storage = navigator.storage as StorageManager | undefined
  return storage ?? null
}

export async function isStoragePersisted(): Promise<PersistenceStatus> {
  const storage = storageApi()
  if (!storage || typeof storage.persisted !== 'function') {
    return { supported: false, persisted: false, reason: 'This browser has no Storage API.' }
  }
  try {
    return { supported: true, persisted: await storage.persisted() }
  } catch (error) {
    return {
      supported: true,
      persisted: false,
      reason: error instanceof Error ? error.message : 'Persistence status unavailable.',
    }
  }
}

export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  const storage = storageApi()
  if (!storage || typeof storage.persist !== 'function') {
    return { supported: false, persisted: false, reason: 'This browser has no Storage API.' }
  }
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return { supported: true, persisted: true }
    }
    const granted = await storage.persist()
    return granted
      ? { supported: true, persisted: true }
      : {
          supported: true,
          persisted: false,
          reason: 'The browser declined. Data can still be evicted under storage pressure.',
        }
  } catch (error) {
    return {
      supported: true,
      persisted: false,
      reason: error instanceof Error ? error.message : 'The persistence request failed.',
    }
  }
}

export async function estimateStorage(): Promise<StorageEstimateResult | null> {
  const storage = storageApi()
  if (!storage || typeof storage.estimate !== 'function') return null
  try {
    const estimate = await storage.estimate()
    return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 }
  } catch {
    return null
  }
}
