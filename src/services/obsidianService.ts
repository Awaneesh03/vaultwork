import { detectStatus, type SyncStatus } from '@/integrations/obsidian/conflict'
import { hashContent } from '@/integrations/obsidian/content'
import {
  comparableFromFile,
  comparableFromNote,
  parseNoteFile,
  serializeNote,
  titleFromPath,
} from '@/integrations/obsidian/noteFile'
import {
  assertSafeVaultPath,
  buildVaultPath,
  isSafeVaultPath,
  parentDirectories,
  uniqueVaultPath,
} from '@/integrations/obsidian/vaultPath'
import {
  EMPTY_SKIPPED,
  isMarkdownFile,
  isPdfFile,
  SKIPPED_EXAMPLES,
  type ScanError,
  type SkippedSummary,
} from '@/integrations/obsidian/syncPlan'
import { resolveWikilink, wikilinkTargets } from '@/integrations/obsidian/wikilinks'
import { platform } from '@/platform'
import { VaultError, type VaultPermission, type VaultPort } from '@/platform'
import { noteRepo, tagRepo, vaultDocumentRepo, vaultLinkRepo } from '@/repositories'
import type { Id, Note } from '@/types/entities'
import type { EventSource } from '@/types/enums'
import { eventBus } from './eventBus'
import { createNote, noteTitle, updateNote } from './noteService'

/**
 * Everything that moves a note between Vaultwork and an Obsidian vault.
 *
 * The service knows the `VaultPort` contract and nothing about how it is
 * implemented — not that today's adapter is the browser's File System Access
 * API, nor that M13 will add a Tauri one. That is the entire point of the
 * boundary: a native backend later is a new adapter, not a rewrite of this file
 * or of anything above it.
 *
 * Three rules are absolute here, and each has a test that would fail loudly:
 *
 *  1. **Never overwrite an external change.** Every write is preceded by a read
 *     and a three-way comparison. A conflict stops the operation and returns;
 *     it does not warn and continue.
 *
 *  2. **Never merge.** Not by line, not by recency, not at all. When both sides
 *     have moved the user decides, and the service's job is to say so clearly.
 *
 *  3. **Dexie remains the source of truth.** Nothing here is required for a
 *     note to exist, be edited, searched or listed. A vault that is absent,
 *     unsupported or permission-denied changes what this service can do and
 *     nothing else in the application.
 */

export interface ObsidianWriteOptions {
  source?: EventSource
}

/** The port, resolved once. Injectable so tests can supply a memory vault. */
let vault: VaultPort = platform.vault

/** Test seam. Production never calls this. */
export function setVaultPort(port: VaultPort): void {
  vault = port
}

export function getVaultPort(): VaultPort {
  return vault
}

// ------------------------------------------------------------------ connection

export type ConnectionState =
  'unsupported' | 'not-connected' | 'permission-required' | 'permission-denied' | 'connected'

export interface VaultStatus {
  state: ConnectionState
  vaultName: string | null
  /** Whether this adapter can restore a connection after a reload. */
  restorable: boolean
  message: string
}

const STATE_MESSAGES: Record<ConnectionState, string> = {
  unsupported:
    'Obsidian filesystem access is not supported in this browser. Chromium-based browsers (Chrome, Edge, Arc, Brave) support it; Firefox and Safari do not.',
  'not-connected': 'No vault connected. Notes work normally without one.',
  'permission-required': 'Reconnect to grant access to this folder again.',
  'permission-denied': 'Access to this folder was denied.',
  connected: 'Connected.',
}

/**
 * What the vault is actually doing right now.
 *
 * Permission is *asked*, never inferred from the presence of a handle. A handle
 * survives a reload while its permission does not, so reporting "Connected"
 * because a handle exists is precisely the lie the milestone forbids.
 */
export async function getVaultStatus(): Promise<VaultStatus> {
  if (!vault.isSupported) {
    return {
      state: 'unsupported',
      vaultName: null,
      restorable: false,
      message: STATE_MESSAGES.unsupported,
    }
  }

  const connection = vault.current()
  if (connection === null) {
    return {
      state: 'not-connected',
      vaultName: null,
      restorable: false,
      message: STATE_MESSAGES['not-connected'],
    }
  }

  const permission = await vault.permission()
  const state: ConnectionState =
    permission === 'granted'
      ? 'connected'
      : permission === 'denied'
        ? 'permission-denied'
        : 'permission-required'

  return {
    state,
    vaultName: connection.name,
    restorable: connection.restorable,
    message: STATE_MESSAGES[state],
  }
}

export async function connectVault(options: ObsidianWriteOptions = {}): Promise<VaultStatus> {
  const source: EventSource = options.source ?? 'ui'
  const connection = await vault.connect()

  await eventBus.emit({
    type: 'obsidian.connected',
    entityType: 'vault',
    entityId: null,
    source,
    payload: { vault: connection.name, adapter: vault.id },
  })

  return getVaultStatus()
}

/**
 * Forgets the vault.
 *
 * The sync baselines go with it. Keeping them would mean that reconnecting to a
 * *different* folder would compare today's files against hashes recorded from
 * somebody else's vault, and report confident nonsense.
 */
export async function disconnectVault(options: ObsidianWriteOptions = {}): Promise<VaultStatus> {
  const source: EventSource = options.source ?? 'ui'
  const previous = vault.current()

  await vault.disconnect()
  const forgotten = await vaultLinkRepo.forgetAll()

  await eventBus.emit({
    type: 'obsidian.disconnected',
    entityType: 'vault',
    entityId: null,
    source,
    payload: { vault: previous?.name ?? null, baselinesCleared: forgotten },
  })

  return getVaultStatus()
}

/** Re-prompts for permission. Must come from a user gesture. */
export async function requestVaultPermission(): Promise<VaultStatus> {
  await vault.requestPermission()
  return getVaultStatus()
}

/**
 * Attempts to bring back a previously granted folder at startup.
 *
 * Emits nothing: restoring is not a user action, and a startup event on every
 * reload would drown the log. The status it returns is what the UI shows.
 */
export async function restoreVault(): Promise<VaultStatus> {
  if (!vault.isSupported) return getVaultStatus()
  await vault.restore()
  return getVaultStatus()
}

async function requireConnected(): Promise<VaultPermission> {
  const status = await getVaultStatus()
  if (status.state === 'unsupported') {
    throw new VaultError('unsupported', STATE_MESSAGES.unsupported)
  }
  if (status.state === 'not-connected') {
    throw new VaultError('not-connected', 'Connect an Obsidian vault first.')
  }
  if (status.state !== 'connected') {
    throw new VaultError('permission-denied', STATE_MESSAGES[status.state])
  }
  return 'granted'
}

// ---------------------------------------------------------------- serializing

/** A note as it would be written, given the tags it carries. */
export async function serializeNoteForVault(note: Note): Promise<string> {
  const names = await tagNames(note)

  const existing = await vaultLinkRepo.forEntity('note', note.id)
  // Unknown frontmatter is preserved by re-reading the file being replaced.
  let preserved
  if (existing && note.vaultPath !== null) {
    try {
      preserved = parseNoteFile(await vault.readFile(note.vaultPath)).frontmatter
    } catch {
      // The file may be gone; a fresh block is then correct.
      preserved = undefined
    }
  }

  return serializeNote(
    {
      id: note.id,
      title: noteTitle(note),
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    { tags: names, ...(preserved ? { existing: preserved } : {}) },
  )
}

/** Tag names for a note, resolved once. */
async function tagNames(note: Note): Promise<string[]> {
  const tags = await tagRepo.list()
  return note.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)
}

/**
 * The note as the conflict detector sees it.
 *
 * Deliberately *not* the bytes that would be written: those depend on the
 * file's own unknown frontmatter, which would make an external edit appear to
 * change the local side too. See `comparableContent`.
 */
export function comparableNoteProjection(note: Note, tags: string[]): string {
  return comparableFromNote(
    {
      id: note.id,
      title: noteTitle(note),
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    tags,
  )
}

async function comparableNote(note: Note): Promise<string> {
  return comparableFromNote(
    {
      id: note.id,
      title: noteTitle(note),
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
    await tagNames(note),
  )
}

// ------------------------------------------------------------------- status

export interface NoteSyncReport {
  noteId: Id
  vaultPath: string | null
  status: SyncStatus
  /** Present when the path itself is unusable. */
  pathError: string | null
  localHash: string | null
  remoteHash: string | null
  lastSyncedAt: number | null
}

/**
 * Compares one note against its file without writing anything.
 *
 * Reading for comparison is deliberately eventless: the milestone is explicit
 * that scanning and permission checks are not user-visible mutations, and an
 * event per comparison would make the log useless.
 */
export async function getNoteSyncReport(noteId: Id): Promise<NoteSyncReport> {
  const note = await noteRepo.getOrThrow(noteId)
  const baseline = await vaultLinkRepo.forEntity('note', noteId)
  const path = note.vaultPath

  const empty = (status: SyncStatus, pathError: string | null = null): NoteSyncReport => ({
    noteId,
    vaultPath: path,
    status,
    pathError,
    localHash: null,
    remoteHash: null,
    lastSyncedAt: baseline?.syncedAt ?? null,
  })

  if (path === null) return empty('not-exported')
  if (!isSafeVaultPath(path)) return empty('not-exported', `Unsafe vault path: ${path}`)

  const status = await getVaultStatus()
  if (status.state !== 'connected') return empty('not-exported')

  const local = await comparableNote(note)

  let raw: string | null = null
  try {
    raw = (await vault.exists(path)) ? await vault.readFile(path) : null
  } catch (error) {
    if (error instanceof VaultError && error.kind === 'permission-denied') throw error
    raw = null
  }

  const result = detectStatus({
    local,
    remote: raw === null ? null : comparableFromFile(raw, titleFromPath(path)),
    baseHash: baseline?.lastHashFile ?? null,
  })

  return {
    noteId,
    vaultPath: path,
    status: result.status,
    pathError: null,
    localHash: result.localHash,
    remoteHash: result.remoteHash,
    lastSyncedAt: baseline?.syncedAt ?? null,
  }
}

// ------------------------------------------------------------------- export

export interface ExportResult {
  noteId: Id
  vaultPath: string
  status: SyncStatus
  /** False when nothing was written, and `status` says why. */
  written: boolean
  message: string
}

export interface ExportOptions extends ObsidianWriteOptions {
  /**
   * Proceed even though the file changed externally.
   *
   * Only ever set from an explicit user choice in a conflict dialog. There is
   * no code path that sets it automatically, which is what makes "never
   * silently overwrite" a property of the design rather than a promise.
   */
  overwriteExternalChanges?: boolean
}

export async function exportNote(noteId: Id, options: ExportOptions = {}): Promise<ExportResult> {
  const source: EventSource = options.source ?? 'ui'
  await requireConnected()

  const note = await noteRepo.getOrThrow(noteId)
  if (note.vaultPath === null) {
    throw new VaultError('invalid-path', 'This note has no vault path.')
  }
  // Throws on traversal, an absolute path, or a non-Markdown extension.
  const path = assertSafeVaultPath(note.vaultPath)

  const report = await getNoteSyncReport(noteId)

  const blocked = report.status === 'conflict' || report.status === 'external-change'
  if (blocked && options.overwriteExternalChanges !== true) {
    await eventBus.emit({
      type: 'note.syncConflict',
      entityType: 'note',
      entityId: noteId,
      source,
      payload: { path, status: report.status },
    })

    return {
      noteId,
      vaultPath: path,
      status: report.status,
      written: false,
      message:
        report.status === 'conflict'
          ? 'Both this note and the vault file changed. Nothing was written.'
          : 'The vault file changed since the last sync. Nothing was written.',
    }
  }

  // Directories first, and idempotently — a real vault will not accept a file
  // into a folder that does not exist.
  for (const directory of parentDirectories(path)) {
    await vault.createDirectory(directory)
  }

  const contents = await serializeNoteForVault(note)
  await vault.writeFile(path, contents)

  // Read back rather than trusting what was sent: the file on disk is what the
  // next comparison sees, and an editor or filesystem may normalise it.
  let written = contents
  try {
    written = await vault.readFile(path)
  } catch {
    // A vault that cannot read back what it just wrote still wrote it; the
    // baseline falls back to what was sent.
  }

  const projection = await comparableNote(note)
  await vaultLinkRepo.record({
    entityType: 'note',
    entityId: noteId,
    path,
    lastHashApp: hashContent(projection),
    lastHashFile: hashContent(comparableFromFile(written, titleFromPath(path))),
    syncedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'note.exported',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { path, overwrote: blocked },
  })

  return {
    noteId,
    vaultPath: path,
    status: 'clean',
    written: true,
    message: `Exported to ${path}`,
  }
}

export interface BulkExportResult {
  exported: ExportResult[]
  skipped: ExportResult[]
  failed: { noteId: Id; message: string }[]
}

/**
 * Exports every live note.
 *
 * Additive by design: it writes notes, and never deletes a vault file that has
 * no note behind it. A file the user wrote in Obsidian is theirs, and a bulk
 * operation is the last place to start removing things.
 *
 * A note that conflicts is skipped and reported, not overwritten, and one that
 * fails does not abort the rest — a single unreadable file must not cost the
 * user the other two hundred exports.
 */
export async function exportAllNotes(
  options: ObsidianWriteOptions = {},
): Promise<BulkExportResult> {
  await requireConnected()

  const notes = await noteRepo.listLive()
  const result: BulkExportResult = { exported: [], skipped: [], failed: [] }

  for (const note of notes) {
    try {
      const outcome = await exportNote(note.id, options)
      if (outcome.written) result.exported.push(outcome)
      else result.skipped.push(outcome)
    } catch (error) {
      result.failed.push({
        noteId: note.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return result
}

// ------------------------------------------------------------------- import

export interface ImportPreview {
  path: string
  title: string
  /** The Vaultwork id in the file's frontmatter, when it has one. */
  fileNoteId: string | null
  /** The existing note that id refers to, when it still exists. */
  existingNoteId: Id | null
  existingTitle: string | null
  /** True when importing would replace content the user has not seen. */
  wouldOverwrite: boolean
  status: SyncStatus
  body: string
  tags: string[]
}

/**
 * What importing a file would do, without doing it.
 *
 * The milestone requires a confirmation step before anything destructive, and a
 * confirmation is only meaningful if the user is told what they are agreeing
 * to — so this returns the title, the source path, whether a matching note
 * exists and whether local content would be lost.
 */
export async function previewImport(path: string): Promise<ImportPreview> {
  await requireConnected()
  const safe = assertSafeVaultPath(path)

  const raw = await vault.readFile(safe)
  const parsed = parseNoteFile(raw)

  const existing = parsed.id === null ? undefined : ((await noteRepo.get(parsed.id)) ?? undefined)

  let status: SyncStatus = 'untracked'
  let wouldOverwrite = false

  if (existing) {
    const report = await getNoteSyncReport(existing.id)
    status = report.status
    // Local edits that the file does not contain would be replaced.
    wouldOverwrite = status === 'local-change' || status === 'conflict'
  }

  return {
    path: safe,
    title: parsed.title ?? titleFromPath(safe),
    fileNoteId: parsed.id,
    existingNoteId: existing?.id ?? null,
    existingTitle: existing ? noteTitle(existing) : null,
    wouldOverwrite,
    status,
    body: parsed.body,
    tags: parsed.tags,
  }
}

export interface ImportResult {
  noteId: Id
  path: string
  created: boolean
  message: string
}

export interface ImportOptions extends ObsidianWriteOptions {
  /** Required when the preview says local content would be replaced. */
  overwriteLocalChanges?: boolean
}

/**
 * Brings a vault file into Vaultwork.
 *
 * A file carrying a known Vaultwork id updates that note; anything else becomes
 * a new one with a fresh uuid. The id in the frontmatter is the identity —
 * never the title, never the path, both of which the user is free to change.
 */
export async function importNote(path: string, options: ImportOptions = {}): Promise<ImportResult> {
  const source: EventSource = options.source ?? 'ui'
  await requireConnected()
  const safe = assertSafeVaultPath(path)

  const preview = await previewImport(safe)

  if (preview.wouldOverwrite && options.overwriteLocalChanges !== true) {
    throw new VaultError(
      'write-failed',
      'This note has local changes that importing would replace. Confirm to continue.',
      safe,
    )
  }

  const raw = await vault.readFile(safe)

  let noteId: Id
  let created: boolean

  if (preview.existingNoteId !== null) {
    noteId = preview.existingNoteId
    created = false
    await updateNote(noteId, { title: preview.title, body: preview.body }, { source })
  } else {
    // A new note keeps the file's path rather than deriving one, so a round
    // trip does not move the user's file.
    const taken = (await noteRepo.takenVaultPaths()).filter((existing) => existing !== safe)
    const note = await createNote({ title: preview.title, body: preview.body }, { source })
    noteId = note.id
    created = true
    await noteRepo.update(note.id, { vaultPath: uniqueVaultPath(safe, taken) }, { emit: false })
  }

  const note = await noteRepo.getOrThrow(noteId)
  const projection = await comparableNote(note)
  await vaultLinkRepo.record({
    entityType: 'note',
    entityId: noteId,
    path: note.vaultPath ?? safe,
    lastHashApp: hashContent(projection),
    lastHashFile: hashContent(comparableFromFile(raw, titleFromPath(safe))),
    syncedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'note.imported',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { path: safe, created },
  })

  return {
    noteId,
    path: safe,
    created,
    message: created ? `Imported ${safe} as a new note` : `Updated from ${safe}`,
  }
}

// ------------------------------------------------------------------- rename

export interface RenameResult {
  noteId: Id
  from: string | null
  to: string
  /** True when the old file could not be removed and both now exist. */
  partial: boolean
  message: string
}

/**
 * Moves a note's file to match a new vault path.
 *
 * Ordered so that no step can lose content: write the destination first, verify
 * it, and only then remove the source. If the removal fails the note's path is
 * still updated — the destination is authoritative — but the result says
 * `partial` and names both files, because a filesystem is not a transaction and
 * pretending otherwise leaves the user with a duplicate they never hear about.
 */
export async function renameVaultFile(
  noteId: Id,
  nextPath: string,
  options: ObsidianWriteOptions = {},
): Promise<RenameResult> {
  const source: EventSource = options.source ?? 'ui'
  await requireConnected()

  const note = await noteRepo.getOrThrow(noteId)
  const to = assertSafeVaultPath(nextPath)
  const from = note.vaultPath

  if (from !== null && from === to) {
    return { noteId, from, to, partial: false, message: 'The path is unchanged.' }
  }

  if (await vault.exists(to)) {
    throw new VaultError('write-failed', `“${to}” already exists in the vault.`, to)
  }

  // 1. Destination directories, then the destination file.
  for (const directory of parentDirectories(to)) {
    await vault.createDirectory(directory)
  }

  const contents = await serializeNoteForVault(note)
  await vault.writeFile(to, contents)

  // 2. Verify the destination before touching the source.
  let verified: string
  try {
    verified = await vault.readFile(to)
  } catch {
    throw new VaultError(
      'write-failed',
      `Wrote “${to}” but could not read it back; the original was left alone.`,
      to,
    )
  }

  // 3. Only now remove the old file.
  let partial = false
  if (from !== null && (await vault.exists(from))) {
    try {
      await vault.deleteFile(from)
    } catch {
      partial = true
    }
  }

  await noteRepo.update(noteId, { vaultPath: to }, { emit: false })
  const renamedProjection = await comparableNote(await noteRepo.getOrThrow(noteId))
  await vaultLinkRepo.record({
    entityType: 'note',
    entityId: noteId,
    path: to,
    lastHashApp: hashContent(renamedProjection),
    lastHashFile: hashContent(comparableFromFile(verified, titleFromPath(to))),
    syncedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'note.vaultPathRenamed',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { from, to, partial },
  })

  return {
    noteId,
    from,
    to,
    partial,
    message: partial
      ? `Wrote ${to}, but ${from} could not be removed — both files now exist.`
      : `Moved to ${to}`,
  }
}

// ------------------------------------------------------------------- delete

export interface VaultDeleteResult {
  noteId: Id
  path: string
  deleted: boolean
  message: string
}

/**
 * Removes a note's file from the vault, on explicit request only.
 *
 * Never called because a note was deleted. Deleting a Vaultwork note is a
 * decision about Vaultwork; removing the user's file from their own vault is a
 * separate decision, and conflating them is how a soft delete becomes
 * irreversible data loss.
 *
 * A file that changed externally is refused unless the caller has explicitly
 * confirmed, for the same reason an export is.
 */
export async function deleteFromVault(
  noteId: Id,
  options: ObsidianWriteOptions & { force?: boolean } = {},
): Promise<VaultDeleteResult> {
  const source: EventSource = options.source ?? 'ui'
  await requireConnected()

  const note = await noteRepo.get(noteId, { includeDeleted: true })
  const baseline = await vaultLinkRepo.forEntity('note', noteId)
  const path = note?.vaultPath ?? baseline?.path ?? null

  if (path === null) throw new VaultError('invalid-path', 'This note has no vault file.')
  const safe = assertSafeVaultPath(path)

  if (!(await vault.exists(safe))) {
    await vaultLinkRepo.forget('note', noteId)
    return { noteId, path: safe, deleted: false, message: 'That file is not in the vault.' }
  }

  // Refuse to remove something the user changed and has not seen reconciled.
  const current = hashContent(comparableFromFile(await vault.readFile(safe), titleFromPath(safe)))
  const changedExternally = baseline !== undefined && current !== baseline.lastHashFile

  if (changedExternally && options.force !== true) {
    return {
      noteId,
      path: safe,
      deleted: false,
      message: 'That file changed in Obsidian since the last sync. It was not deleted.',
    }
  }

  await vault.deleteFile(safe)
  await vaultLinkRepo.forget('note', noteId)

  await eventBus.emit({
    type: 'note.vaultFileDeleted',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { path: safe, forced: changedExternally },
  })

  return { noteId, path: safe, deleted: true, message: `Deleted ${safe} from the vault` }
}

// --------------------------------------------------------------------- scan

export interface VaultScan {
  reports: NoteSyncReport[]
  /** Markdown files in the vault with no note behind them. */
  untracked: string[]
  counts: Record<SyncStatus, number>
  /**
   * Folders the walk could not read, and why.
   *
   * Present because the alternative is worse: a scan that cannot open the vault
   * and reports "no files" is indistinguishable from an empty vault, and the
   * user has no way to tell which they are looking at. A folder that fails is
   * named here; a vault that fails outright throws.
   */
  errors: ScanError[]
  /**
   * What the walk passed over.
   *
   * A folder of PDFs and an empty folder both produce zero untracked files, and
   * they are very different situations to be in. Counting the skips lets the
   * screen tell them apart instead of reporting "nothing to do" for both.
   */
  skipped: SkippedSummary
  /**
   * PDF files in the vault that Vaultwork has not read yet.
   *
   * Reported here so the Obsidian page can say what is there. Importing one is
   * a Sync Center decision — there is one plan → review → apply path, and this
   * screen points at it rather than growing a second.
   */
  untrackedDocuments: string[]
  /** How many of each readable kind the walk saw. */
  seen: { markdown: number; pdf: number }
  scannedAt: number
}

const EMPTY_COUNTS = (): Record<SyncStatus, number> => ({
  clean: 0,
  'local-change': 0,
  'external-change': 0,
  conflict: 0,
  'not-exported': 0,
  missing: 0,
  untracked: 0,
  moved: 0,
  'moved-change': 0,
  'duplicate-id': 0,
  'path-collision': 0,
  'deleted-local': 0,
  ignored: 0,
  error: 0,
})

/**
 * Compares every note against the vault, and finds vault files with no note.
 *
 * Explicitly triggered — nothing scans on render, and nothing scans on a timer.
 * A scan reads every managed file, which is far too expensive to happen because
 * a component re-rendered.
 *
 * Writes nothing and emits nothing. This is what a "Sync" button runs *before*
 * offering to do anything, so that the user sees the state before choosing.
 */
export async function scanVault(): Promise<VaultScan> {
  await requireConnected()

  const notes = await noteRepo.listLive()
  const reports: NoteSyncReport[] = []
  const counts = EMPTY_COUNTS()

  for (const note of notes) {
    const report = await getNoteSyncReport(note.id)
    reports.push(report)
    counts[report.status] += 1
  }

  const claimed = new Set(
    reports.map((report) => report.vaultPath).filter((path): path is string => path !== null),
  )

  // Documents already read, so a second scan does not offer them again.
  const knownDocuments = new Set(
    (await vaultDocumentRepo.listLive()).map((row) => row.vaultPath.toLowerCase()),
  )

  const untracked: string[] = []
  const untrackedDocuments: string[] = []
  const errors: ScanError[] = []
  const skipped = EMPTY_SKIPPED()
  const seen = { markdown: 0, pdf: 0 }
  const walk = async (directory: string, depth: number): Promise<void> => {
    // A vault can be large and deeply nested; the cap keeps a scan bounded and
    // is far beyond any sane note hierarchy.
    if (depth > 8) return
    let entries
    try {
      entries = await vault.listDirectory(directory)
    } catch (error) {
      /*
       * A folder that cannot be read is reported, never swallowed.
       *
       * This used to `return` silently, which turned every failure — a vault
       * that is no longer connected, a folder the OS refuses, a path that
       * moved — into "0 files". The user then saw an empty vault they knew was
       * not empty, with nothing to act on. The same walk in
       * `obsidianSyncService` has always collected these; this one now agrees.
       *
       * Permission trouble is fatal rather than partial: if the vault root
       * cannot be opened, a count of what was found is meaningless, and the
       * honest answer is the error the adapter gave.
       */
      if (error instanceof VaultError && error.kind === 'permission-denied') throw error
      errors.push({
        path: directory.length === 0 ? '/' : directory,
        message: error instanceof Error ? error.message : 'Could not read this folder.',
      })
      return
    }

    for (const entry of entries) {
      // Obsidian's own config folder is not the user's notes.
      if (entry.name.startsWith('.')) {
        if (entry.kind === 'directory') skipped.ignoredDirectories += 1
        continue
      }
      if (entry.kind === 'directory') {
        await walk(entry.path, depth + 1)
      } else if (isMarkdownFile(entry.name)) {
        seen.markdown += 1
        if (!claimed.has(entry.path)) untracked.push(entry.path)
      } else if (isPdfFile(entry.name)) {
        seen.pdf += 1
        if (!knownDocuments.has(entry.path.toLowerCase())) untrackedDocuments.push(entry.path)
      } else {
        // A real file the user put here that is simply not a note.
        skipped.nonMarkdown += 1
        if (skipped.examples.length < SKIPPED_EXAMPLES) skipped.examples.push(entry.name)
      }
    }
  }
  await walk('', 0)

  counts.untracked = untracked.length

  return {
    reports,
    untracked,
    untrackedDocuments,
    seen,
    counts,
    errors,
    skipped,
    scannedAt: platform.clock.now(),
  }
}

// ---------------------------------------------------------------- wikilinks

export interface NoteWikilink {
  target: string
  status: 'resolved' | 'unresolved' | 'ambiguous'
  noteId: Id | null
  title: string | null
}

/**
 * The wikilinks in a note's body, resolved against the notes that exist.
 *
 * Read-only, and deliberately so. A resolved wikilink is *not* turned into a
 * `noteLinks` row: that table is the canonical relationship system, its rows
 * are created by an explicit user action, and manufacturing edges from prose
 * would fill it with relationships nobody asked for. Note-to-note links would
 * also need a schema change, which belongs in a later milestone rather than
 * being smuggled in here.
 */
export async function resolveNoteWikilinks(noteId: Id): Promise<NoteWikilink[]> {
  const note = await noteRepo.getOrThrow(noteId)
  const targets = wikilinkTargets(note.body)
  if (targets.length === 0) return []

  const notes = await noteRepo.listLive()
  const candidates = notes
    .filter((row) => row.id !== noteId)
    .map((row) => ({ id: row.id, title: noteTitle(row), vaultPath: row.vaultPath }))

  return targets.map((target) => {
    const resolution = resolveWikilink(target, candidates)
    if (resolution.status === 'resolved') {
      return {
        target,
        status: 'resolved' as const,
        noteId: resolution.noteId,
        title: resolution.title,
      }
    }
    return { target, status: resolution.status, noteId: null, title: null }
  })
}

/** The path a note would reserve for its current title and tags. */
export async function suggestedVaultPath(noteId: Id): Promise<string> {
  const note = await noteRepo.getOrThrow(noteId)
  const tags = await tagRepo.list()
  const names = note.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)

  const taken = (await noteRepo.takenVaultPaths()).filter((path) => path !== note.vaultPath)
  return uniqueVaultPath(buildVaultPath({ title: noteTitle(note), tags: names }), taken)
}
