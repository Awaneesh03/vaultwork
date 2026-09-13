import type { EntityMap, StoreName } from './entities'

/** Every store's rows, keyed by store name. */
export type BackupData = { [K in StoreName]: EntityMap[K][] }

/**
 * The on-disk backup format.
 *
 * `formatVersion` describes this envelope; `schemaVersion` describes the Dexie
 * schema the rows came from. They move independently, and an importer needs
 * both to decide whether it can read the file.
 */
export interface BackupFile {
  format: 'vaultwork.backup'
  formatVersion: 1
  schemaVersion: number
  appVersion: string
  exportedAt: number
  /** Hash of `data`, so a truncated or edited file is caught before import. */
  checksum: string
  counts: Record<string, number>
  data: BackupData
}

export const BACKUP_FORMAT = 'vaultwork.backup'
export const BACKUP_FORMAT_VERSION = 1
