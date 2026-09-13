import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CornerDownLeft, Plus, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { formatDayLabel, formatEstimate, formatTime } from '@/lib/date'
import type { DateStr, Project, Tag } from '@/types/entities'
import { useQuickAddPreview } from '../hooks/useQuickAddPreview'
import { HighlightedInput } from './HighlightedInput'
import { emptyComposerValue, type ComposerValue } from '../composerValue'
import { PRIORITY_LABELS } from '../priority'
import { TaskComposer } from './TaskComposer'

/**
 * The fast path.
 *
 * One field, one keystroke to submit. The value is parsed on every change, and
 * what the parser understood is painted into the input while you type — so the
 * syntax is discoverable by using it rather than by reading a help page.
 *
 * "More options" hands the parsed draft to the full composer, which means the
 * fast path is never a dead end: whatever you typed carries over.
 */

const SYNTAX_HINTS = [
  { token: 'tomorrow 7pm', means: 'when' },
  { token: '#tag', means: 'tag' },
  { token: '@project', means: 'project' },
  { token: '!high', means: 'priority' },
  { token: '~45m', means: 'estimate' },
]

export interface QuickAddBarProps {
  today: DateStr
  tags: Tag[]
  projects: Project[]
  /** Whatever the view implies — the Today screen pre-dates new tasks. */
  defaultDueDate?: DateStr | null
  /**
   * A time of day the view implies, used by the calendar when a task is
   * started from a specific slot.
   *
   * Like `defaultDueDate`, this only reaches the *composer*. Bare text is
   * parsed exactly as it is on every other screen, so "Study Java" typed on the
   * calendar produces the same task it produces in the Inbox — the M3 parser's
   * semantics are never bent by which screen you are standing on.
   */
  defaultDueTime?: string | null
  defaultProjectId?: string | null
  /** Opens straight into the composer — for "new task on this date/slot". */
  autoExpand?: boolean
  busy?: boolean
  autoFocus?: boolean
  /** Runs the raw text through the command layer as a `quickadd` intent. */
  onSubmitText: (text: string) => Promise<boolean>
  /** Submits the fully specified form instead. */
  onSubmitForm: (value: ComposerValue) => Promise<boolean>
  onCreateTag?: (name: string) => Promise<Tag | null>
  onDismiss?: () => void
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-sunken px-1.5 py-px text-[11px]">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink-2">{value}</span>
    </span>
  )
}

export function QuickAddBar({
  today,
  tags,
  projects,
  defaultDueDate = null,
  defaultDueTime = null,
  defaultProjectId = null,
  autoExpand = false,
  busy = false,
  autoFocus = false,
  onSubmitText,
  onSubmitForm,
  onCreateTag,
  onDismiss,
}: QuickAddBarProps) {
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(autoExpand)
  const [form, setForm] = useState<ComposerValue>(emptyComposerValue)
  const inputRef = useRef<HTMLInputElement>(null)

  const parse = useQuickAddPreview(text)
  const { draft } = parse

  useEffect(() => {
    if (autoFocus && !expanded) inputRef.current?.focus()
  }, [autoFocus, expanded])

  // Opening straight into the composer has to seed it, or the date and time the
  // caller asked for would be lost between mount and the first edit.
  useEffect(() => {
    if (!autoExpand) return
    setForm((current) => ({
      ...current,
      dueDate: current.dueDate.length > 0 ? current.dueDate : (defaultDueDate ?? ''),
      dueTime: current.dueTime.length > 0 ? current.dueTime : (defaultDueTime ?? ''),
      projectId: current.projectId ?? defaultProjectId ?? null,
    }))
  }, [autoExpand, defaultDueDate, defaultDueTime, defaultProjectId])

  const submitText = async () => {
    if (draft.title.trim().length === 0) return
    const ok = await onSubmitText(text)
    if (ok) setText('')
    inputRef.current?.focus()
  }

  /** Hands the parsed draft to the composer so nothing typed is lost. */
  const expand = () => {
    setForm({
      ...emptyComposerValue(),
      title: draft.title,
      description: draft.description ?? '',
      dueDate: draft.dueDate ?? defaultDueDate ?? '',
      dueTime: draft.dueTime ?? defaultDueTime ?? '',
      priority: draft.priority,
      projectId:
        projects.find(
          (project) => project.name.toLowerCase() === (draft.projectName ?? '').toLowerCase(),
        )?.id ??
        defaultProjectId ??
        null,
      tagIds: tags.filter((tag) => draft.tagNames.includes(tag.name)).map((tag) => tag.id),
      estimate: draft.estimateMin === null ? '' : String(draft.estimateMin),
    })
    setExpanded(true)
  }

  if (expanded) {
    return (
      <div className="rounded-lg border border-line bg-elevated p-3.5 sm:p-4">
        <TaskComposer
          mode="create"
          value={form}
          onChange={setForm}
          expandDetails={autoExpand}
          tags={tags}
          projects={projects}
          busy={busy}
          autoFocus
          {...(onCreateTag ? { onCreateTag } : {})}
          onSubmit={() => {
            void onSubmitForm(form).then((ok) => {
              if (!ok) return
              setForm(emptyComposerValue())
              setText('')
              setExpanded(false)
            })
          }}
          onCancel={() => {
            setExpanded(false)
            onDismiss?.()
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface transition-colors duration-[var(--duration-fast)]',
        text.length > 0 ? 'border-line-strong' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2.5 px-3">
        <Plus size={15} className="shrink-0 text-ink-3" aria-hidden />

        <HighlightedInput
          value={text}
          tokens={parse.tokens}
          onChange={setText}
          inputRef={inputRef}
          aria-label="Quick add a task"
          placeholder="Study Java tomorrow at 7pm #college !high @DSA ~45m"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submitText()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              if (text.length > 0) setText('')
              else onDismiss?.()
            }
          }}
        />

        <button
          type="button"
          onClick={expand}
          aria-label="More options"
          title="More options"
          className="shrink-0 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <Settings2 size={14} />
        </button>

        <Button
          variant="primary"
          size="sm"
          disabled={draft.title.trim().length === 0 || busy}
          onClick={() => void submitText()}
          icon={<CornerDownLeft size={12} aria-hidden />}
          className="shrink-0"
        >
          Add
        </Button>
      </div>

      {/* What the parser made of it, and what it could not. */}
      {text.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {draft.title.trim().length > 0 ? (
            <Chip label="title" value={draft.title} />
          ) : (
            <span className="text-[11px] text-ink-3">Type a title.</span>
          )}
          {draft.dueDate ? (
            <Chip
              label="due"
              // `today` is empty until the view's first read resolves, and
              // "Tomorrow" is meaningless without a today to be relative to —
              // so the raw date stands in rather than being computed against a
              // placeholder the date helpers rightly refuse.
              value={today.length > 0 ? formatDayLabel(draft.dueDate, today) : draft.dueDate}
            />
          ) : null}
          {draft.dueTime ? <Chip label="at" value={formatTime(draft.dueTime)} /> : null}
          {draft.priority !== 'none' ? (
            <Chip label="priority" value={PRIORITY_LABELS[draft.priority]} />
          ) : null}
          {draft.projectName ? <Chip label="project" value={draft.projectName} /> : null}
          {draft.tagNames.map((name) => (
            <Chip key={name} label="tag" value={name} />
          ))}
          {draft.estimateMin !== null ? (
            <Chip label="estimate" value={formatEstimate(draft.estimateMin)} />
          ) : null}
          {draft.description ? <Chip label="note" value={draft.description} /> : null}

          {parse.unknown.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-warn">
              <AlertCircle size={11} aria-hidden />
              kept in the title: {parse.unknown.join(' ')}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 sm:flex">
          {SYNTAX_HINTS.map((hint) => (
            <span key={hint.token} className="inline-flex items-center gap-1.5 text-[11px]">
              <Kbd>{hint.token}</Kbd>
              <span className="text-ink-3">{hint.means}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
