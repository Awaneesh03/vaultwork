import { DATABASE_NAME, VaultworkDatabase } from './schema'

/**
 * The application-wide database instance.
 *
 * Nothing outside repositories/ may import this module — the ESLint
 * import-boundary rules fail the build if anything tries.
 */
export const db = new VaultworkDatabase(DATABASE_NAME)

export { DATABASE_NAME, STORE_NAMES, VaultworkDatabase, withEventLogUnlocked } from './schema'
export { CURRENT_SCHEMA_VERSION, MIGRATIONS, applyMigrations } from './migrations'
export type { MigrationDefinition } from './migrations'

/**
 * Opens the database, turning the handful of ways IndexedDB can refuse into a
 * single explanatory error. The most common one in practice is a browser in
 * private mode, or a second tab holding an older schema version open.
 */
export async function openDatabase(instance = db): Promise<void> {
  try {
    if (!instance.isOpen()) await instance.open()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'VersionError') {
      throw new Error(
        'This browser holds a newer version of the Vaultwork database. Close other tabs and reload.',
      )
    }
    if (name === 'InvalidStateError' || name === 'SecurityError') {
      throw new Error(
        'IndexedDB is unavailable. Private browsing or blocked site data will prevent Vaultwork from storing anything.',
      )
    }
    throw error
  }
}
