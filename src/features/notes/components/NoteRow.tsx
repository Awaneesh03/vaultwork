import { Link } from 'react-router-dom'
import { ArchiveRestore, Link2, Tag as TagIcon, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
import type { NoteListItem } from '@/services'

/**
 * One note in the rail.
 *
 * The four facts the milestone asks for — title, updated, tags, links — with an
 * excerpt underneath, because a column of titles alone is very hard to scan
 * when half your notes are called "Notes".
 *
 * The selected row is marked three ways that do not depend on each other: an
 * accent rail down its left edge, a raised surface, and `aria-current`. Colour
 * alone would fail anyone who cannot see it and would vanish against a bright
 * display; the rail is a shape, and `aria-current` is a fact.
 *
 * Purely presentational: view model and callbacks in, no state, no hook.
 */
export function NoteRow({
  item,
  now,
  today,
  deleted = false,
  selected = false,
  onDelete,
  onRestore,
}: {
  item: NoteListItem
  /** From the clock port via the view model — never read here. */
  now: number
  today: string
  deleted?: boolean
  /** The note currently open in the reading pane. */
  selected?: boolean
  onDelete: () => void
  onRestore: () => void
}) {
  const { note, title, excerpt, tags, linkCount } = item

  return (
    <div
      data-note-id={note.id}
      className={cn(
        'group/row relative flex items-start gap-2 rounded-md py-2 pl-3 pr-1.5',
        'transition-colors duration-[var(--duration-fast)]',
        selected ? 'bg-elevated' : 'hover:bg-surface',
        deleted && 'opacity-70',
      )}
    >
      {/*
        The rail. Always present so the row never changes width when it is
        chosen — a list that reflows as you arrow down it is unreadable.
      */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1.5 left-0 w-[3px] rounded-full transition-colors',
          selected ? 'bg-accent' : 'bg-transparent',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Link
            to={`/notes/${note.id}`}
            title={title}
            /* The handle the rail's arrow-key navigation walks. */
            data-rail-row=""
            {...(selected ? { 'aria-current': 'page' as const } : {})}
            className={cn(
              'min-w-0 flex-1 truncate text-strong leading-snug hover:text-accent',
              selected ? 'font-semibold text-ink' : 'font-medium text-ink-2',
            )}
          >
            {title}
          </Link>

          <span
            className="tabular shrink-0 text-micro text-ink-3"
            title={new Date(note.updatedAt).toLocaleString()}
          >
            {formatEventTime(note.updatedAt, now, today)}
          </span>
        </div>

        {excerpt.length > 0 ? (
          <p className="mt-0.5 line-clamp-2 text-meta leading-snug text-ink-3">{excerpt}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-micro">
          {deleted ? (
            <span className="rounded-sm bg-sunken px-1 py-px text-ink-3">Deleted</span>
          ) : null}

          {tags.length > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-ink-3">
              <TagIcon size={9} className="shrink-0" aria-hidden />
              <span className="truncate">{tags.map((tag) => tag.name).join(', ')}</span>
            </span>
          ) : null}

          {/*
            Zero links is worth drawing: it is the difference between a note
            that sits in the graph and one that does not, which is exactly what
            the Orphans filter is about.
          */}
          <span
            className="tabular inline-flex items-center gap-1 text-ink-3"
            aria-label={`${linkCount} linked ${linkCount === 1 ? 'item' : 'items'}`}
          >
            <Link2 size={9} aria-hidden />
            {linkCount}
          </span>

          {note.vaultPath ? (
            <span
              className="hidden min-w-0 truncate font-mono text-ink-3 2xl:inline"
              title={note.vaultPath}
            >
              {note.vaultPath}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover/row:opacity-100',
        )}
      >
        {deleted ? (
          <button
            type="button"
            onClick={onRestore}
            aria-label={`Restore ${title}`}
            className="rounded-md p-1.5 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <ArchiveRestore size={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${title}`}
            className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
