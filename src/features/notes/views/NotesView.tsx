import { useCallback, useEffect } from 'react'
import { FileText, Network, Plus } from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useSearchParams, Link } from 'react-router-dom'
import { useCommands } from '@/hooks/useCommands'
import type { NotesViewData } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { Id } from '@/types/entities'
import { NoteRow } from '../components/NoteRow'
import { NoteToolbar } from '../components/NoteToolbar'
import { useNoteTags, useNotesView } from '../hooks/useNotes'

/**
 * The Notes screen.
 *
 * A note is markdown plus references. It is the only entity here whose content
 * is free text, and the only one that already knows where it will live in an
 * Obsidian vault — every row shows its reserved path, because that path is a
 * promise M12 has to keep.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent. Nothing in
 * this file imports a service value or a repository.
 */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[68px] w-full" />
      ))}
    </div>
  )
}

export function NotesView() {
  const [searchParams] = useSearchParams()
  const data = useNotesView()
  const tags = useNoteTags()
  const { dispatch } = useCommands()

  const filter = useNoteUiStore((s) => s.filter)
  const search = useNoteUiStore((s) => s.search)
  const focusNonce = useNoteUiStore((s) => s.searchFocusNonce)
  const setFilter = useNoteUiStore((s) => s.setFilter)
  const tagId = useNoteUiStore((s) => s.tagId)
  const setTagId = useNoteUiStore((s) => s.setTagId)
  const setSearch = useNoteUiStore((s) => s.setSearch)
  const openComposer = useNoteUiStore((s) => s.openComposer)
  const reset = useNoteUiStore((s) => s.reset)

  // Filters are per-visit: arriving to find "deleted only" still applied is a
  // good way to think you have no notes.
  useEffect(() => {
    reset()
  }, [reset])

  // `?filter=orphans` and `?tag=` are entry points, so the graph and the tag
  // chips can link straight into a filtered list.
  const requestedFilter = searchParams.get('filter')
  const requestedTag = searchParams.get('tag')
  useEffect(() => {
    if (
      requestedFilter === 'orphans' ||
      requestedFilter === 'linked' ||
      requestedFilter === 'unlinked' ||
      requestedFilter === 'deleted'
    ) {
      setFilter(requestedFilter)
    }
    setTagId(requestedTag)
  }, [requestedFilter, requestedTag, setFilter, setTagId])

  const remove = useCallback(
    (noteId: Id) =>
      // No confirmation: the delete is soft, the links are kept, and the toast
      // holds an undo.
      void dispatch({ kind: 'note.delete', source: 'ui', raw: '', ref: { by: 'id', id: noteId } }),
    [dispatch],
  )

  const restore = useCallback(
    (noteId: Id) => void dispatch({ kind: 'note.restore', source: 'ui', raw: '', noteId }),
    [dispatch],
  )

  const searching = search.trim().length > 0

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <FileText size={18} className="text-accent" aria-hidden />
          <h2 className="text-display font-semibold tracking-tight text-ink">Notes</h2>
          {data ? (
            <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-2">
              {data.counts.all}
            </span>
          ) : null}
          <span className="flex-1" />
          <Link
            to="/notes/graph"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-body font-medium text-ink-2 hover:border-accent-line hover:text-ink"
          >
            <Network size={12} aria-hidden />
            Graph
          </Link>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openComposer()}
            icon={<Plus size={12} aria-hidden />}
          >
            New note
          </Button>
        </div>
        <p className="max-w-prose text-strong text-ink-2">
          Markdown, linked to the work it is about. Every note already reserves its place in an
          Obsidian vault, so syncing later moves files rather than migrating data.
        </p>
      </header>

      <NoteToolbar
        filter={filter}
        search={search}
        counts={data?.counts ?? { all: 0, linked: 0, unlinked: 0, orphans: 0, deleted: 0 }}
        focusNonce={focusNonce}
        onFilter={setFilter}
        onSearch={setSearch}
      />

      {tagId !== null ? (
        <p className="flex flex-wrap items-center gap-2 text-body text-ink-2">
          <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-meta text-accent">
            #{tags?.find((tag) => tag.id === tagId)?.name ?? 'tag'}
          </span>
          <button
            type="button"
            onClick={() => setTagId(null)}
            className="text-meta text-accent underline decoration-dotted"
          >
            Clear tag
          </button>
        </p>
      ) : null}

      <DataView<NotesViewData>
        data={data}
        loading={<ListSkeleton />}
        isEmpty={(value) => value.notes.length === 0}
        empty={
          <EmptyState
            icon={<FileText size={20} aria-hidden />}
            title={data?.empty ? 'No notes yet' : 'Nothing matches'}
            description={
              data?.empty
                ? 'A note is somewhere to think. Press Shift+N anywhere, or use /add note Binary search.'
                : searching
                  ? `Nothing in this filter matches “${search.trim()}”.`
                  : 'This filter is empty. Try another.'
            }
            action={
              data?.empty ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openComposer()}
                  icon={<Plus size={12} aria-hidden />}
                >
                  New note
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                  className="text-body text-accent underline decoration-dotted"
                >
                  Clear filters
                </button>
              )
            }
          />
        }
      >
        {(value) => (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-0.5">
              {value.notes.map((item) => (
                <li key={item.note.id} className="list-none">
                  <NoteRow
                    item={item}
                    now={value.now}
                    today={value.today}
                    deleted={item.note.deletedAt !== null}
                    onDelete={() => remove(item.note.id)}
                    onRestore={() => restore(item.note.id)}
                  />
                </li>
              ))}
            </ul>

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-meta text-ink-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>shift N</Kbd> new note, anywhere
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>/</Kbd> search
              </span>
            </p>
          </div>
        )}
      </DataView>
    </section>
  )
}
