import { useCallback, useEffect, useRef } from 'react'
import { FileText, Network, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useSearchParams, useParams, Link } from 'react-router-dom'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import type { NotesViewData } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { Id } from '@/types/entities'
import { NoteRow } from '../components/NoteRow'
import { NoteToolbar } from '../components/NoteToolbar'
import { useNoteTags, useNotesView } from '../hooks/useNotes'
import { NoteDetailView } from './NoteDetailView'

/**
 * The Notes workspace.
 *
 * One screen, two panes: the rail on the left is *where you are in the
 * collection*, the pane on the right is *the note you are reading*. Both routes
 * — `/notes` and `/notes/:noteId` — render this, so opening a note no longer
 * replaces the list with a page that has a back button on it. Filtering, then
 * reading, then filtering again is the loop this screen exists for, and it used
 * to cost a navigation each way.
 *
 * Below `lg` there is not room for two columns, so the rail and the pane take
 * turns: the list until a note is chosen, the note after that. The pane carries
 * its own way back, which is why it is not repeated here.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent. Nothing in
 * this file imports a service value or a repository.
 */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[58px] w-full" />
      ))}
    </div>
  )
}

/**
 * Arrow-key movement down the rail.
 *
 * The rows are links, so Tab already reaches them — but tabbing through a
 * hundred notes to reach the one below is not navigation. Up and Down move
 * between rows, Home and End jump the ends, and Enter is left alone because a
 * focused link already does the right thing with it.
 */
function useRailKeys() {
  const rail = useRef<HTMLUListElement>(null)

  return {
    ref: rail,
    onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
      if (!keys.includes(event.key)) return

      const links = Array.from(
        rail.current?.querySelectorAll<HTMLAnchorElement>('a[data-rail-row]') ?? [],
      )
      if (links.length === 0) return

      const at = links.indexOf(document.activeElement as HTMLAnchorElement)
      // Arrowing from anywhere else in the rail — the search box, a filter —
      // starts at the top rather than doing nothing.
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? links.length - 1
            : at < 0
              ? 0
              : Math.min(links.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))

      event.preventDefault()
      links[next]?.focus()
    },
  }
}

export function NotesView() {
  const [searchParams] = useSearchParams()
  const { noteId = null } = useParams<{ noteId: string }>()
  const data = useNotesView()
  const tags = useNoteTags()
  const { dispatch } = useCommands()
  const rail = useRailKeys()

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
    (id: Id) =>
      // No confirmation: the delete is soft, the links are kept, and the toast
      // holds an undo.
      void dispatch({ kind: 'note.delete', source: 'ui', raw: '', ref: { by: 'id', id } }),
    [dispatch],
  )

  const restore = useCallback(
    (id: Id) => void dispatch({ kind: 'note.restore', source: 'ui', raw: '', noteId: id }),
    [dispatch],
  )

  const searching = search.trim().length > 0
  const open = noteId !== null

  return (
    <section className="flex flex-col gap-5">
      <PageHeader
        icon={<FileText size={15} aria-hidden />}
        title="Notes"
        description="Markdown, linked to the work it is about. Every note already reserves its place in an Obsidian vault, so syncing later moves files rather than migrating data."
        meta={data ? <span className="tabular">{data.counts.all} notes</span> : null}
        actions={
          <>
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
          </>
        }
      />

      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        {/*
          The rail. Sticky and independently scrollable on a wide screen so the
          collection stays put while you read down a long note; on a narrow one
          it is simply the page until a note is open.
        */}
        <aside
          aria-label="Notes"
          className={cn(
            'flex min-w-0 flex-col gap-3',
            'lg:sticky lg:top-0 lg:max-h-[calc(100dvh-10rem)] lg:self-start',
            open && 'hidden lg:flex',
          )}
        >
          <NoteToolbar
            filter={filter}
            search={search}
            counts={data?.counts ?? { all: 0, linked: 0, unlinked: 0, orphans: 0, deleted: 0 }}
            focusNonce={focusNonce}
            onFilter={setFilter}
            onSearch={setSearch}
          />

          {tagId !== null ? (
            <p className="flex flex-wrap items-center gap-2 text-meta">
              <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-accent">
                #{tags?.find((tag) => tag.id === tagId)?.name ?? 'tag'}
              </span>
              <button
                type="button"
                onClick={() => setTagId(null)}
                className="text-accent underline decoration-dotted"
              >
                Clear tag
              </button>
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-sidebar">
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
                <ul
                  ref={rail.ref}
                  onKeyDown={rail.onKeyDown}
                  className="flex flex-col gap-px p-1.5"
                >
                  {value.notes.map((item) => (
                    <li key={item.note.id} className="list-none">
                      <NoteRow
                        item={item}
                        now={value.now}
                        today={value.today}
                        deleted={item.note.deletedAt !== null}
                        selected={item.note.id === noteId}
                        onDelete={() => remove(item.note.id)}
                        onRestore={() => restore(item.note.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </DataView>
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-micro text-ink-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>shift N</Kbd> new note
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>/</Kbd> search
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↑ ↓</Kbd> move
            </span>
          </p>
        </aside>

        <div className={cn('min-w-0', !open && 'hidden lg:block')}>
          {open ? <NoteDetailView /> : <NothingOpen />}
        </div>
      </div>
    </section>
  )
}

/**
 * The reading pane with nothing in it.
 *
 * Deliberately not an error and not a call to action for a *new* note — the
 * list beside it is full of notes and the header already has the button. What
 * this has to say is which pane is which.
 */
function NothingOpen() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-line bg-surface/40 px-6">
      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <span
          className="grid h-10 w-10 place-items-center rounded-lg bg-sunken text-ink-3"
          aria-hidden
        >
          <FileText size={18} />
        </span>
        <p className="t-section text-ink-2">Nothing open</p>
        <p className="t-meta text-ink-3">
          Choose a note from the list to read or edit it. Arrow keys move down the list.
        </p>
      </div>
    </div>
  )
}
