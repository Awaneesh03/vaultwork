import { detectStatusFromHashes, type SyncStatus } from './conflict'

/**
 * Classifying a whole vault, as pure functions.
 *
 * Nothing here reads a file, touches Dexie or knows what React is: it is given
 * three lists — the notes, the scanned files, the recorded baselines — and
 * returns a description of what *would* happen. That is what makes the six
 * classification cases assertable directly, and it is what makes a `SyncPlan`
 * safe to hand to a component.
 *
 * The plan deliberately carries **hashes and metadata, not bodies.** A vault of
 * ten thousand notes would otherwise put ten thousand Markdown documents into
 * React state; full text is re-read on demand, for the one item being previewed
 * or applied.
 */

// --------------------------------------------------------------- ignore rules

/**
 * What a scan will not look at.
 *
 * Conservative on purpose: anything skipped here is simply left alone — never
 * read, never written, never deleted. Obsidian keeps its configuration,
 * workspace layout and plugin data in `.obsidian/`, and other tools scatter
 * their own dot-folders about; none of it is a note, and interpreting any of it
 * would be Vaultwork inventing meaning it does not have.
 */
export const IGNORED_DIRECTORIES = ['.obsidian', '.trash', '.git', 'node_modules']

/** Editor and sync scratch files that appear and vanish. */
const TEMPORARY = /(^~\$|^\.~|\.tmp$|\.swp$|\.crswap$|^conflicted copy)/i

export function isIgnoredDirectory(name: string): boolean {
  // Every dot-folder, not only the ones named above: a directory the user hid
  // is not a place to go rummaging.
  return name.startsWith('.') || IGNORED_DIRECTORIES.includes(name)
}

export function isMarkdownFile(name: string): boolean {
  return /\.md$/i.test(name)
}

/**
 * A PDF, by extension, case-insensitively.
 *
 * `.pdf`, `.PDF` and `.Pdf` are one file to every filesystem this runs on, and
 * a vault assembled by hand over years contains all three.
 */
export function isPdfFile(name: string): boolean {
  return /\.pdf$/i.test(name)
}

/** The two document kinds Vaultwork can read out of a vault. */
export type VaultFileKind = 'note' | 'pdf'

/** Which kind a file is, or null when it is neither. */
export function fileKindOf(name: string): VaultFileKind | null {
  if (isMarkdownFile(name)) return 'note'
  if (isPdfFile(name)) return 'pdf'
  return null
}

/**
 * True when a scan should skip this file entirely.
 *
 * Markdown and PDF are read; everything else is left alone. An image, a video
 * or a `.canvas` is somebody's file that Vaultwork has no business interpreting
 * — it is counted as skipped so the UI can say what it saw, and never touched.
 */
export function isIgnoredFile(name: string): boolean {
  if (name.startsWith('.')) return true
  if (TEMPORARY.test(name)) return true
  return fileKindOf(name) === null
}

// ------------------------------------------------------------------- inputs

/** A Markdown file as the scanner found it. Metadata only — never the body. */
export interface ScannedFile {
  path: string
  /** The Vaultwork id from frontmatter, when the file carries one. */
  id: string | null
  title: string | null
  tags: string[]
  /** A short preview, for the decision UI. Not the document. */
  excerpt: string
  /** Hash of the comparable projection. */
  hash: string
  updatedAt: number | null
  /**
   * Which kind of document this file is.
   *
   * Optional so every existing caller and fixture keeps working and keeps
   * meaning what it meant: a file with no kind is a Markdown note, which is
   * what every file in this model was before PDFs existed.
   */
  kind?: VaultFileKind
  /** PDF only: size on disk, part of what makes a change detectable. */
  bytes?: number
}

/** A PDF Vaultwork has already read, reduced to what classification needs. */
export interface LocalDocument {
  id: string
  title: string
  vaultPath: string
  /** Hash of the extracted text, in the same scheme notes use. */
  hash: string
  updatedAt: number
  deleted: boolean
}

/** A note, reduced to what classification needs. */
export interface LocalNote {
  id: string
  title: string
  vaultPath: string | null
  /** Hash of the comparable projection. */
  hash: string
  updatedAt: number
  deleted: boolean
}

/** What the last successful sync recorded. */
export interface SyncBaseline {
  noteId: string
  path: string
  lastHashApp: string
  lastHashFile: string
  syncedAt: number
}

/** A file the scanner could not read or parse. */
export interface ScanError {
  path: string
  message: string
}

// --------------------------------------------------------------------- plan

export interface SyncItem {
  /** Stable across a rescan, so a selection survives one. */
  key: string
  status: SyncStatus
  noteId: string | null
  title: string
  /** Where the file is now, or where the note wants to be. */
  path: string | null
  /** For a move: where the baseline said it was. */
  previousPath: string | null
  /** The other file, for a duplicate id or a path collision. */
  otherPath: string | null
  excerpt: string
  noteUpdatedAt: number | null
  fileUpdatedAt: number | null
  /** Recorded so `apply` can tell whether the world moved under it. */
  fileHash: string | null
  noteHash: string | null
  message: string | null
  /**
   * Which side of the vault this row is about.
   *
   * `note` for Markdown, `document` for a PDF. Optional for the same reason
   * `ScannedFile.kind` is: an item with no kind is a note, which every item was
   * before this existed. The UI groups on it; `applySync` routes on it.
   */
  itemKind?: 'note' | 'document'
  /** The document this row is about, when `itemKind` is `document`. */
  documentId?: string | null
}

/**
 * What the walk deliberately passed over.
 *
 * A scan that understood nothing in a folder full of files looks exactly like a
 * scan of an empty folder: no items, no errors, `filesSeen: 0`. The two are not
 * the same thing, and the second is a much more useful thing to be told — a
 * user who has pointed Vaultwork at a folder of PDFs is owed "none of these are
 * notes", not "everything matches".
 *
 * So the walk counts what it skipped and keeps a few names. Nothing here
 * changes what is imported; it exists so the screen can describe the folder it
 * actually looked at.
 */
export interface SkippedSummary {
  /** Files passed over because they are not Markdown. */
  nonMarkdown: number
  /** Folders never opened: `.obsidian`, `.git`, and other dot-folders. */
  ignoredDirectories: number
  /** A handful of skipped file names, so a message can name what it saw. */
  examples: string[]
}

/** How many skipped names are worth carrying to the UI. */
export const SKIPPED_EXAMPLES = 5

export const EMPTY_SKIPPED = (): SkippedSummary => ({
  nonMarkdown: 0,
  ignoredDirectories: 0,
  examples: [],
})

export interface SyncPlan {
  items: SyncItem[]
  counts: Record<SyncStatus, number>
  errors: ScanError[]
  scannedAt: number
  filesSeen: number
  notesSeen: number
  /** What the walk saw and passed over. Never empty-by-omission. */
  skipped: SkippedSummary
  /**
   * How many of each kind the walk read.
   *
   * Separate from `filesSeen` because "12 files" answers nothing useful when
   * four are notes, three are PDFs and five were passed over. The Sync Center
   * shows these three numbers rather than one.
   */
  seen: { markdown: number; pdf: number }
}

export const EMPTY_COUNTS = (): Record<SyncStatus, number> => ({
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

// ----------------------------------------------------------- classification

/**
 * One note against one file, given what they last agreed on.
 *
 * Wraps M10's three-way detector rather than reimplementing it: the milestone's
 * rule is one conflict model, and a second copy of this arithmetic would be a
 * second place for it to go wrong.
 */
export function classifyPair(
  note: LocalNote,
  file: ScannedFile | null,
  baseline: SyncBaseline | null,
): SyncStatus {
  return detectStatusFromHashes({
    localHash: note.hash,
    remoteHash: file === null ? null : file.hash,
    baseHash: baseline?.lastHashFile ?? null,
  }).status
}

// -------------------------------------------------------------- plan builder

export interface PlanInput {
  notes: LocalNote[]
  /** Optional so callers that predate PDFs behave exactly as they did. */
  documents?: LocalDocument[]
  files: ScannedFile[]
  baselines: SyncBaseline[]
  errors: ScanError[]
  scannedAt: number
  /** Optional so every existing caller and test keeps working unchanged. */
  skipped?: SkippedSummary
}

const excerptOf = (file: ScannedFile | null) => file?.excerpt ?? ''

/** "System Design/Basics.pdf" -> "Basics". A PDF has no title to trust inside it. */
export function basenameWithoutExtension(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Builds the whole picture.
 *
 * Order matters. Identity problems are decided *first* — a duplicate id or a
 * path collision means Vaultwork cannot say with confidence which file is which
 * note, and every later judgement would be built on that uncertainty. Those
 * items are reported and then excluded, so nothing downstream acts on a note
 * whose identity is in doubt.
 */
export function buildSyncPlan(input: PlanInput): SyncPlan {
  const items: SyncItem[] = []
  const counts = EMPTY_COUNTS()

  const push = (item: SyncItem) => {
    items.push(item)
    counts[item.status] += 1
  }

  const baselineFor = new Map(input.baselines.map((row) => [row.noteId, row]))
  const noteById = new Map(input.notes.map((note) => [note.id, note]))

  // ---- identity problems first -------------------------------------------

  const filesById = new Map<string, ScannedFile[]>()
  for (const file of input.files) {
    // A PDF carries no frontmatter, so it can never claim a note's id.
    if (file.kind === 'pdf') continue
    if (file.id === null) continue
    const bucket = filesById.get(file.id)
    if (bucket) bucket.push(file)
    else filesById.set(file.id, [file])
  }

  /** Note ids Vaultwork must not act on, because two files claim them. */
  const ambiguous = new Set<string>()

  for (const [id, group] of filesById) {
    if (group.length < 2) continue
    ambiguous.add(id)
    const note = noteById.get(id)
    const [first, second] = group
    push({
      key: `duplicate:${id}`,
      status: 'duplicate-id',
      noteId: note?.id ?? id,
      title: note?.title ?? first?.title ?? id,
      path: first?.path ?? null,
      previousPath: null,
      otherPath: second?.path ?? null,
      excerpt: excerptOf(first ?? null),
      noteUpdatedAt: note?.updatedAt ?? null,
      fileUpdatedAt: first?.updatedAt ?? null,
      fileHash: null,
      noteHash: note?.hash ?? null,
      message: `${group.length} files claim this note: ${group
        .map((file) => file.path)
        .join(', ')}`,
    })
  }

  // Two live notes reserving the same path would have the second export
  // silently land on the first one's file.
  const byPath = new Map<string, LocalNote[]>()
  for (const note of input.notes) {
    if (note.deleted || note.vaultPath === null) continue
    const key = note.vaultPath.toLowerCase()
    const bucket = byPath.get(key)
    if (bucket) bucket.push(note)
    else byPath.set(key, [note])
  }

  const collided = new Set<string>()
  for (const [, group] of byPath) {
    if (group.length < 2) continue
    for (const note of group) collided.add(note.id)
    const [first, second] = group
    push({
      key: `collision:${first?.vaultPath ?? ''}`,
      status: 'path-collision',
      noteId: first?.id ?? null,
      title: first?.title ?? '',
      path: first?.vaultPath ?? null,
      previousPath: null,
      otherPath: second?.vaultPath ?? null,
      excerpt: '',
      noteUpdatedAt: first?.updatedAt ?? null,
      fileUpdatedAt: null,
      fileHash: null,
      noteHash: first?.hash ?? null,
      message: `${group.length} notes claim ${first?.vaultPath}: ${group
        .map((note) => note.title)
        .join(', ')}`,
    })
  }

  // Markdown and PDF are classified separately from here on. They share the
  // walk, the statuses, the decisions and the apply loop — but a note is
  // matched by frontmatter id and a document by path, so the two passes cannot
  // be one loop without a `if (kind)` in every branch of it.
  const noteFiles = input.files.filter((file) => (file.kind ?? 'note') === 'note')
  const pdfFiles = input.files.filter((file) => file.kind === 'pdf')

  // ---- notes ---------------------------------------------------------------

  const claimedPaths = new Set<string>()

  for (const note of input.notes) {
    if (ambiguous.has(note.id) || collided.has(note.id)) {
      // Already reported as an identity problem; acting further would compound it.
      if (note.vaultPath !== null) claimedPaths.add(note.vaultPath.toLowerCase())
      continue
    }

    const baseline = baselineFor.get(note.id) ?? null

    // A file carrying this note's id is authoritative about where it lives now,
    // whatever the baseline or the note's own path says.
    const byId = filesById.get(note.id)?.[0] ?? null
    const atExpected =
      note.vaultPath === null
        ? null
        : (noteFiles.find((file) => file.path.toLowerCase() === note.vaultPath?.toLowerCase()) ??
          null)

    const file = byId ?? atExpected
    if (file !== null) claimedPaths.add(file.path.toLowerCase())
    if (note.vaultPath !== null) claimedPaths.add(note.vaultPath.toLowerCase())

    // A note deleted here whose file is still in the vault is a decision, not
    // an instruction: deleting a note is not deleting somebody's file.
    if (note.deleted) {
      if (file === null) continue
      push({
        key: `note:${note.id}`,
        status: 'deleted-local',
        noteId: note.id,
        title: note.title,
        path: file.path,
        previousPath: null,
        otherPath: null,
        excerpt: file.excerpt,
        noteUpdatedAt: note.updatedAt,
        fileUpdatedAt: file.updatedAt,
        fileHash: file.hash,
        noteHash: note.hash,
        message: 'The note was deleted in Vaultwork. Its vault file is untouched.',
      })
      continue
    }

    const expectedPath = baseline?.path ?? note.vaultPath
    const moved =
      file !== null &&
      expectedPath !== null &&
      file.path.toLowerCase() !== expectedPath.toLowerCase()

    const contentStatus = classifyPair(note, file, baseline)

    // A move and an edit are two separate decisions, so they get one state that
    // says so rather than being collapsed into whichever happened to win.
    const status: SyncStatus = moved
      ? contentStatus === 'clean'
        ? 'moved'
        : contentStatus === 'conflict' || contentStatus === 'external-change'
          ? 'moved-change'
          : contentStatus
      : contentStatus

    push({
      key: `note:${note.id}`,
      status,
      noteId: note.id,
      title: note.title,
      path: file?.path ?? note.vaultPath,
      previousPath: moved ? expectedPath : null,
      otherPath: null,
      excerpt: excerptOf(file),
      noteUpdatedAt: note.updatedAt,
      fileUpdatedAt: file?.updatedAt ?? null,
      fileHash: file?.hash ?? null,
      noteHash: note.hash,
      message: null,
    })
  }

  // ---- markdown files with no note ------------------------------------------

  for (const file of noteFiles) {
    if (file.id !== null && ambiguous.has(file.id)) continue
    if (claimedPaths.has(file.path.toLowerCase())) continue
    // A file whose id names a note that exists was already handled above.
    if (file.id !== null && noteById.has(file.id)) continue

    push({
      key: `file:${file.path}`,
      status: 'untracked',
      itemKind: 'note',
      noteId: null,
      title: file.title ?? file.path.split('/').pop() ?? file.path,
      path: file.path,
      previousPath: null,
      otherPath: null,
      excerpt: file.excerpt,
      noteUpdatedAt: null,
      fileUpdatedAt: file.updatedAt,
      fileHash: file.hash,
      noteHash: null,
      // A file carrying an id for a note that no longer exists is still just a
      // new file as far as Vaultwork is concerned — it will not resurrect a
      // note the user deleted.
      message: file.id !== null ? 'Carries a Vaultwork id with no matching note.' : null,
    })
  }

  // ---- pdf documents --------------------------------------------------------
  //
  // Matched by path, not by an embedded id: Vaultwork never writes to a PDF, so
  // there is nowhere to put one. That is also why a document has no
  // `local-change` and no `conflict` — the extracted text is derived from the
  // file and nothing in the application can edit it, so the only side that can
  // move is the vault's. Inventing a conflict state that cannot occur would be
  // worse than not having one; a changed file is an `external-change` the user
  // still has to accept.

  const documents = input.documents ?? []
  const documentByPath = new Map(
    documents.filter((row) => !row.deleted).map((row) => [row.vaultPath.toLowerCase(), row]),
  )
  const seenDocumentPaths = new Set<string>()

  for (const file of pdfFiles) {
    const key = file.path.toLowerCase()
    seenDocumentPaths.add(key)
    const existing = documentByPath.get(key) ?? null

    if (existing === null) {
      push({
        key: `pdf:${file.path}`,
        status: 'untracked',
        itemKind: 'document',
        documentId: null,
        noteId: null,
        title: file.title ?? basenameWithoutExtension(file.path),
        path: file.path,
        previousPath: null,
        otherPath: null,
        excerpt: file.excerpt,
        noteUpdatedAt: null,
        fileUpdatedAt: file.updatedAt,
        fileHash: file.hash,
        noteHash: null,
        message: null,
      })
      continue
    }

    const changed = existing.hash !== file.hash
    push({
      key: `pdf:${file.path}`,
      status: changed ? 'external-change' : 'clean',
      itemKind: 'document',
      documentId: existing.id,
      noteId: null,
      title: existing.title,
      path: file.path,
      previousPath: null,
      otherPath: null,
      excerpt: file.excerpt,
      noteUpdatedAt: existing.updatedAt,
      fileUpdatedAt: file.updatedAt,
      fileHash: file.hash,
      noteHash: existing.hash,
      message: changed ? 'The PDF changed in the vault since it was read.' : null,
    })
  }

  // A document whose file is gone. Reported, never acted on: deleting a file in
  // Obsidian is not an instruction to delete what Vaultwork read from it.
  for (const document of documents) {
    if (document.deleted) continue
    if (seenDocumentPaths.has(document.vaultPath.toLowerCase())) continue
    push({
      key: `pdf:${document.vaultPath}`,
      status: 'missing',
      itemKind: 'document',
      documentId: document.id,
      noteId: null,
      title: document.title,
      path: document.vaultPath,
      previousPath: null,
      otherPath: null,
      excerpt: '',
      noteUpdatedAt: document.updatedAt,
      fileUpdatedAt: null,
      fileHash: null,
      noteHash: document.hash,
      message: 'The PDF is no longer in the vault. Nothing here was deleted.',
    })
  }

  counts.error = input.errors.length

  return {
    items: items.sort(byUrgency),
    counts,
    errors: input.errors,
    scannedAt: input.scannedAt,
    filesSeen: input.files.length,
    notesSeen: input.notes.length,
    skipped: input.skipped ?? EMPTY_SKIPPED(),
    seen: { markdown: noteFiles.length, pdf: pdfFiles.length },
  }
}

/**
 * The order the user should read them in.
 *
 * Things that need a decision come first, things that are fine come last —
 * a list that opens on forty "Synced" rows buries the two that matter.
 */
const URGENCY: Record<SyncStatus, number> = {
  conflict: 0,
  'duplicate-id': 1,
  'path-collision': 2,
  'moved-change': 3,
  'external-change': 4,
  'deleted-local': 5,
  missing: 6,
  moved: 7,
  'local-change': 8,
  untracked: 9,
  'not-exported': 10,
  error: 11,
  ignored: 12,
  clean: 13,
}

function byUrgency(a: SyncItem, b: SyncItem): number {
  const rank = URGENCY[a.status] - URGENCY[b.status]
  if (rank !== 0) return rank
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key)
}

// ---------------------------------------------------------------- decisions

/**
 * What the user chose for one item.
 *
 * Named actions rather than a `force: true` flag. "Keep Obsidian" says what
 * will happen; a boolean says only that somebody insisted, and six months later
 * nobody can tell which side that meant.
 */
export type SyncDecision =
  | 'skip'
  | 'import'
  | 'export'
  | 'keep-local'
  | 'keep-external'
  | 'accept-move'
  | 'restore-to-vault'
  | 'forget-link'
  | 'delete-from-vault'

export interface DecisionOption {
  decision: SyncDecision
  label: string
  /** True when choosing it replaces something the user has not seen. */
  destructive: boolean
  hint: string
}

/**
 * What may be done about an item.
 *
 * There is deliberately no "resolve automatically" anywhere in this table. For
 * a conflict the two real options are named by their consequence, and `skip` is
 * always available — doing nothing is a legitimate answer and must never be
 * harder to choose than doing something.
 */
/**
 * What may be done about a *document*.
 *
 * A much shorter list than a note's, and deliberately so. Vaultwork is
 * read-only with respect to PDFs: there is no export, no keep-local, no
 * restore-to-vault, because there is no writing side to choose. `forget-link`
 * is how a user stops tracking one without touching the file.
 */
export function documentOptionsFor(status: SyncStatus): DecisionOption[] {
  const skip: DecisionOption = {
    decision: 'skip',
    label: 'Skip',
    destructive: false,
    hint: 'Leave both sides as they are.',
  }

  switch (status) {
    case 'untracked':
      return [
        {
          decision: 'import',
          label: 'Import',
          destructive: false,
          hint: 'Read this PDF and index its text.',
        },
        skip,
      ]
    case 'external-change':
      return [
        {
          decision: 'import',
          label: 'Re-read',
          destructive: false,
          // Only Vaultwork's copy of the text moves. The PDF is never written.
          hint: 'Read the PDF again and replace the indexed text.',
        },
        skip,
      ]
    case 'missing':
      return [
        {
          decision: 'forget-link',
          label: 'Forget',
          destructive: false,
          hint: 'Stop tracking this document. The file is not touched.',
        },
        skip,
      ]
    default:
      return [skip]
  }
}

export function optionsFor(status: SyncStatus): DecisionOption[] {
  const skip: DecisionOption = {
    decision: 'skip',
    label: 'Skip',
    destructive: false,
    hint: 'Leave both sides as they are.',
  }

  switch (status) {
    case 'local-change':
      return [
        {
          decision: 'export',
          label: 'Export',
          destructive: false,
          hint: 'Write this note to the vault. The file has not changed.',
        },
        skip,
      ]

    case 'external-change':
      return [
        {
          decision: 'import',
          label: 'Import',
          destructive: false,
          hint: 'Take the vault version. This note has not changed.',
        },
        skip,
      ]

    case 'conflict':
    case 'moved-change':
      return [
        {
          decision: 'keep-local',
          label: 'Keep Vaultwork',
          destructive: true,
          hint: 'Overwrite the vault file with this note.',
        },
        {
          decision: 'keep-external',
          label: 'Keep Obsidian',
          destructive: true,
          hint: 'Replace this note with the vault file.',
        },
        skip,
      ]

    case 'untracked':
      return [
        {
          decision: 'import',
          label: 'Import',
          destructive: false,
          hint: 'Create a note from this file.',
        },
        skip,
      ]

    case 'not-exported':
      return [
        {
          decision: 'export',
          label: 'Export',
          destructive: false,
          hint: 'Write this note to the vault for the first time.',
        },
        skip,
      ]

    case 'missing':
      return [
        {
          decision: 'restore-to-vault',
          label: 'Write it again',
          destructive: false,
          hint: 'Recreate the file from this note.',
        },
        {
          decision: 'forget-link',
          label: 'Forget the link',
          destructive: false,
          hint: 'Stop tracking this file. The note stays.',
        },
        skip,
      ]

    case 'moved':
      return [
        {
          decision: 'accept-move',
          label: 'Accept move',
          destructive: false,
          hint: 'Point this note at the file’s new location.',
        },
        skip,
      ]

    case 'deleted-local':
      return [
        {
          decision: 'delete-from-vault',
          label: 'Delete the file too',
          destructive: true,
          hint: 'Remove the file from your vault.',
        },
        {
          decision: 'forget-link',
          label: 'Keep the file',
          destructive: false,
          hint: 'Leave the file alone and stop tracking it.',
        },
        skip,
      ]

    // Identity problems, errors and clean items have nothing safe to offer.
    case 'duplicate-id':
    case 'path-collision':
    case 'error':
    case 'ignored':
    case 'clean':
      return []
  }
}

/** The default for every item: do nothing until told otherwise. */
export function defaultDecisions(plan: SyncPlan): Record<string, SyncDecision> {
  const decisions: Record<string, SyncDecision> = {}
  for (const item of plan.items) decisions[item.key] = 'skip'
  return decisions
}

/**
 * Selects every item whose only sensible action carries no risk.
 *
 * Used by "Select safe changes". It never picks a conflict, an external change
 * or anything that would replace unseen work — the point of the button is to
 * clear the noise so the decisions that matter are what remains.
 */
export function safeDecisions(plan: SyncPlan): Record<string, SyncDecision> {
  const decisions = defaultDecisions(plan)
  for (const item of plan.items) {
    // Documents are never selected here. Importing one reads a file and adds
    // rows, which is a decision the user makes per document — the same reason
    // an untracked Markdown file is not selected either.
    if (item.itemKind === 'document') continue
    if (item.status === 'local-change' || item.status === 'not-exported') {
      decisions[item.key] = 'export'
    }
  }
  return decisions
}

export interface DecisionSummary {
  imported: number
  exported: number
  moved: number
  deleted: number
  forgotten: number
  skipped: number
  /** Choices that replace something the user has not seen. */
  destructive: number
  total: number
}

/** What a batch would do, for the confirmation step. */
export function summarizeDecisions(
  plan: SyncPlan,
  decisions: Record<string, SyncDecision>,
): DecisionSummary {
  const summary: DecisionSummary = {
    imported: 0,
    exported: 0,
    moved: 0,
    deleted: 0,
    forgotten: 0,
    skipped: 0,
    destructive: 0,
    total: 0,
  }

  for (const item of plan.items) {
    const decision = decisions[item.key] ?? 'skip'
    if (decision === 'skip') {
      summary.skipped += 1
      continue
    }

    summary.total += 1
    const option = optionsFor(item.status).find((row) => row.decision === decision)
    if (option?.destructive) summary.destructive += 1

    switch (decision) {
      case 'import':
      case 'keep-external':
        summary.imported += 1
        break
      case 'export':
      case 'keep-local':
      case 'restore-to-vault':
        summary.exported += 1
        break
      case 'accept-move':
        summary.moved += 1
        break
      case 'delete-from-vault':
        summary.deleted += 1
        break
      case 'forget-link':
        summary.forgotten += 1
        break
    }
  }

  return summary
}

/**
 * The order operations are applied in.
 *
 * Imports first so that a note exists before anything points at it; moves
 * before exports so an export writes to the settled path; deletes last, because
 * they are the only irreversible step and should happen after everything that
 * might still fail.
 *
 * The order is a tidiness measure, not a correctness one — each item is
 * re-validated against the filesystem immediately before it is applied, so no
 * conflict is resolved by sequencing.
 */
export const DECISION_ORDER: SyncDecision[] = [
  'import',
  'keep-external',
  'accept-move',
  'export',
  'keep-local',
  'restore-to-vault',
  'forget-link',
  'delete-from-vault',
  'skip',
]

export function orderedForApply(
  plan: SyncPlan,
  decisions: Record<string, SyncDecision>,
): { item: SyncItem; decision: SyncDecision }[] {
  return plan.items
    .map((item) => ({ item, decision: decisions[item.key] ?? ('skip' as SyncDecision) }))
    .filter((row) => row.decision !== 'skip')
    .sort((a, b) => DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision))
}
