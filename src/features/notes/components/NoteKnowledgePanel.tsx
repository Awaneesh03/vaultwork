import { Link } from 'react-router-dom'
import {
  ArrowLeftRight,
  ArrowUpRight,
  CircleHelp,
  Hash,
  Network,
  Split,
  Unlink,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NoteKnowledge } from '@/services'
import { KnowledgeGraphView } from './KnowledgeGraph'

/**
 * What a note is connected to.
 *
 * Everything here is derived on read — no backlink, edge or score is stored, so
 * this panel cannot go stale relative to the note bodies it describes.
 *
 * The three failure kinds are kept visibly apart rather than lumped into "broken
 * links", because they call for different actions: an *unresolved* link needs a
 * note written, a *deleted* one needs a note restored, and an *ambiguous* one
 * needs the writer to say which of several notes they meant. Collapsing them
 * would leave the user guessing which.
 */

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Network
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 t-eyebrow text-ink-3">
        <Icon size={11} aria-hidden />
        {title}
        {typeof count === 'number' && count > 0 ? (
          <span className="tabular text-ink-3">{count}</span>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

const EMPTY = (text: string) => <p className="text-[12px] text-ink-3">{text}</p>

export function NoteKnowledgePanel({
  knowledge,
  className,
  onOpenNote,
}: {
  knowledge: NoteKnowledge | null | undefined
  className?: string
  onOpenNote?: (noteId: string) => void
}) {
  if (knowledge === undefined) {
    return <p className={cn('text-[12px] text-ink-3', className)}>Loading connections…</p>
  }
  if (knowledge === null) return null

  const { outgoing, unresolved, ambiguous, backlinks, related, graph, isOrphan } = knowledge

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <Section icon={ArrowUpRight} title="Outgoing links" count={outgoing.length}>
        {outgoing.length === 0 ? (
          EMPTY('This note links to nothing yet. Write [[a note title]] in the body.')
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {outgoing.map((link, index) => (
              <li key={`${link.raw}-${index}`}>
                <Link
                  to={
                    link.headingSlug === null
                      ? `/notes/${link.target.noteId}`
                      : `/notes/${link.target.noteId}#${link.headingSlug}`
                  }
                  className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5 hover:bg-elevated"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                    {link.label}
                  </span>
                  {link.heading !== null ? (
                    <span
                      className={cn(
                        'shrink-0 text-[11px]',
                        link.headingMissing ? 'text-warn' : 'text-ink-3',
                      )}
                    >
                      #{link.heading}
                      {/* The note was found; only the heading was not. Saying
                          "missing" outright would send the user looking for a
                          note that is right there. */}
                      {link.headingMissing ? ' · no such heading' : ''}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{link.raw}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {unresolved.length > 0 ? (
        <Section icon={Unlink} title="Unresolved" count={unresolved.length}>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {unresolved.map((link, index) => (
              <li
                key={`${link.raw}-${index}`}
                className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5 text-[12.5px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                  {link.raw}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-1.5 py-px text-[10.5px]',
                    link.reason === 'deleted'
                      ? 'bg-danger-soft text-danger'
                      : 'bg-sunken text-ink-3',
                  )}
                >
                  {link.reason === 'deleted' ? 'In the trash' : 'No such note'}
                </span>
                {link.deletedNoteId !== null ? (
                  <Link
                    to={`/notes/${link.deletedNoteId}`}
                    className="shrink-0 text-[11.5px] text-accent underline decoration-dotted"
                  >
                    Open it
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {ambiguous.length > 0 ? (
        <Section icon={Split} title="Ambiguous" count={ambiguous.length}>
          <ul className="flex flex-col gap-1.5">
            {ambiguous.map((link, index) => (
              <li
                key={`${link.raw}-${index}`}
                className="flex flex-col gap-1 rounded-md border border-line px-2.5 py-1.5"
              >
                <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                  <span className="font-mono text-[11.5px] text-ink-2">{link.raw}</span>
                  <span className="text-[11px] text-ink-3">
                    matches {link.candidates.length} notes — Vaultwork will not choose
                  </span>
                </p>
                <ul className="flex flex-wrap gap-1">
                  {link.candidates.map((candidate) => (
                    <li key={candidate.noteId}>
                      <Link
                        to={`/notes/${candidate.noteId}`}
                        className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:border-accent-line hover:text-ink"
                      >
                        {candidate.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section icon={ArrowLeftRight} title="Backlinks" count={backlinks.length}>
        {backlinks.length === 0 ? (
          EMPTY('No note links here yet.')
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {backlinks.map((backlink) => (
              <li key={backlink.noteId}>
                <Link
                  to={`/notes/${backlink.noteId}`}
                  className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5 hover:bg-elevated"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                    {backlink.title}
                  </span>
                  {backlink.contexts.length > 1 ? (
                    <span className="tabular shrink-0 text-[11px] text-ink-3">
                      {backlink.contexts.length} mentions
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Hash} title="Related" count={related.length}>
        {related.length === 0 ? (
          EMPTY('Nothing related yet — relatedness comes from links and shared tags.')
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {related.map((row) => (
              <li key={row.noteId}>
                <Link
                  to={`/notes/${row.noteId}`}
                  className="flex flex-wrap items-baseline gap-x-2 px-2.5 py-1.5 hover:bg-elevated"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                    {row.title}
                  </span>
                  {/* The score is explained rather than asserted: three facts a
                      user can check, not a number they have to trust. */}
                  <span className="shrink-0 text-[11px] text-ink-3">{row.reasons.join(' · ')}</span>
                  <span
                    className="tabular shrink-0 text-[11px] text-ink-3"
                    aria-label={`Relatedness score ${row.score}`}
                  >
                    {row.score}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Network} title="Local graph">
        {isOrphan ? (
          <p className="inline-flex items-start gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
            <CircleHelp size={11} className="mt-[2px] shrink-0" aria-hidden />
            Nothing links here and this links nowhere — an orphan. Tags do not change that; a tag is
            a label, a link is a relationship.
          </p>
        ) : (
          <KnowledgeGraphView
            nodes={graph.nodes}
            edges={graph.edges}
            focusNoteId={knowledge.noteId}
            height={280}
            {...(onOpenNote ? { onOpen: onOpenNote } : {})}
          />
        )}
      </Section>
    </div>
  )
}
