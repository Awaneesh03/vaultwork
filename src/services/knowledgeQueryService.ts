import {
  buildGraph,
  buildKnowledgeIndex,
  localGraph,
  orphanIds,
  relatedNotes,
  resolveTarget,
  type AmbiguousWikilink,
  type KnowledgeGraph,
  type KnowledgeIndex,
  type KnowledgeNote,
  type RelatedNote,
  type ResolvedWikilink,
  type UnresolvedWikilink,
} from '@/integrations/obsidian/knowledgeIndex'
import { headingSlug } from '@/lib/markdown'
import { noteRepo, tagRepo } from '@/repositories'
import type { Id, Note, Tag } from '@/types/entities'
import { noteTitle } from './noteService'

/**
 * The knowledge layer's reads.
 *
 * Everything here is derived from the notes that are already in Dexie. This
 * service **never touches the filesystem** — the flow is Obsidian files → M11
 * sync → Note records → this. A vault that is disconnected, unsupported or
 * absent changes nothing about backlinks, the graph or related notes, because
 * none of them ever depended on a file.
 *
 * Every function is read-only. Opening a note, viewing its backlinks, drawing
 * the graph and filtering by tag all write nothing and emit no events.
 *
 * ---------------------------------------------------------------------------
 * Cost
 *
 * `buildKnowledgeIndex` is one pass: two table reads, one Markdown parse per
 * note, then hash-map lookups. Each exported function below builds the index
 * once and derives its answer from it, so a screen showing backlinks *and*
 * related notes *and* a local graph pays for one build, not three.
 *
 * The index is deliberately **not cached or persisted**. A stale graph is worse
 * than a recomputed one, and the recomputation is linear.
 */

// -------------------------------------------------------------------- input

/** Loads the notes the knowledge layer reasons about — live and trashed. */
async function loadNotes(): Promise<KnowledgeNote[]> {
  const [live, trashed] = await Promise.all([noteRepo.listLive(), noteRepo.listTrashed()])

  const shape = (note: Note, deleted: boolean): KnowledgeNote => ({
    id: note.id,
    // The display title, so a note with no title of its own is still linkable
    // by the heading it opens with.
    title: noteTitle(note),
    body: note.body,
    tagIds: note.tagIds,
    vaultPath: note.vaultPath,
    updatedAt: note.updatedAt,
    deleted,
  })

  return [
    ...live.map((note) => shape(note, false)),
    // Trashed notes are included so a link to one can say "deleted" rather
    // than "missing" — they are never resolved to, and never become nodes.
    ...trashed.map((note) => shape(note, true)),
  ]
}

/**
 * Builds the index from the current database contents.
 *
 * Exported so a caller needing several answers at once pays for one build.
 */
export async function buildKnowledge(): Promise<KnowledgeIndex> {
  return buildKnowledgeIndex(await loadNotes())
}

// --------------------------------------------------------------------- DTOs

export interface NoteRef {
  noteId: Id
  title: string
}

export interface OutgoingLinkView {
  /** The `[[...]]` exactly as written, for display. */
  raw: string
  /** What to show: the alias when there is one, else the target. */
  label: string
  target: NoteRef
  heading: string | null
  /** The anchor to scroll to, when the heading exists. */
  headingSlug: string | null
  /** True when the note resolved but the named heading does not exist. */
  headingMissing: boolean
}

export interface UnresolvedLinkView {
  raw: string
  target: string
  reason: 'missing' | 'deleted'
  /** Present for a deleted target, so the UI can offer to restore it. */
  deletedNoteId: Id | null
}

export interface AmbiguousLinkView {
  raw: string
  target: string
  candidates: NoteRef[]
}

export interface BacklinkView extends NoteRef {
  /** How the linking note referred to this one, for context. */
  contexts: string[]
}

export interface NoteKnowledge {
  noteId: Id
  outgoing: OutgoingLinkView[]
  unresolved: UnresolvedLinkView[]
  ambiguous: AmbiguousLinkView[]
  backlinks: BacklinkView[]
  related: RelatedNote[]
  graph: KnowledgeGraph
  isOrphan: boolean
}

const refOf = (index: KnowledgeIndex, id: Id): NoteRef => ({
  noteId: id,
  title: index.byId.get(id)?.title ?? 'Untitled note',
})

function outgoingViews(
  index: KnowledgeIndex,
  links: ResolvedWikilink[],
): OutgoingLinkView[] {
  return links.map((entry) => ({
    raw: entry.link.raw,
    label: entry.link.alias ?? entry.link.target,
    target: refOf(index, entry.targetNoteId),
    heading: entry.heading,
    headingSlug:
      entry.heading !== null && !entry.headingMissing ? headingSlug(entry.heading) : null,
    headingMissing: entry.headingMissing,
  }))
}

const unresolvedViews = (links: UnresolvedWikilink[]): UnresolvedLinkView[] =>
  links.map((entry) => ({
    raw: entry.link.raw,
    target: entry.link.target,
    reason: entry.reason,
    deletedNoteId: entry.deletedNoteId,
  }))

const ambiguousViews = (
  index: KnowledgeIndex,
  links: AmbiguousWikilink[],
): AmbiguousLinkView[] =>
  links.map((entry) => ({
    raw: entry.link.raw,
    target: entry.link.target,
    candidates: entry.candidateNoteIds.map((id) => refOf(index, id)),
  }))

/**
 * Backlinks, derived — never stored.
 *
 * One entry per linking note however many times it links, with the raw text of
 * each mention kept as context. Three `[[B]]`s in one note is one relationship.
 */
function backlinkViews(index: KnowledgeIndex, noteId: Id): BacklinkView[] {
  return (index.incoming.get(noteId) ?? [])
    .map((sourceId) => ({
      ...refOf(index, sourceId),
      contexts: (index.resolved.get(sourceId) ?? [])
        .filter((entry) => entry.targetNoteId === noteId)
        .map((entry) => entry.link.raw),
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.noteId.localeCompare(b.noteId))
}

// ----------------------------------------------------------------- the API

/** Everything one note's detail screen needs, from a single index build. */
export async function getNoteKnowledge(
  noteId: Id,
  index?: KnowledgeIndex,
): Promise<NoteKnowledge | undefined> {
  const built = index ?? (await buildKnowledge())
  const note = built.byId.get(noteId)
  if (note === undefined || note.deleted) return undefined

  return {
    noteId,
    outgoing: outgoingViews(built, built.resolved.get(noteId) ?? []),
    unresolved: unresolvedViews(built.unresolved.get(noteId) ?? []),
    ambiguous: ambiguousViews(built, built.ambiguous.get(noteId) ?? []),
    backlinks: backlinkViews(built, noteId),
    related: relatedNotes(built, noteId),
    graph: localGraph(built, noteId, 1),
    isOrphan:
      (built.outgoing.get(noteId) ?? []).length === 0 &&
      (built.incoming.get(noteId) ?? []).length === 0,
  }
}

export async function getOutgoingLinks(noteId: Id): Promise<OutgoingLinkView[]> {
  const index = await buildKnowledge()
  return outgoingViews(index, index.resolved.get(noteId) ?? [])
}

export async function getNoteBacklinks(noteId: Id): Promise<BacklinkView[]> {
  return backlinkViews(await buildKnowledge(), noteId)
}

export async function getRelatedNotes(noteId: Id, limit = 10): Promise<RelatedNote[]> {
  return relatedNotes(await buildKnowledge(), noteId, limit)
}

/** Resolves one target against the current notes. Used by the UI and tests. */
export async function resolveWikilinkTarget(target: string) {
  return resolveTarget(target, await buildKnowledge())
}

export interface OrphanNote extends NoteRef {
  updatedAt: number
  tagIds: Id[]
}

/**
 * Notes nothing links to and which link to nothing.
 *
 * Tags are not considered: a tagged note nobody mentions is precisely the one
 * that has fallen out of the web, which is what this list is for.
 */
export async function getOrphanNotes(): Promise<OrphanNote[]> {
  const index = await buildKnowledge()

  return orphanIds(index)
    .map((id) => {
      const note = index.byId.get(id) as KnowledgeNote
      return { noteId: id, title: note.title, updatedAt: note.updatedAt, tagIds: note.tagIds }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.noteId.localeCompare(b.noteId))
}

/** Every unresolved link in the vault, grouped by the note that wrote it. */
export async function getUnresolvedLinks(): Promise<
  { noteId: Id; title: string; links: UnresolvedLinkView[] }[]
> {
  const index = await buildKnowledge()
  return [...index.unresolved.entries()]
    .map(([noteId, links]) => ({
      noteId,
      title: index.byId.get(noteId)?.title ?? '',
      links: unresolvedViews(links),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Every ambiguous link, grouped by the note that wrote it. */
export async function getAmbiguousLinks(): Promise<
  { noteId: Id; title: string; links: AmbiguousLinkView[] }[]
> {
  const index = await buildKnowledge()
  return [...index.ambiguous.entries()]
    .map(([noteId, links]) => ({
      noteId,
      title: index.byId.get(noteId)?.title ?? '',
      links: ambiguousViews(index, links),
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export interface TaggedNotes {
  tag: Tag | null
  notes: NoteRef[]
}

/**
 * Notes carrying one tag.
 *
 * Reads the existing `Note.tagIds` relationship — M12 adds no second tag
 * table, because the one that exists already answers this.
 */
export async function getNotesByTag(tagId: Id): Promise<TaggedNotes> {
  const [index, tags] = await Promise.all([buildKnowledge(), tagRepo.list()])

  const notes = [...index.byId.values()]
    .filter((note) => !note.deleted && note.tagIds.includes(tagId))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((note) => ({ noteId: note.id, title: note.title }))

  return { tag: tags.find((tag) => tag.id === tagId) ?? null, notes }
}

// ------------------------------------------------------------------- graph

export type GraphFilter = 'all' | 'tagged' | 'orphans' | 'unresolved'

export interface GraphViewOptions {
  filter?: GraphFilter | undefined
  /** Narrows to notes carrying this tag. */
  tagId?: Id | null | undefined
  /** When set, returns the neighbourhood of one note instead of the vault. */
  focusNoteId?: Id | null | undefined
  depth?: number | undefined
}

export interface GraphViewData extends KnowledgeGraph {
  /** Note ids whose links could not be resolved, for the Unresolved filter. */
  unresolvedNoteIds: Id[]
  orphanNoteIds: Id[]
  totalNodes: number
}

/**
 * The graph, filtered.
 *
 * Filtering happens on the derived graph rather than by re-querying: the index
 * is already in hand, and a second pass over Dexie would be both slower and a
 * chance for the two answers to disagree.
 *
 * Edges are kept only when *both* endpoints survive the filter, so a filtered
 * view never draws a line to a node that is not there.
 */
export async function getGraph(options: GraphViewOptions = {}): Promise<GraphViewData> {
  const index = await buildKnowledge()

  const base =
    options.focusNoteId != null
      ? localGraph(index, options.focusNoteId, options.depth ?? 1)
      : buildGraph(index)

  const orphans = new Set(orphanIds(index))
  const unresolvedNotes = new Set(index.unresolved.keys())
  const ambiguousNotes = new Set(index.ambiguous.keys())

  const filter = options.filter ?? 'all'

  const keep = (node: KnowledgeGraph['nodes'][number]): boolean => {
    if (options.tagId != null && !node.tags.includes(options.tagId)) return false
    switch (filter) {
      case 'tagged':
        return node.tags.length > 0
      case 'orphans':
        return orphans.has(node.id)
      case 'unresolved':
        return unresolvedNotes.has(node.id) || ambiguousNotes.has(node.id)
      case 'all':
        return true
    }
  }

  const nodes = base.nodes.filter(keep)
  const kept = new Set(nodes.map((node) => node.id))

  return {
    nodes,
    edges: base.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    unresolvedNoteIds: [...unresolvedNotes],
    orphanNoteIds: [...orphans],
    totalNodes: base.nodes.length,
  }
}
