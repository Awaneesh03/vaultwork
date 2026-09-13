import { Link } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { ROUTES } from '@/app/navigation'
import { formatEventTime } from '@/lib/date'
import type { RecentNote } from '@/services'

/**
 * Recently edited notes, on the Dashboard.
 *
 * Every figure comes from `noteQueryService.getRecentNotes` — the same source
 * the Notes screen reads — so the two cannot disagree. The card is a way back
 * into what you were writing, so each row is a link straight to the editor
 * rather than a preview that needs a second click.
 */
export function DashboardNotes({
  notes,
  now,
  today,
}: {
  notes: RecentNote[]
  now: number
  today: string
}) {
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {notes.map((note) => (
          <li key={note.id}>
            <Link
              to={ROUTES.note(note.id)}
              className="flex flex-col gap-0.5 px-3.5 py-1.5 hover:bg-elevated"
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-body text-ink-2">{note.title}</span>
                {note.linkCount > 0 ? (
                  <span
                    className="tabular inline-flex shrink-0 items-center gap-0.5 text-micro text-ink-3"
                    aria-label={`${note.linkCount} linked ${
                      note.linkCount === 1 ? 'item' : 'items'
                    }`}
                  >
                    <Link2 size={9} aria-hidden />
                    {note.linkCount}
                  </span>
                ) : null}
                <span className="tabular shrink-0 text-micro text-ink-3">
                  {formatEventTime(note.updatedAt, now, today)}
                </span>
              </span>
              {note.excerpt.length > 0 ? (
                <span className="truncate text-meta text-ink-3">{note.excerpt}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {notes.length === 0 ? (
        <p className="px-3.5 pb-2.5 pt-2 text-body text-ink-3">
          No notes yet. Press Shift+N anywhere to write one.
        </p>
      ) : null}
    </div>
  )
}
