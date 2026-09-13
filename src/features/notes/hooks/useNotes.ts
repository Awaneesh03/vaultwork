import { useLiveQuery } from 'dexie-react-hooks'
import {
  getBacklinks,
  getLinkCandidates,
  listTags,
  getNoteDetail,
  getNotesView,
  type Backlink,
  type LinkCandidate,
  type NoteDetailData,
  type NotesViewData,
} from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { Id, Tag } from '@/types/entities'
import type { RefType } from '@/types/enums'

/**
 * The Notes screens, live.
 *
 * `useLiveQuery` re-runs whenever a table the query touched changes — notes,
 * noteLinks, tags, and the four linkable entity tables — so renaming a task
 * updates the label inside every note that references it with no cache to
 * invalidate and no propagation step.
 */
export function useNotesView(): NotesViewData | undefined {
  const filter = useNoteUiStore((s) => s.filter)
  const search = useNoteUiStore((s) => s.search)
  const tagId = useNoteUiStore((s) => s.tagId)

  return useLiveQuery(() => getNotesView({ filter, search, tagId }), [filter, search, tagId])
}

/** One note, its links and every tag. `null` when it does not exist. */
export function useNoteDetail(noteId: Id | null): NoteDetailData | null | undefined {
  return useLiveQuery(
    async () => (noteId === null ? null : ((await getNoteDetail(noteId)) ?? null)),
    [noteId],
  )
}

/**
 * The notes referencing one entity.
 *
 * Used by the task, project, goal and habit panels. Passing `null` disables the
 * query so a closed panel does not read.
 */
export function useBacklinks(refType: RefType, refId: Id | null): Backlink[] | undefined {
  return useLiveQuery(
    async () => (refId === null ? [] : await getBacklinks(refType, refId)),
    [refType, refId],
  )
}

/** Everything linkable, for the picker. Live, so a new task appears at once. */
export function useLinkCandidates(): LinkCandidate[] | undefined {
  return useLiveQuery(() => getLinkCandidates(), [])
}

/** Every tag, for the graph and tag filters. */
export function useNoteTags(): Tag[] | undefined {
  return useLiveQuery(() => listTags(), [])
}
