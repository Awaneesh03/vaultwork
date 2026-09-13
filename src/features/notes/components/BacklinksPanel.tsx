import { Link } from 'react-router-dom'
import { FileText, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Backlink } from '@/services'

/**
 * The notes referencing one entity.
 *
 * One component, used unchanged by the task, project, goal and habit panels —
 * a backlink means the same thing everywhere, so there is one implementation
 * rather than four that drift.
 *
 * `undefined` is the loading state; an empty array means genuinely none, and
 * says so rather than rendering nothing at all, because "no notes yet" and
 * "still loading" look identical otherwise.
 */
export function BacklinksPanel({
  backlinks,
  onCreate,
  className,
}: {
  backlinks: Backlink[] | undefined
  /** Opens the composer pre-linked to this entity. */
  onCreate?: () => void
  className?: string
}) {
  const notes = backlinks ?? []

  return (
    <section className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 t-eyebrow text-ink-3">
          Linked notes
          {notes.length > 0 ? <span className="tabular ml-1.5">{notes.length}</span> : null}
        </h3>
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-meta text-ink-2 hover:border-accent-line hover:text-ink"
          >
            <Plus size={10} aria-hidden />
            Note
          </button>
        ) : null}
      </div>

      {backlinks === undefined ? (
        <p className="text-body text-ink-3">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-body text-ink-3">No notes reference this yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {notes.map((note) => (
            <li key={note.noteId}>
              <Link
                to={`/notes/${note.noteId}`}
                className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-elevated"
              >
                <FileText size={12} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink-2">{note.title}</span>
                  {note.excerpt.length > 0 ? (
                    <span className="block truncate text-meta text-ink-3">{note.excerpt}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
