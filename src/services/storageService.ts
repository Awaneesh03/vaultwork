import {
  estimateStorage,
  isStoragePersisted,
  requestPersistentStorage,
  type PersistenceStatus,
  type StorageEstimateResult,
} from '@/platform'

export interface StorageReport {
  persistence: PersistenceStatus
  estimate: StorageEstimateResult | null
}

export async function getStorageReport(): Promise<StorageReport> {
  const [persistence, estimate] = await Promise.all([isStoragePersisted(), estimateStorage()])
  return { persistence, estimate }
}

/**
 * Asks the browser to exempt this origin from eviction.
 *
 * Never throws: an unsupported or refused request is a status the UI reports,
 * not an error that interrupts start-up.
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  return requestPersistentStorage()
}
