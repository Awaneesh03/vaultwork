import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Plus, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { KNOWLEDGE_KIND_LABELS } from '@/integrations/obsidian/knowledge'
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
 *
 * M18.2 adds two facts to a row, each shown only when it is true: the note's
 * knowledge kind, and the Obsidian file it lives in. The file line appears only
 * once the note has actually been written to the vault — a path reserved but
 * never exported is not a file, and naming it would claim a relationship that
 * does not exist.
 */
export function BacklinksPanel({
  backlinks,
  onCreate,
  heading = 'Linked notes',
  actions,
  className,
}: {
  backlinks: Backlink[] | undefined
  /** Opens the composer pre-linked to this entity. */
  onCreate?: () => void
  /** "Knowledge" on a project, where this section is the knowledge layer. */
  heading?: string
  /** Extra controls beside the heading, such as a project's research pack. */
  actions?: ReactNode
  className?: string
}) {
  const notes = backlinks ?? []

  return (
    <section className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 t-eyebrow text-ink-3">
          {heading}
          {notes.length > 0 ? <span className="tabular ml-1.5">{notes.length}</span> : null}
        </h3>
        {actions}
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-body text-ink-2">{note.title}</span>
                    {note.kind !== null ? (
                      <Badge className="shrink-0">{KNOWLEDGE_KIND_LABELS[note.kind]}</Badge>
                    ) : null}
                  </span>
                  {note.excerpt.length > 0 ? (
                    <span className="block truncate text-meta text-ink-3">{note.excerpt}</span>
                  ) : null}
                  {note.obsidianPath !== null ? (
                    <span
                      className="flex min-w-0 items-center gap-1 text-meta text-ink-3"
                      title={note.obsidianPath}
                    >
                      <Sparkles size={10} className="shrink-0" aria-hidden />
                      <span className="truncate">
                        In Obsidian · {note.obsidianPath.split('/').pop()}
                      </span>
                    </span>
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
