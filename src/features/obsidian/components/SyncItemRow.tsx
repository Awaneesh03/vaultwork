import { Link } from 'react-router-dom'
import { ArrowRight, FileText, GitCompare } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
import {
  documentOptionsFor,
  optionsFor,
  type SyncDecision,
  type SyncItem,
} from '@/integrations/obsidian/syncPlan'
import { SyncStatusBadge } from './SyncStatusBadge'
import { SYNC_STATUS_DESCRIPTIONS } from '../obsidianAppearance'

/**
 * One row in the Sync Center.
 *
 * Every row states what it is, where it lives, why it is in that state, and
 * what can be done about it — in words. The chosen action is a radio group
 * rather than a set of buttons, because these are mutually exclusive choices
 * that are *staged* and applied together, not performed on click.
 *
 * `Skip` is always present and always the default. Doing nothing must never be
 * harder to choose than doing something.
 */
export function SyncItemRow({
  item,
  decision,
  now,
  today,
  onDecide,
  onCompare,
}: {
  item: SyncItem
  decision: SyncDecision
  now: number
  today: string
  onDecide: (decision: SyncDecision) => void
  onCompare?: () => void
}) {
  const isDocument = item.itemKind === 'document'
  // A document's actions are a strict subset: there is no export side, because
  // Vaultwork never writes a PDF.
  const options = isDocument ? documentOptionsFor(item.status) : optionsFor(item.status)
  // Comparing needs two editable versions. A PDF has one, and it is not ours.
  const comparable = !isDocument && (item.status === 'conflict' || item.status === 'moved-change')

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {isDocument ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-strong font-medium text-ink">
            {/* The kind is shown, not merely implied by which list it is in. */}
            <FileText size={12} className="shrink-0 text-ink-3" aria-hidden />
            {item.title}
            <span className="sr-only"> (PDF document)</span>
          </span>
        ) : item.noteId === null ? (
          <span className="min-w-0 max-w-full truncate text-strong font-medium text-ink">
            {item.title}
          </span>
        ) : (
          <Link
            to={`/notes/${item.noteId}`}
            className="min-w-0 max-w-full truncate text-strong font-medium text-ink hover:text-accent"
          >
            {item.title}
          </Link>
        )}
        <SyncStatusBadge status={item.status} />
      </div>

      {/*
        Where it lives. Quiet and monospaced: a path is something you check,
        not something you read, and four paragraphs of equal grey is the wall
        of small text this row used to be.
      */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro text-ink-3">
        {item.previousPath ? (
          <>
            <span className="min-w-0 truncate font-mono" title={item.previousPath}>
              {item.previousPath}
            </span>
            <ArrowRight size={10} aria-hidden className="shrink-0" />
          </>
        ) : null}
        <span className="min-w-0 truncate font-mono" title={item.path ?? undefined}>
          {item.path ?? 'No vault path'}
        </span>
        {item.otherPath ? (
          <span className="min-w-0 truncate font-mono" title={item.otherPath}>
            · also {item.otherPath}
          </span>
        ) : null}
      </p>

      {/*
        Why it is in this state — the one sentence in the row that decides what
        the reader does next, so it is the one sentence set as body text.
      */}
      <p className="max-w-prose text-body leading-relaxed text-ink-2">
        {item.message ?? SYNC_STATUS_DESCRIPTIONS[item.status]}
      </p>

      {item.noteUpdatedAt !== null || item.fileUpdatedAt !== null ? (
        <p className="flex flex-wrap gap-x-3 text-micro text-ink-3">
          {item.noteUpdatedAt !== null ? (
            <span>Vaultwork changed {formatEventTime(item.noteUpdatedAt, now, today)}</span>
          ) : null}
          {item.fileUpdatedAt !== null ? (
            <span>Obsidian changed {formatEventTime(item.fileUpdatedAt, now, today)}</span>
          ) : null}
        </p>
      ) : null}

      {options.length === 0 ? (
        <p className="text-meta italic text-ink-3">
          Nothing can be done safely here. Resolve it in Obsidian, then scan again.
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={`What to do about ${item.title}`}
          className="flex flex-wrap items-center gap-1"
        >
          {options.map((option) => {
            const chosen = decision === option.decision
            return (
              <button
                key={option.decision}
                type="button"
                role="radio"
                aria-checked={chosen}
                title={option.hint}
                onClick={() => onDecide(option.decision)}
                className={cn(
                  'rounded-md border px-2 py-1 text-meta transition-colors',
                  'duration-[var(--duration-fast)]',
                  chosen
                    ? option.destructive
                      ? 'border-danger bg-danger-soft text-danger'
                      : 'border-accent-line bg-accent-soft text-accent'
                    : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
                )}
              >
                {option.label}
                {/* Marked in text, not only by colour. */}
                {option.destructive ? <span className="sr-only"> (replaces content)</span> : null}
              </button>
            )
          })}

          {comparable && onCompare ? (
            <button
              type="button"
              onClick={onCompare}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-meta text-ink-3 hover:border-line-strong hover:text-ink-2"
            >
              <GitCompare size={11} aria-hidden />
              Compare
            </button>
          ) : null}
        </div>
      )}
    </li>
  )
}
