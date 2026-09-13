import { documentHeadings, headingSlug } from '@/lib/markdown'
import { parseWikilinks, type Wikilink } from './wikilinks'

/**
 * The knowledge layer, as one pure pass over the notes.
 *
 * Everything here is *derived*. No backlink, edge, related score or orphan flag
 * is ever written to the database — they are recomputed from the note bodies
 * whenever they are asked for. Persisting them would create a second copy of
 * the truth that goes stale the moment somebody edits a note in Obsidian, and
 * the whole point of a wikilink is that it lives in the text.
 *
 * ---------------------------------------------------------------------------
 * Complexity
 *
 * For N notes carrying L links between them, `buildKnowledgeIndex` is
 * O(N + L) after an O(N) parse: each body is parsed exactly once, the title and
 * path lookups are hash maps, and each link is resolved by a constant number of
 * map probes. Nothing compares every note against every other note — the naive
 * O(N²) shape would be unusable at a few thousand notes, which is an ordinary
 * size for a vault.
 */

// ------------------------------------------------------------------- inputs

/** A note, reduced to what the knowledge layer needs. */
export interface KnowledgeNote {
  id: string
  title: string
  body: string
  tagIds: string[]
  vaultPath: string | null
  updatedAt: number
  /** Soft-deleted notes are not link targets, but are still recognised. */
  deleted: boolean
}

// -------------------------------------------------------------------- links

export interface ResolvedWikilink {
  link: Wikilink
  targetNoteId: string
  /** The `#fragment`, when the link named one. */
  heading: string | null
  /** True when the note resolved but the heading it named does not exist. */
  headingMissing: boolean
}

export interface UnresolvedWikilink {
  link: Wikilink
  /** `missing`: nothing by that name. `deleted`: the note is in the trash. */
  reason: 'missing' | 'deleted'
  /** The deleted note, so the UI can offer to restore it. */
  deletedNoteId: string | null
}

export interface AmbiguousWikilink {
  link: Wikilink
  candidateNoteIds: string[]
}

export type LinkResolution =
  | { kind: 'resolved'; value: ResolvedWikilink }
  | { kind: 'unresolved'; value: UnresolvedWikilink }
  | { kind: 'ambiguous'; value: AmbiguousWikilink }

// ------------------------------------------------------------------- index

export interface KnowledgeIndex {
  byId: Map<string, KnowledgeNote>
  /** Lower-cased title -> every note id carrying it. Several means ambiguity. */
  byTitle: Map<string, string[]>
  /** Lower-cased vault path -> note id. Paths are unique. */
  byPath: Map<string, string>
  /** Lower-cased file basename -> note ids. */
  byBasename: Map<string, string[]>
  /** noteId -> the note ids it links to, de-duplicated, in first-seen order. */
  outgoing: Map<string, string[]>
  /** noteId -> the note ids linking to it. */
  incoming: Map<string, string[]>
  unresolved: Map<string, UnresolvedWikilink[]>
  ambiguous: Map<string, AmbiguousWikilink[]>
  /** Every resolved link of a note, in document order. */
  resolved: Map<string, ResolvedWikilink[]>
  /** Heading slugs per note, so `#fragment` links can be checked. */
  headings: Map<string, Set<string>>
}

const lower = (value: string) => value.trim().toLowerCase()

/** `notes/dsa/binary-search.md` -> `binary-search`. */
export function basenameOf(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/i, '')
}

/** The target as written, with any `.md` suffix removed. */
const normaliseTarget = (target: string) => lower(target).replace(/\.md$/i, '')

// --------------------------------------------------------------- resolution

/**
 * Finds the note a wikilink target names.
 *
 * The order is fixed and deliberate, from most specific to least:
 *
 *   1. an exact vault path        — unambiguous by construction
 *   2. an exact title             — what a person usually means
 *   3. a case-insensitive title
 *   4. a case-insensitive basename or path
 *
 * and if more than one note survives at the step that matched, the link is
 * **ambiguous** — never resolved by picking the first. `[[Java]]` with both
 * `Programming/Java.md` and `College/Java.md` in the vault is a question the
 * user has to answer, and guessing would silently point a link at the wrong
 * note for as long as nobody noticed.
 *
 * A target naming a deleted note reports `deleted` rather than `missing`, so
 * the UI can say "that note is in the trash" instead of "no such note".
 */
export function resolveTarget(
  target: string,
  index: Pick<KnowledgeIndex, 'byId' | 'byTitle' | 'byPath' | 'byBasename'>,
):
  | { status: 'resolved'; noteId: string }
  | { status: 'missing' }
  | { status: 'deleted'; noteId: string }
  | { status: 'ambiguous'; noteIds: string[] } {
  const needle = normaliseTarget(target)
  if (needle.length === 0) return { status: 'missing' }

  const live = (ids: string[]) => ids.filter((id) => index.byId.get(id)?.deleted === false)
  const dead = (ids: string[]) => ids.filter((id) => index.byId.get(id)?.deleted === true)

  /** Decides one candidate set, or falls through when it is empty. */
  const decide = (ids: string[]): ReturnType<typeof resolveTarget> | null => {
    if (ids.length === 0) return null
    const alive = live(ids)
    if (alive.length === 1) return { status: 'resolved', noteId: alive[0] as string }
    if (alive.length > 1) return { status: 'ambiguous', noteIds: alive }
    // Only deleted notes carry this name.
    const gone = dead(ids)
    return gone.length > 0 ? { status: 'deleted', noteId: gone[0] as string } : null
  }

  // 1. exact vault path (with or without the .md the writer may have typed)
  for (const candidate of [lower(target), `${needle}.md`]) {
    const byPath = index.byPath.get(candidate)
    if (byPath !== undefined) {
      const decided = decide([byPath])
      if (decided) return decided
    }
  }

  // 2 & 3. title — the map is keyed lower-case, so an exact match and a
  // case-insensitive one are the same probe. Exactness is preserved by
  // checking for a byte-identical title among the candidates first.
  const titled = index.byTitle.get(needle) ?? []
  if (titled.length > 0) {
    const exact = titled.filter((id) => index.byId.get(id)?.title.trim() === target.trim())
    const decided = decide(exact.length > 0 ? exact : titled)
    if (decided) return decided
  }

  // 4. basename or full path, case-insensitively
  const byBasename = decide(index.byBasename.get(needle) ?? [])
  if (byBasename) return byBasename

  return { status: 'missing' }
}

// ------------------------------------------------------------------- build

/**
 * Builds the whole index in one pass.
 *
 * Deleted notes are included in `byId` and in the lookup maps — that is what
 * lets a link to one report `deleted` rather than `missing` — but they are
 * never resolved to, never become graph nodes, and never contribute edges.
 */
export function buildKnowledgeIndex(notes: KnowledgeNote[]): KnowledgeIndex {
  const byId = new Map<string, KnowledgeNote>()
  const byTitle = new Map<string, string[]>()
  const byPath = new Map<string, string>()
  const byBasename = new Map<string, string[]>()

  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const bucket = map.get(key)
    if (bucket) bucket.push(id)
    else map.set(key, [id])
  }

  for (const note of notes) {
    byId.set(note.id, note)
    const title = lower(note.title)
    if (title.length > 0) push(byTitle, title, note.id)
    if (note.vaultPath !== null) {
      byPath.set(lower(note.vaultPath), note.id)
      push(byBasename, lower(basenameOf(note.vaultPath)), note.id)
      // The full path without its extension is also a legitimate target.
      push(byBasename, lower(note.vaultPath).replace(/\.md$/i, ''), note.id)
    }
  }

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const unresolved = new Map<string, UnresolvedWikilink[]>()
  const ambiguous = new Map<string, AmbiguousWikilink[]>()
  const resolved = new Map<string, ResolvedWikilink[]>()
  const headings = new Map<string, Set<string>>()

  for (const note of notes) {
    if (note.deleted) continue
    headings.set(note.id, new Set(documentHeadings(note.body).map((row) => row.slug)))
  }

  for (const note of notes) {
    // A deleted note's own links are not part of the live graph.
    if (note.deleted) continue

    const links = parseWikilinks(note.body)
    if (links.length === 0) continue

    const seen = new Set<string>()

    for (const link of links) {
      const outcome = resolveTarget(link.target, { byId, byTitle, byPath, byBasename })

      if (outcome.status === 'ambiguous') {
        const bucket = ambiguous.get(note.id)
        const entry: AmbiguousWikilink = { link, candidateNoteIds: outcome.noteIds }
        if (bucket) bucket.push(entry)
        else ambiguous.set(note.id, [entry])
        continue
      }

      if (outcome.status === 'missing' || outcome.status === 'deleted') {
        const bucket = unresolved.get(note.id)
        const entry: UnresolvedWikilink = {
          link,
          reason: outcome.status === 'deleted' ? 'deleted' : 'missing',
          deletedNoteId: outcome.status === 'deleted' ? outcome.noteId : null,
        }
        if (bucket) bucket.push(entry)
        else unresolved.set(note.id, [entry])
        continue
      }

      // A named heading that does not exist does not make the *note* link
      // unresolved: the note was found, and saying otherwise would send the
      // user looking for a note that is right there.
      const known = headings.get(outcome.noteId)
      const headingMissing =
        link.heading !== null && known !== undefined && !known.has(headingSlug(link.heading))

      const entry: ResolvedWikilink = {
        link,
        targetNoteId: outcome.noteId,
        heading: link.heading,
        headingMissing,
      }
      const bucket = resolved.get(note.id)
      if (bucket) bucket.push(entry)
      else resolved.set(note.id, [entry])

      // Adjacency is de-duplicated: linking to the same note three times is
      // one relationship, and would otherwise show three identical backlinks.
      if (seen.has(outcome.noteId)) continue
      seen.add(outcome.noteId)

      push(outgoing, note.id, outcome.noteId)
      push(incoming, outcome.noteId, note.id)
    }
  }

  return {
    byId,
    byTitle,
    byPath,
    byBasename,
    outgoing,
    incoming,
    unresolved,
    ambiguous,
    resolved,
    headings,
  }
}

// ------------------------------------------------------------------- graph

export interface KnowledgeGraphNode {
  id: string
  title: string
  tags: string[]
  incomingCount: number
  outgoingCount: number
}

export interface KnowledgeGraphEdge {
  source: string
  target: string
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

/**
 * The live graph.
 *
 * Only resolved links between live notes become edges — an unresolved or
 * ambiguous link is a question, not a relationship, and drawing it would assert
 * a connection nobody has confirmed.
 *
 * Cycles and self-links are kept exactly as they are. A note that links to
 * itself is a real thing people write, and "breaking" a cycle would mean
 * deleting one of the user's links from the picture.
 */
export function buildGraph(index: KnowledgeIndex): KnowledgeGraph {
  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  const seenEdge = new Set<string>()

  const live = [...index.byId.values()].filter((note) => !note.deleted)

  for (const note of live) {
    nodes.push({
      id: note.id,
      title: note.title,
      tags: note.tagIds,
      incomingCount: (index.incoming.get(note.id) ?? []).length,
      outgoingCount: (index.outgoing.get(note.id) ?? []).length,
    })
  }

  for (const [source, targets] of index.outgoing) {
    if (index.byId.get(source)?.deleted !== false) continue
    for (const target of targets) {
      if (index.byId.get(target)?.deleted !== false) continue
      const key = `${source}->${target}`
      if (seenEdge.has(key)) continue
      seenEdge.add(key)
      edges.push({ source, target })
    }
  }

  // A stable order, so two renders of the same vault look the same.
  nodes.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))

  return { nodes, edges }
}

/**
 * The neighbourhood of one note, out to `depth` hops.
 *
 * Traversal follows edges in **both** directions: a local graph is about what a
 * note is connected to, and a note that links to you is as much a neighbour as
 * one you link to. Breadth-first with a visited set, so a cycle terminates.
 */
export function localGraph(index: KnowledgeIndex, noteId: string, depth = 1): KnowledgeGraph {
  const full = buildGraph(index)
  if (!index.byId.has(noteId) || index.byId.get(noteId)?.deleted !== false) {
    return { nodes: [], edges: [] }
  }

  const included = new Set<string>([noteId])
  let frontier = [noteId]

  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of [
        ...(index.outgoing.get(id) ?? []),
        ...(index.incoming.get(id) ?? []),
      ]) {
        if (included.has(neighbour)) continue
        if (index.byId.get(neighbour)?.deleted !== false) continue
        included.add(neighbour)
        next.push(neighbour)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  return {
    nodes: full.nodes.filter((node) => included.has(node.id)),
    edges: full.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
  }
}

// ------------------------------------------------------------------ derived

/**
 * A note nothing links to and which links to nothing.
 *
 * Tags deliberately do not rescue a note from being an orphan. A tag is a
 * label; a link is a relationship. A note tagged `#java` that no note mentions
 * and that mentions nothing is exactly the note the user has lost track of,
 * which is the whole reason to look for orphans.
 */
export function orphanIds(index: KnowledgeIndex): string[] {
  const orphans: string[] = []
  for (const note of index.byId.values()) {
    if (note.deleted) continue
    if ((index.outgoing.get(note.id) ?? []).length > 0) continue
    if ((index.incoming.get(note.id) ?? []).length > 0) continue
    orphans.push(note.id)
  }
  return orphans
}

export interface RelatedNote {
  noteId: string
  title: string
  score: number
  reasons: string[]
}

/** How much each kind of connection is worth. Deliberately in one place. */
export const RELATED_WEIGHTS = {
  outgoing: 5,
  backlink: 5,
  sharedTag: 2,
} as const

/**
 * Notes related to this one, scored and ordered deterministically.
 *
 * A direct link in either direction is worth the same: "I mentioned you" and
 * "you mentioned me" are equally strong signals of relatedness, and weighting
 * one above the other would be an arbitrary claim about authorship.
 *
 * Ties break on title, then id, so the list never reshuffles between renders.
 * There is no similarity model here and deliberately so — the score is three
 * facts a user can check, not a number they have to trust.
 *
 * O(neighbours + notes sharing a tag), not O(N²): the tag index is built once.
 */
export function relatedNotes(index: KnowledgeIndex, noteId: string, limit = 10): RelatedNote[] {
  const subject = index.byId.get(noteId)
  if (subject === undefined || subject.deleted) return []

  const scores = new Map<string, { score: number; reasons: string[] }>()

  const add = (id: string, points: number, reason: string) => {
    if (id === noteId) return
    const target = index.byId.get(id)
    if (target === undefined || target.deleted) return
    const current = scores.get(id) ?? { score: 0, reasons: [] }
    current.score += points
    current.reasons.push(reason)
    scores.set(id, current)
  }

  for (const id of index.outgoing.get(noteId) ?? []) {
    add(id, RELATED_WEIGHTS.outgoing, 'Linked from this note')
  }
  for (const id of index.incoming.get(noteId) ?? []) {
    add(id, RELATED_WEIGHTS.backlink, 'Links to this note')
  }

  if (subject.tagIds.length > 0) {
    const wanted = new Set(subject.tagIds)
    for (const note of index.byId.values()) {
      if (note.deleted || note.id === noteId) continue
      const shared = note.tagIds.filter((tag) => wanted.has(tag))
      for (let i = 0; i < shared.length; i += 1) {
        add(note.id, RELATED_WEIGHTS.sharedTag, 'Shares a tag')
      }
    }
  }

  return [...scores.entries()]
    .map(([id, value]) => ({
      noteId: id,
      title: index.byId.get(id)?.title ?? '',
      score: value.score,
      // De-duplicated so "Shares a tag" appears once however many are shared;
      // the score already carries the magnitude.
      reasons: [...new Set(value.reasons)],
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.title.localeCompare(b.title) || a.noteId.localeCompare(b.noteId),
    )
    .slice(0, limit)
}
