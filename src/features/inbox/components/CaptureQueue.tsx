import { useProjectsView } from '@/features/projects/hooks/useProjectsView'
import { useInboxActions, useInboxItems } from '../hooks/useInbox'
import { ProposalEditor } from './ProposalEditor'

/**
 * Captures still waiting for a decision, above the Inbox's tasks (M18.3).
 *
 * The Inbox already meant "uncategorised capture" — open tasks with no project.
 * This is the step before that: text not yet decided into anything at all. A
 * capture leaves this list the moment it is accepted or dismissed, and while it
 * sits here it is safe; nothing decays or expires.
 *
 * Renders nothing when there is nothing to decide, so the Inbox looks exactly
 * as it always did for someone who never captures.
 */
export function CaptureQueue() {
  const items = useInboxItems()
  const projects = useProjectsView()?.projects ?? []
  const { busy, resolve, dismiss } = useInboxActions()

  if (items === undefined || items.length === 0) return null

  return (
    <section aria-labelledby="captured-heading" className="flex flex-col gap-2">
      <h2 id="captured-heading" className="t-eyebrow text-ink-3">
        Captured <span className="tabular ml-1">{items.length}</span>
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5 px-3 py-2.5">
            <p className="text-body text-ink">“{item.text}”</p>
            <ProposalEditor
              item={item}
              projects={projects}
              busy={busy}
              onAccept={async (proposal) => {
                const result = await resolve(item.id, proposal)
                return result.status === 'ok' ? null : result.message
              }}
              onDismiss={() => void dismiss(item.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
