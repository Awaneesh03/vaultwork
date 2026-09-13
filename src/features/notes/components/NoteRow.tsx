import { Link } from 'react-router-dom'
import { ArchiveRestore, Link2, Tag as TagIcon, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
import type { NoteListItem } from '@/services'

/**
 * One note in the list.
 *
 * The four columns the milestone asks for — title, updated, tags, links — with
 * an excerpt underneath, because a list of titles alone is very hard to scan
 * when half your notes are called "Notes".
 *
 * Purely presentational: view model and callbacks in, no state, no hook.
 */
export function NoteRow({
  item,
  now,
  today,
  deleted = false,
  onDelete,
  onRestore,
}: {
  item: NoteListItem
  /** From the clock port via the view model — never read here. */
  now: number
  today: string
  deleted?: boolean
  onDelete: () => void
  onRestore: () => void
}) {
  const { note, title, excerpt, tags, linkCount } = item

  return (
    <div
      data-note-id={note.id}
      className={cn(
        'group/row flex items-start gap-3 rounded-md border border-transparent px-2 py-2 sm:px-2.5',
        'transition-colors duration-[var(--duration-fast)]',
        'hover:border-line hover:bg-surface',
        deleted && 'opacity-70',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to={`/notes/${note.id}`}
            title={title}
            className="min-w-0 max-w-full truncate text-strong font-medium leading-snug text-ink hover:text-accent"
          >
            {title}
          </Link>

          <span
            className="tabular shrink-0 text-meta text-ink-3"
            title={new Date(note.updatedAt).toLocaleString()}
          >
            {formatEventTime(note.updatedAt, now, today)}
          </span>

          {deleted ? (
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-micro text-ink-3">
              Deleted
            </span>
          ) : null}
        </div>

        {excerpt.length > 0 ? (
          <p className="mt-0.5 line-clamp-1 text-meta text-ink-3">{excerpt}</p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          {tags.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-ink-3">
              <TagIcon size={10} aria-hidden />
              {tags.map((tag) => tag.name).join(', ')}
            </span>
          ) : null}

          <span
            className="tabular inline-flex items-center gap-1 text-ink-3"
            aria-label={`${linkCount} linked ${linkCount === 1 ? 'item' : 'items'}`}
          >
            <Link2 size={10} aria-hidden />
            {linkCount}
          </span>

          {note.vaultPath ? (
            <span
              className="hidden truncate font-mono text-micro text-ink-3 sm:inline"
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
            className="rounded-md p-1.5 text-ink-3 hover:bg-elevated hover:text-ink"
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
