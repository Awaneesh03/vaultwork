import { useId, useState } from 'react'
import { Check, HelpCircle, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { KNOWLEDGE_KIND_LABELS } from '@/integrations/obsidian/knowledge'
import type { InboxItem, InboxProposal } from '@/services'
import type { Id } from '@/types/entities'
import { INBOX_TYPES, KNOWLEDGE_KINDS, type InboxType, type KnowledgeKind } from '@/types/enums'
import { INBOX_TYPE_LABELS, QUESTION_LABELS } from '../inboxAppearance'

/**
 * One capture's proposal: what Vaultwork thinks it is, and the controls to
 * change that before anything runs (M18.3).
 *
 * Used unchanged by the capture dialog and by the Inbox queue — one editor, so
 * correcting a proposal works the same wherever it is done. Nothing here writes:
 * Accept hands the edited proposal up, and the service validates it before the
 * executor ever sees it.
 */

const titleOf = (proposal: InboxProposal) => ('title' in proposal ? proposal.title : proposal.name)

/** Moves a proposal to another type, keeping every field the two share. */
function convert(proposal: InboxProposal, type: InboxType): InboxProposal {
  const title = titleOf(proposal)
  const projectId = 'projectId' in proposal ? proposal.projectId : null
  const dated = proposal.type === 'task' || proposal.type === 'event'
  switch (type) {
    case 'task':
    case 'event':
      return {
        type,
        title,
        dueDate: dated ? proposal.dueDate : null,
        dueTime: dated ? proposal.dueTime : null,
        projectId,
      }
    case 'note':
      return { type, title, body: proposal.type === 'note' ? proposal.body : title }
    case 'knowledge':
      return {
        type,
        title,
        kind: proposal.type === 'knowledge' ? proposal.kind : 'research',
        projectId,
      }
    case 'project':
    case 'habit':
      return { type, name: title }
    case 'goal':
      return { type, title }
  }
}

function withTitle(proposal: InboxProposal, title: string): InboxProposal {
  return 'title' in proposal ? { ...proposal, title } : { ...proposal, name: title }
}

/** Enough to enable Accept; the service does the real validation. */
function ready(proposal: InboxProposal): boolean {
  if (titleOf(proposal).trim().length === 0) return false
  if (proposal.type === 'event') return proposal.dueDate !== null && proposal.dueTime !== null
  return true
}

const FIELD =
  'rounded-md border border-line bg-surface px-2 py-1 text-body text-ink focus:border-accent-line'

export function ProposalEditor({
  item,
  projects,
  busy,
  editing: startEditing = false,
  onAccept,
  onDismiss,
}: {
  item: InboxItem
  projects: { id: Id; name: string }[]
  busy: boolean
  /** Open with the fields showing — the dialog does; the queue waits for Edit. */
  editing?: boolean
  /** Resolves to an error message when the proposal was refused. */
  onAccept: (proposal: InboxProposal) => Promise<string | null>
  onDismiss: () => void
}) {
  const { classification } = item
  const [proposal, setProposal] = useState<InboxProposal>(classification.proposal)
  const [question, setQuestion] = useState(classification.question)
  const [editing, setEditing] = useState(startEditing)
  const [error, setError] = useState<string | null>(null)
  const ids = useId()

  // Any edit answers an open "Needs a detail": the field *is* the answer.
  const change = (next: InboxProposal) => {
    setProposal(next)
    setQuestion(null)
    setError(null)
  }

  const accept = async () => {
    setError(await onAccept(proposal))
  }

  const dated = proposal.type === 'task' || proposal.type === 'event'
  const canAccept = !busy && question === null && ready(proposal)

  return (
    <div className="flex flex-col gap-2" aria-labelledby={`${ids}-summary`}>
      <p id={`${ids}-summary`} className="flex flex-wrap items-center gap-1.5 text-body text-ink-2">
        <span className="text-ink-3" aria-hidden>
          →
        </span>
        <Badge tone="accent">{INBOX_TYPE_LABELS[proposal.type]}</Badge>
        <span className="min-w-0 text-ink">{titleOf(proposal)}</span>
        {dated && proposal.dueDate !== null ? (
          <span className="tabular text-meta text-ink-3">
            {proposal.dueDate}
            {proposal.dueTime !== null ? ` · ${proposal.dueTime}` : ''}
          </span>
        ) : null}
      </p>
      <p className="text-meta text-ink-3">{classification.reason}</p>

      {question !== null ? (
        <div
          role="group"
          aria-label={QUESTION_LABELS[question.kind]}
          className="flex flex-col gap-1.5 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-2"
        >
          <p className="flex items-center gap-1.5 text-body text-ink">
            <HelpCircle size={13} className="shrink-0 text-warn" aria-hidden />
            <span className="t-eyebrow text-warn">{QUESTION_LABELS[question.kind]}</span>
            <span>{question.question}</span>
          </p>
          {question.options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <Button
                  key={option.label}
                  size="sm"
                  variant="secondary"
                  onClick={() => change(option.proposal)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-meta text-ink-3">Fill it in below, then accept.</p>
          )}
        </div>
      ) : null}

      {editing || (question !== null && question.options.length === 0) ? (
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="sr-only">Edit the proposal</legend>
          <label className="flex flex-col gap-0.5 text-meta text-ink-3">
            Type
            <select
              className={FIELD}
              value={proposal.type}
              onChange={(event) => change(convert(proposal, event.target.value as InboxType))}
            >
              {INBOX_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INBOX_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-48 flex-1 flex-col gap-0.5 text-meta text-ink-3">
            {'name' in proposal ? 'Name' : 'Title'}
            <input
              className={FIELD}
              value={titleOf(proposal)}
              onChange={(event) => change(withTitle(proposal, event.target.value))}
            />
          </label>

          {dated ? (
            <>
              <label className="flex flex-col gap-0.5 text-meta text-ink-3">
                Date
                <input
                  type="date"
                  className={FIELD}
                  value={proposal.dueDate ?? ''}
                  onChange={(event) => change({ ...proposal, dueDate: event.target.value || null })}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-meta text-ink-3">
                Time
                <input
                  type="time"
                  className={FIELD}
                  value={proposal.dueTime ?? ''}
                  onChange={(event) => change({ ...proposal, dueTime: event.target.value || null })}
                />
              </label>
            </>
          ) : null}

          {proposal.type === 'knowledge' ? (
            <label className="flex flex-col gap-0.5 text-meta text-ink-3">
              Kind
              <select
                className={FIELD}
                value={proposal.kind}
                onChange={(event) =>
                  change({ ...proposal, kind: event.target.value as KnowledgeKind })
                }
              >
                {KNOWLEDGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KNOWLEDGE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {'projectId' in proposal ? (
            <label className="flex flex-col gap-0.5 text-meta text-ink-3">
              Project
              <select
                className={FIELD}
                value={proposal.projectId ?? ''}
                onChange={(event) => change({ ...proposal, projectId: event.target.value || null })}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {proposal.type === 'note' ? (
            <label className="flex w-full flex-col gap-0.5 text-meta text-ink-3">
              Note
              <textarea
                className={`${FIELD} resize-y font-mono`}
                rows={3}
                value={proposal.body}
                onChange={(event) => change({ ...proposal, body: event.target.value })}
              />
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!canAccept} onClick={() => void accept()}>
          <Check size={12} aria-hidden />
          Accept
        </Button>
        {!editing ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={12} aria-hidden />
            Edit
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          <X size={12} aria-hidden />
          Dismiss
        </Button>
        {question !== null ? (
          <span className="text-meta text-ink-3">Answer the question to accept.</span>
        ) : null}
      </div>
    </div>
  )
}
