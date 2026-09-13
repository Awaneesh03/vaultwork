import { maintenanceRepo, settingsRepo } from '@/repositories'
import type { PersistenceStatus } from '@/platform'
import { attempt, type Result } from '@/types/result'
import { requestPersistence } from './storageService'

export interface BootstrapReport {
  seeded: boolean
  seedCounts: Record<string, number>
  persistence: PersistenceStatus
  schemaVersion: number
}

export interface BootstrapOptions {
  /** Seeding is for development only; a real database is never touched. */
  seed?: boolean
  now?: Date
}

/**
 * Start-up, in order:
 *
 *  1. open the database (and explain it clearly if IndexedDB refuses)
 *  2. ask for persistent storage — never fatal, only reported
 *  3. ensure the settings row exists — the one place that is written, so
 *     every later read can stay read-only and safe inside a live query
 *  4. seed, but only into a database that is genuinely empty
 *
 * Returns a Result: a failure here has to render as a screen, not a blank page.
 */
export async function bootstrapApp(options: BootstrapOptions = {}): Promise<Result<BootstrapReport>> {
  return attempt(async () => {
    await maintenanceRepo.open()

    const persistence = await requestPersistence()
    const settings = await settingsRepo.ensure()

    let seeded = false
    let seedCounts: Record<string, number> = {}
    if (options.seed) {
      const result = await maintenanceRepo.seedIfEmpty(options.now)
      seeded = result.seeded
      seedCounts = result.counts
    }

    return { seeded, seedCounts, persistence, schemaVersion: settings.schemaVersion }
  })
}
