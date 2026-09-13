import { APP_VERSION } from '@/lib/version'
import { hashObject } from '@/lib/hash'
import { maintenanceRepo } from '@/repositories'
import { platform, type SnapshotMeta, type SnapshotStore } from '@/platform'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupFile } from '@/types/backup'
import { attempt, err, ok, type Result } from '@/types/result'
import { STORE_NAMES_FOR_BACKUP } from './storeNames'

/**
 * Export, import and rolling snapshots.
 *
 * This is the feature that makes every later milestone safe to build. It is not
 * polish: IndexedDB can be evicted, and a personal system with no server has
 * exactly one copy of everything unless you make another.
 */

export const SNAPSHOT_KEEP = 7

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

export async function exportBackup(): Promise<BackupFile> {
  return maintenanceRepo.exportAll(APP_VERSION)
}

/** Hands the file to the user. In the browser that means a download. */
export async function downloadBackup(now = new Date()): Promise<Result<string>> {
  return attempt(async () => {
    const backup = await exportBackup()
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const filename = `vaultwork-backup-${stamp}.json`
    await platform.fileSystem.writeFile(filename, serializeBackup(backup))
    return filename
  })
}

/**
 * Validates a backup before anything is written.
 *
 * An import replaces the entire database, so every reason to refuse has to be
 * found here — after `replaceAll` starts there is nothing left to compare
 * against.
 */
export function parseBackup(text: string): Result<BackupFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return err(new Error('That file is not valid JSON.'))
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err(new Error('That file does not contain a Vaultwork backup.'))
  }

  const candidate = parsed as Partial<BackupFile>
  if (candidate.format !== BACKUP_FORMAT) {
    return err(new Error('That file is not a Vaultwork backup.'))
  }
  if (candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    return err(
      new Error(
        `This backup uses format version ${String(candidate.formatVersion)}; this build reads version ${BACKUP_FORMAT_VERSION}.`,
      ),
    )
  }
  if (typeof candidate.data !== 'object' || candidate.data === null) {
    return err(new Error('The backup has no data section.'))
  }

  const data = candidate.data as Record<string, unknown>
  for (const store of STORE_NAMES_FOR_BACKUP) {
    const rows = data[store]
    if (!Array.isArray(rows)) {
      return err(new Error(`The backup is missing the "${store}" store.`))
    }
    if (rows.some((row) => typeof row !== 'object' || row === null || !('id' in row))) {
      return err(new Error(`The "${store}" store contains a row without an id.`))
    }
  }

  if (typeof candidate.checksum === 'string' && candidate.checksum !== hashObject(candidate.data)) {
    return err(new Error('The backup failed its checksum: the file has been altered or truncated.'))
  }

  return ok(candidate as BackupFile)
}

export interface ImportSummary {
  restored: Record<string, number>
  schemaVersion: number
  exportedAt: number
}

/**
 * Replaces the database with a backup's contents.
 *
 * A snapshot of the current state is taken first, so an import of the wrong
 * file is recoverable rather than terminal.
 */
export async function importBackup(
  text: string,
  options: { snapshotFirst?: boolean } = {},
): Promise<Result<ImportSummary>> {
  const parsed = parseBackup(text)
  if (!parsed.ok) return parsed

  return attempt(async () => {
    if (options.snapshotFirst !== false) {
      await createSnapshot('pre-import').catch(() => undefined)
    }
    await maintenanceRepo.replaceAll(parsed.value.data)
    const restored = Object.fromEntries(
      STORE_NAMES_FOR_BACKUP.map((store) => [
        store,
        (parsed.value.data as unknown as Record<string, unknown[]>)[store]?.length ?? 0,
      ]),
    )
    return {
      restored,
      schemaVersion: parsed.value.schemaVersion,
      exportedAt: parsed.value.exportedAt,
    }
  })
}

/* ------------------------------------------------------------------ snapshots */

function snapshotId(label: string, now: Date): string {
  return `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${label}`
}

export async function createSnapshot(
  label = 'auto',
  now = new Date(),
  store: SnapshotStore = platform.snapshots,
): Promise<Result<SnapshotMeta>> {
  return attempt(async () => {
    const backup = await exportBackup()
    const contents = serializeBackup(backup)
    const id = snapshotId(label, now)
    await store.save(id, contents)
    await pruneSnapshots(SNAPSHOT_KEEP, store)
    return { id, createdAt: now.getTime(), bytes: contents.length }
  })
}

export async function listSnapshots(
  store: SnapshotStore = platform.snapshots,
): Promise<SnapshotMeta[]> {
  return store.list()
}

/** Keeps the newest `keep` snapshots and drops the rest. */
export async function pruneSnapshots(
  keep = SNAPSHOT_KEEP,
  store: SnapshotStore = platform.snapshots,
): Promise<number> {
  const all = await store.list()
  const stale = all.slice(keep)
  for (const snapshot of stale) await store.remove(snapshot.id)
  return stale.length
}

export async function restoreSnapshot(
  id: string,
  store: SnapshotStore = platform.snapshots,
): Promise<Result<ImportSummary>> {
  const read = await attempt(() => store.read(id))
  if (!read.ok) return read
  return importBackup(read.value, { snapshotFirst: false })
}
