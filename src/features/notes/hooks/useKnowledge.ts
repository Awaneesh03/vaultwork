import { useLiveQuery } from 'dexie-react-hooks'
import {
  getGraph,
  getNoteKnowledge,
  getNotesByTag,
  getOrphanNotes,
  type GraphViewOptions,
  type GraphViewData,
  type NoteKnowledge,
  type OrphanNote,
  type TaggedNotes,
} from '@/services'
import type { Id } from '@/types/entities'

/**
 * The knowledge layer, live.
 *
 * `useLiveQuery` re-runs whenever a table the query touched changes — notes and
 * tags — so typing `[[B]]` into note A makes B's backlinks appear without any
 * cache to invalidate. That is the payoff for keeping the index derived: there
 * is nothing to refresh, because there is nothing stored.
 *
 * Nothing here reads a file. The knowledge layer consumes Note records that M11
 * put there; a disconnected vault changes none of this.
 */

/** Everything one note's detail screen needs. `null` when the note is gone. */
export function useNoteKnowledge(noteId: Id | null): NoteKnowledge | null | undefined {
  return useLiveQuery(
    async () => (noteId === null ? null : ((await getNoteKnowledge(noteId)) ?? null)),
    [noteId],
  )
}

export function useKnowledgeGraph(options: GraphViewOptions): GraphViewData | undefined {
  return useLiveQuery(
    () => getGraph(options),
    // The options object is rebuilt on every render, so the dependency list
    // spells out its fields rather than relying on its identity.
    [options.filter, options.tagId, options.focusNoteId, options.depth],
  )
}

export function useOrphanNotes(): OrphanNote[] | undefined {
  return useLiveQuery(() => getOrphanNotes(), [])
}

export function useNotesByTag(tagId: Id | null): TaggedNotes | undefined {
  return useLiveQuery(
    async () => (tagId === null ? { tag: null, notes: [] } : await getNotesByTag(tagId)),
    [tagId],
  )
}
