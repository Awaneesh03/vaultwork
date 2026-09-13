import { hashContent } from '@/integrations/obsidian/content'
import { comparableFromFile, parseNoteFile, titleFromPath } from '@/integrations/obsidian/noteFile'
import { markdownExcerpt } from '@/lib/markdown'
import {
  buildSyncPlan,
  basenameWithoutExtension,
  fileKindOf,
  isIgnoredDirectory,
  isIgnoredFile,
  orderedForApply,
  EMPTY_SKIPPED,
  SKIPPED_EXAMPLES,
  type LocalNote,
  type ScanError,
  type ScannedFile,
  type SyncBaseline,
  type SyncDecision,
  type LocalDocument,
  type SkippedSummary,
  type SyncItem,
  type SyncPlan,
} from '@/integrations/obsidian/syncPlan'
import { assertSafeVaultPath, isSafeVaultPath } from '@/integrations/obsidian/vaultPath'
import { platform } from '@/platform'
import { VaultError, type VaultPort } from '@/platform'
import { noteRepo, tagRepo, vaultDocumentRepo, vaultLinkRepo } from '@/repositories'
import type { Id, VaultDocument } from '@/types/entities'
import type { EventSource } from '@/types/enums'
import { eventBus } from './eventBus'
import { createNote, noteTitle, updateNote } from './noteService'
import {
  comparableNoteProjection,
  deleteFromVault,
  getVaultPort,
  getVaultStatus,
  serializeNoteForVault,
} from './obsidianService'

/**
 * The bidirectional sync workflow.
 *
 * Two operations, kept rigidly apart:
 *
 *   `scanVault()`   reads, classifies, and returns a `SyncPlan`. It writes
 *                   nothing — not a file, not a note, not a baseline, not an
 *                   event. A plan is a *description*, and a description that
 *                   quietly changed things would be unusable as one.
 *
 *   `applySync()`   takes that plan plus the user's decisions and performs
 *                   them, re-checking the filesystem for every single item
 *                   first.
 *
 * That re-check is the part that matters most. A plan is a photograph of a
 * moment; by the time the user has read it, Obsidian may have saved the file
 * again. Applying a stale plan is precisely how a sync tool eats an edit the
 * user made thirty seconds ago, so every item is re-read and re-classified
 * immediately before it is touched, and abandoned if the world moved.
 */

export interface SyncOptions {
  source?: EventSource
}

const vault = (): VaultPort => getVaultPort()

/** How deep a vault may nest before the scan stops descending. */
const MAX_DEPTH = 12

/**
 * The first readable line or two of a PDF, for the decision row.
 *
 * Extracted PDF text is ragged — page numbers, headers, hyphenation — so this
 * collapses whitespace and takes a short prefix. It is a preview, never the
 * document.
 */
function pdfExcerpt(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()}…`
}

// --------------------------------------------------------------------- scan

interface ScanCollector {
  files: ScannedFile[]
  errors: ScanError[]
  /** What was passed over, so a scan of a folder with no notes can say so. */
  skipped: SkippedSummary
}

/**
 * Records a name the walk chose not to read.
 *
 * Only files the user would recognise as *theirs*. A `.DS_Store` or an editor's
 * scratch file is noise nobody put there on purpose, and counting it would turn
 * "none of these are notes" into a number the user cannot make sense of.
 */
function noteSkipped(into: ScanCollector, name: string): void {
  if (name.startsWith('.') || fileKindOf(name) !== null) return
  into.skipped.nonMarkdown += 1
  if (into.skipped.examples.length < SKIPPED_EXAMPLES) into.skipped.examples.push(name)
}

/**
 * Walks the vault, reading every Markdown file once.
 *
 * One read per file, and only metadata is kept: id, title, tags, a short
 * excerpt and the hash of the comparable projection. The bodies are deliberately
 * discarded — a ten-thousand-note vault would otherwise hold ten thousand
 * documents in memory for a screen that shows twenty rows.
 *
 * A file that cannot be read is recorded as an error and the walk continues.
 * One unreadable file must not cost the user the other ninety-nine.
 */
async function walkVault(directory: string, depth: number, into: ScanCollector): Promise<void> {
  if (depth > MAX_DEPTH) return

  let entries
  try {
    entries = await vault().listDirectory(directory)
  } catch (error) {
    if (error instanceof VaultError && error.kind === 'permission-denied') throw error
    into.errors.push({
      path: directory.length === 0 ? '/' : directory,
      message: error instanceof Error ? error.message : 'Could not list this folder.',
    })
    return
  }

  for (const entry of entries) {
    if (entry.kind === 'directory') {
      // Ignored folders are never opened, never read, never touched.
      if (isIgnoredDirectory(entry.name)) {
        into.skipped.ignoredDirectories += 1
        continue
      }
      await walkVault(entry.path, depth + 1, into)
      continue
    }

    if (isIgnoredFile(entry.name)) {
      noteSkipped(into, entry.name)
      continue
    }

    const kind = fileKindOf(entry.name)
    // `isIgnoredFile` already excluded everything else; this is the type
    // narrowing that follows from it, not a second policy.
    if (kind === null) continue

    // The same traversal check for both kinds, differing only in the suffix it
    // insists on — a PDF must not become a route around a rule Markdown obeys.
    if (!isSafeVaultPath(entry.path, { extension: 'document' })) {
      into.errors.push({ path: entry.path, message: 'Unsafe path; skipped.' })
      continue
    }

    try {
      if (kind === 'pdf') {
        /*
         * A PDF is read for its text and nothing else.
         *
         * The extraction happens in the adapter — natively, on the desktop —
         * and only text crosses back. The hash is taken over that text, so a
         * file re-saved with identical content is not a change, and a file
         * whose text moved is.
         */
        const extracted = await vault().readPdfText(entry.path)
        into.files.push({
          path: entry.path,
          kind: 'pdf',
          id: null,
          title: basenameWithoutExtension(entry.path),
          tags: [],
          excerpt: pdfExcerpt(extracted.text),
          hash: hashContent(extracted.text),
          updatedAt: null,
          bytes: extracted.bytes,
        })
        // `continue`, not `return`: this is a loop over one folder's entries,
        // and returning here would abandon every file after the first PDF.
        continue
      }

      const raw = await vault().readFile(entry.path)
      const parsed = parseNoteFile(raw)
      into.files.push({
        path: entry.path,
        kind: 'note',
        id: parsed.id,
        title: parsed.title,
        tags: parsed.tags,
        excerpt: markdownExcerpt(parsed.body, 120),
        hash: hashContent(comparableFromFile(raw, titleFromPath(entry.path))),
        updatedAt: parsed.updatedAt,
      })
    } catch (error) {
      if (error instanceof VaultError && error.kind === 'permission-denied') throw error
      into.errors.push({
        path: entry.path,
        message: error instanceof Error ? error.message : 'Could not read this file.',
      })
    }
  }
}

/** Every note, reduced to what classification needs. One pass, no N+1. */
async function collectNotes(): Promise<LocalNote[]> {
  const [live, trashed, tags] = await Promise.all([
    noteRepo.listLive(),
    noteRepo.listTrashed(),
    tagRepo.list(),
  ])

  const tagName = new Map(tags.map((tag) => [tag.id, tag.name]))

  return [...live, ...trashed].map((note) => ({
    id: note.id,
    title: noteTitle(note),
    vaultPath: note.vaultPath,
    hash: hashContent(
      comparableNoteProjection(
        note,
        note.tagIds
          .map((id) => tagName.get(id))
          .filter((name): name is string => name !== undefined),
      ),
    ),
    updatedAt: note.updatedAt,
    deleted: note.deletedAt !== null,
  }))
}

/** Every document Vaultwork has read, reduced to what classification needs. */
async function collectDocuments(): Promise<LocalDocument[]> {
  const rows = await vaultDocumentRepo.listLive()
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    vaultPath: row.vaultPath,
    hash: row.hash,
    updatedAt: row.updatedAt,
    deleted: row.deletedAt !== null,
  }))
}

async function collectBaselines(): Promise<SyncBaseline[]> {
  const rows = await vaultLinkRepo.listLive()
  return rows
    .filter((row) => row.entityType === 'note')
    .map((row) => ({
      noteId: row.entityId,
      path: row.path,
      lastHashApp: row.lastHashApp ?? '',
      lastHashFile: row.lastHashFile ?? '',
      syncedAt: row.syncedAt ?? 0,
    }))
}

export class VaultUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultUnavailableError'
  }
}

async function requireVault(): Promise<void> {
  const status = await getVaultStatus()
  if (status.state !== 'connected') throw new VaultUnavailableError(status.message)
}

/**
 * Reads the vault and returns what it found. Changes nothing.
 *
 * Explicitly triggered — never on a render, never on a timer. A scan reads
 * every managed file, which is far too expensive to happen because a component
 * re-rendered.
 */
export async function scanVaultPlan(): Promise<SyncPlan> {
  await requireVault()

  const collector: ScanCollector = { files: [], errors: [], skipped: EMPTY_SKIPPED() }
  await walkVault('', 0, collector)

  const [notes, documents, baselines] = await Promise.all([
    collectNotes(),
    collectDocuments(),
    collectBaselines(),
  ])

  return buildSyncPlan({
    notes,
    documents,
    files: collector.files,
    baselines,
    errors: collector.errors,
    scannedAt: platform.clock.now(),
    skipped: collector.skipped,
  })
}

// -------------------------------------------------------------------- apply

export type SyncOutcome = 'applied' | 'skipped' | 'stale' | 'failed'

export interface SyncItemResult {
  key: string
  noteId: Id | null
  path: string | null
  decision: SyncDecision
  outcome: SyncOutcome
  message: string
}

export interface SyncResult {
  imported: number
  exported: number
  moved: number
  deleted: number
  forgotten: number
  skipped: number
  stale: number
  failed: number
  items: SyncItemResult[]
  finishedAt: number
}

const EMPTY_RESULT = (): SyncResult => ({
  imported: 0,
  exported: 0,
  moved: 0,
  deleted: 0,
  forgotten: 0,
  skipped: 0,
  stale: 0,
  failed: 0,
  items: [],
  finishedAt: 0,
})

/**
 * Re-reads one item's file and reports whether the plan still describes it.
 *
 * This is the concurrency guard. It runs immediately before every write and
 * every delete, and compares against the hash the *plan* recorded — so a file
 * saved by Obsidian in the meantime is caught, and the operation is abandoned
 * rather than performed on a document nobody has looked at.
 */
async function isStale(item: SyncItem): Promise<boolean> {
  if (item.path === null) return false

  /*
   * A PDF is re-extracted rather than re-read as text: `readFile` would return
   * bytes interpreted as a string, whose hash has nothing to do with the hash
   * the plan recorded, and every document would look stale forever.
   */
  if (item.itemKind === 'document') {
    try {
      if (!(await vault().exists(item.path))) return item.fileHash !== null
      const extracted = await vault().readPdfText(item.path)
      return hashContent(extracted.text) !== item.fileHash
    } catch (error) {
      if (error instanceof VaultError && error.kind === 'permission-denied') throw error
      return true
    }
  }

  let current: string | null = null
  try {
    current = (await vault().exists(item.path)) ? await vault().readFile(item.path) : null
  } catch (error) {
    if (error instanceof VaultError && error.kind === 'permission-denied') throw error
    return true
  }

  const hash =
    current === null ? null : hashContent(comparableFromFile(current, titleFromPath(item.path)))

  return hash !== item.fileHash
}

/** Tag names for a note, so a write carries what the file should say. */
async function tagNamesFor(noteId: Id): Promise<string[]> {
  const [note, tags] = await Promise.all([noteRepo.get(noteId), tagRepo.list()])
  if (!note) return []
  return note.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)
}

/** Writes a note to a path and records the baseline. Shared by four decisions. */
async function writeNoteTo(noteId: Id, path: string, source: EventSource): Promise<void> {
  const safe = assertSafeVaultPath(path)
  const note = await noteRepo.getOrThrow(noteId)

  for (const directory of parentsOf(safe)) await vault().createDirectory(directory)

  const contents = await serializeNoteForVault(note)
  await vault().writeFile(safe, contents)

  let written = contents
  try {
    written = await vault().readFile(safe)
  } catch {
    // It was written; the baseline falls back to what was sent.
  }

  await vaultLinkRepo.record({
    entityType: 'note',
    entityId: noteId,
    path: safe,
    lastHashApp: hashContent(comparableNoteProjection(note, await tagNamesFor(noteId))),
    lastHashFile: hashContent(comparableFromFile(written, titleFromPath(safe))),
    syncedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'note.exported',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { path: safe },
  })
}

function parentsOf(path: string): string[] {
  const segments = path.split('/')
  segments.pop()
  const out: string[] = []
  let current = ''
  for (const segment of segments) {
    current = current.length === 0 ? segment : `${current}/${segment}`
    out.push(current)
  }
  return out
}

/**
 * Reads a vault file into a note — creating one when the file has no id.
 *
 * The note's `id` is never replaced, and its `vaultPath` is only set for a note
 * being created. Accepting an external edit is a decision about *content*;
 * moving a file is a separate decision with its own action.
 */
async function importFileInto(
  item: SyncItem,
  source: EventSource,
): Promise<{ noteId: Id; created: boolean }> {
  const path = assertSafeVaultPath(item.path as string)
  const raw = await vault().readFile(path)
  const parsed = parseNoteFile(raw)

  const title = parsed.title ?? titleFromPath(path)
  let noteId = item.noteId
  let created = false

  if (noteId === null) {
    // A file with no id becomes a new note keeping its own path, so a round
    // trip never moves the user's file.
    const note = await createNote({ title, body: parsed.body }, { source })
    noteId = note.id
    created = true
    const taken = (await noteRepo.takenVaultPaths()).filter((row) => row !== path)
    await noteRepo.update(
      note.id,
      { vaultPath: taken.includes(path) ? note.vaultPath : path },
      { emit: false },
    )
  } else {
    await updateNote(noteId, { title, body: parsed.body }, { source })
  }

  const note = await noteRepo.getOrThrow(noteId)
  await vaultLinkRepo.record({
    entityType: 'note',
    entityId: noteId,
    path: note.vaultPath ?? path,
    lastHashApp: hashContent(comparableNoteProjection(note, await tagNamesFor(noteId))),
    lastHashFile: hashContent(comparableFromFile(raw, titleFromPath(path))),
    syncedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'note.imported',
    entityType: 'note',
    entityId: noteId,
    source,
    payload: { path, created },
  })

  return { noteId, created }
}

/**
 * Reads one PDF into a document row.
 *
 * Read-only with respect to the vault, permanently and by construction: this
 * calls `readPdfText` and nothing else, and there is no adapter method that
 * could write a PDF even if a later decision wanted to. Re-reading a document
 * replaces the extracted text on the existing row rather than adding a second
 * one, so the `&vaultPath` uniqueness in the schema is never even approached.
 */
async function importDocumentFrom(
  item: SyncItem,
  source: EventSource,
): Promise<{ documentId: Id; created: boolean }> {
  const path = assertSafeVaultPath(item.path as string, { extension: '.pdf' })
  const extracted = await vault().readPdfText(path)

  const title = basenameWithoutExtension(path)
  const hash = hashContent(extracted.text)
  const now = platform.clock.now()

  // "Why is there no text" is recorded, not inferred. There is no OCR here, and
  // an empty string with no explanation is indistinguishable from a bug.
  const extraction: VaultDocument['extraction'] = extracted.truncated
    ? 'truncated'
    : extracted.empty
      ? 'empty'
      : 'ok'

  const fields = {
    title,
    vaultPath: path,
    kind: 'pdf' as const,
    text: extracted.text,
    extraction,
    chars: extracted.chars,
    bytes: extracted.bytes,
    hash,
    importedAt: now,
  }

  const existing =
    item.documentId != null
      ? ((await vaultDocumentRepo.get(item.documentId)) ?? null)
      : ((await vaultDocumentRepo.byPath(path)) ?? null)

  const document =
    existing === null
      ? await vaultDocumentRepo.create(fields, { source })
      : await vaultDocumentRepo.update(existing.id, fields, { source })

  // The same baseline table notes use. A document is a different domain object,
  // not a different integration.
  await vaultLinkRepo.record({
    entityType: 'document',
    entityId: document.id,
    path,
    // Vaultwork never writes a PDF, so both sides of the baseline are the file.
    lastHashApp: hash,
    lastHashFile: hash,
    syncedAt: now,
  })

  await eventBus.emit({
    type: 'document.imported',
    entityType: 'document',
    entityId: document.id,
    source,
    payload: { path, created: existing === null, extraction, chars: extracted.chars },
  })

  return { documentId: document.id, created: existing === null }
}

/**
 * Performs the user's decisions.
 *
 * Every item is independent: one failure never aborts the batch, and a
 * successful item's baseline is recorded whether or not its neighbours worked.
 * A filesystem is not a transaction, and rolling back the eight files that did
 * write would be a second set of destructive operations pretending to be
 * safety.
 */
export async function applySync(
  plan: SyncPlan,
  decisions: Record<string, SyncDecision>,
  options: SyncOptions = {},
): Promise<SyncResult> {
  await requireVault()

  const source: EventSource = options.source ?? 'ui'
  const result = EMPTY_RESULT()

  const record = (
    item: SyncItem,
    decision: SyncDecision,
    outcome: SyncOutcome,
    message: string,
  ) => {
    result.items.push({
      key: item.key,
      noteId: item.noteId,
      path: item.path,
      decision,
      outcome,
      message,
    })
    if (outcome === 'stale') result.stale += 1
    if (outcome === 'failed') result.failed += 1
    if (outcome === 'skipped') result.skipped += 1
  }

  for (const { item, decision } of orderedForApply(plan, decisions)) {
    try {
      // Permission can be revoked between two items; stop rather than
      // continuing blindly into a wall of identical failures.
      const status = await getVaultStatus()
      if (status.state !== 'connected') {
        record(item, decision, 'failed', status.message)
        break
      }

      // The mandatory re-read. `forget-link` touches no file, so it is the one
      // decision that does not need it.
      if (decision !== 'forget-link' && (await isStale(item))) {
        record(
          item,
          decision,
          'stale',
          'That file changed since the scan. Nothing was written — scan again.',
        )
        continue
      }

      /*
       * Documents take their own short branch.
       *
       * Only three decisions are reachable for one — import, forget, skip —
       * because Vaultwork cannot write a PDF, so export, keep-local, move and
       * delete-from-vault have no meaning here. Routing before the switch keeps
       * that fact in one place instead of as a guard inside six cases.
       */
      if (item.itemKind === 'document') {
        if (decision === 'import' || decision === 'keep-external') {
          const outcome = await importDocumentFrom(item, source)
          result.imported += 1
          record(
            item,
            decision,
            'applied',
            outcome.created ? 'Imported as a new document' : 'Re-read from the vault',
          )
        } else if (decision === 'forget-link') {
          if (item.documentId == null) {
            record(item, decision, 'failed', 'Nothing to forget.')
          } else {
            // Stops tracking and removes what Vaultwork read. The PDF itself is
            // never touched — forgetting a document is not deleting a file.
            await vaultLinkRepo.forget('document', item.documentId)
            await vaultDocumentRepo.softDelete(item.documentId, { source })
            result.forgotten += 1
            record(item, decision, 'applied', 'Stopped tracking this document')
          }
        } else {
          record(item, decision, 'skipped', 'Skipped')
        }
        continue
      }

      switch (decision) {
        case 'import':
        case 'keep-external': {
          const outcome = await importFileInto(item, source)
          result.imported += 1
          record(
            item,
            decision,
            'applied',
            outcome.created ? 'Imported as a new note' : 'Updated from the vault',
          )
          break
        }

        case 'export':
        case 'keep-local':
        case 'restore-to-vault': {
          const target = item.noteId === null ? null : await noteRepo.get(item.noteId)
          if (!target || target.vaultPath === null) {
            record(item, decision, 'failed', 'That note no longer has a vault path.')
            break
          }
          // `keep-local` on a moved file writes to where the file *is*, so a
          // move plus an edit does not leave two copies behind.
          const path =
            decision === 'keep-local' ? (item.path ?? target.vaultPath) : target.vaultPath
          await writeNoteTo(target.id, path, source)
          if (path !== target.vaultPath) {
            await noteRepo.update(target.id, { vaultPath: path }, { emit: false })
          }
          result.exported += 1
          record(item, decision, 'applied', `Exported to ${path}`)
          break
        }

        case 'accept-move': {
          if (item.noteId === null || item.path === null) {
            record(item, decision, 'failed', 'Nothing to move.')
            break
          }
          // The file already lives at its new path; only Vaultwork's record of
          // where it is needs to catch up. No file is written or removed.
          await noteRepo.update(item.noteId, { vaultPath: item.path }, { emit: false })
          const note = await noteRepo.getOrThrow(item.noteId)
          await vaultLinkRepo.record({
            entityType: 'note',
            entityId: item.noteId,
            path: item.path,
            lastHashApp: hashContent(
              comparableNoteProjection(note, await tagNamesFor(item.noteId)),
            ),
            lastHashFile: item.fileHash ?? '',
            syncedAt: platform.clock.now(),
          })
          await eventBus.emit({
            type: 'note.vaultPathRenamed',
            entityType: 'note',
            entityId: item.noteId,
            source,
            payload: { from: item.previousPath, to: item.path, accepted: true },
          })
          result.moved += 1
          record(item, decision, 'applied', `Now tracking ${item.path}`)
          break
        }

        case 'delete-from-vault': {
          if (item.noteId === null) {
            record(item, decision, 'failed', 'Nothing to delete.')
            break
          }
          const outcome = await deleteFromVault(item.noteId, { source, force: true })
          if (outcome.deleted) result.deleted += 1
          record(item, decision, outcome.deleted ? 'applied' : 'failed', outcome.message)
          break
        }

        case 'forget-link': {
          if (item.noteId === null) {
            record(item, decision, 'failed', 'Nothing to forget.')
            break
          }
          // Stops tracking. No file is touched and no note is deleted.
          await vaultLinkRepo.forget('note', item.noteId)
          result.forgotten += 1
          record(item, decision, 'applied', 'Stopped tracking this file')
          break
        }

        case 'skip':
          record(item, decision, 'skipped', 'Skipped')
          break
      }
    } catch (error) {
      // The baseline is only ever written on the success path, so a failure
      // here leaves this item exactly as the next scan will find it.
      record(
        item,
        decision,
        'failed',
        error instanceof Error ? error.message : 'Something went wrong.',
      )
    }
  }

  result.finishedAt = platform.clock.now()
  return result
}

export interface SyncComparison {
  title: string
  /** The note as it stands now. */
  local: string
  /** The vault file as it stands now. */
  external: string
}

/**
 * The two versions of one item, fetched for a comparison.
 *
 * Read on demand rather than carried in the plan: a vault of ten thousand notes
 * would otherwise hold twenty thousand documents in memory so that the user
 * could look at one of them.
 */
export async function loadComparison(item: SyncItem): Promise<SyncComparison> {
  await requireVault()

  const note = item.noteId === null ? undefined : await noteRepo.get(item.noteId)
  const local = note?.body ?? ''

  let external = ''
  if (item.path !== null) {
    try {
      external = parseNoteFile(await vault().readFile(item.path)).body
    } catch {
      external = ''
    }
  }

  return { title: item.title, local, external }
}

/** A one-line summary of what actually happened, never "everything synced". */
export function describeSyncResult(result: SyncResult): string {
  const parts: string[] = []
  if (result.imported > 0) parts.push(`${result.imported} imported`)
  if (result.exported > 0) parts.push(`${result.exported} exported`)
  if (result.moved > 0) parts.push(`${result.moved} moved`)
  if (result.deleted > 0) parts.push(`${result.deleted} deleted`)
  if (result.forgotten > 0) parts.push(`${result.forgotten} untracked`)
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
  if (result.stale > 0) parts.push(`${result.stale} changed since the scan`)
  if (result.failed > 0) parts.push(`${result.failed} failed`)

  return parts.length === 0 ? 'Nothing to do' : parts.join(' · ')
}
