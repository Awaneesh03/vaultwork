import { formatDayLabel, formatEstimate, formatTime } from '@/lib/date'
import type { CommandIntent } from '../commands/intents'
import type { DateStr, Id } from '@/types/entities'

/**
 * Saying what a proposed action will actually do.
 *
 * The rule this file exists to enforce: **the sentence the user reads before
 * confirming is derived from the command, not from the model.** A reply that
 * describes itself as "tidy up a few old tasks" while proposing something else
 * is not a hypothetical — it is the ordinary failure mode of asking a model to
 * narrate its own actions. The model's description is kept and shown as
 * context, but it never defines what is about to happen.
 *
 * Derived means derived from the *resolved* `CommandIntent`: the id that will
 * be passed to the executor, not the phrase that produced it. So the summary
 * and the mutation cannot disagree.
 *
 * Titles are looked up when the confirmation is built rather than carried down
 * from resolution, so what the user reads is the row's current name.
 */

/** The application's quoting, matching the command layer's own messages. */
const quoted = (value: string) => `“${value}”`

/**
 * A target that no longer exists.
 *
 * Shown rather than hidden, and deliberately not an id — the user has no use
 * for one, and the honest thing to say is that the row is gone. The executor
 * remains the authority: it will refuse this at confirm time.
 */
const MISSING = '(this task no longer exists)'

/** "Tomorrow at 7 pm", "Sat 12 Sep", or "no date". */
function whenLabel(dueDate: DateStr | null, dueTime: string | null, today: DateStr): string {
  if (dueDate === null) {
    return dueTime === null ? 'no date' : `no date, at ${formatTime(dueTime)}`
  }
  const day = formatDayLabel(dueDate, today)
  return dueTime === null ? day : `${day} at ${formatTime(dueTime)}`
}

const titleOf = (titles: ReadonlyMap<Id, string>, id: Id) => titles.get(id) ?? null

/**
 * One line describing what a command will do.
 *
 * Only the three kinds the AI allowlist permits are described. Anything else
 * returns a deliberately vague line rather than guessing, because a summary
 * that misdescribes a mutation is worse than one that admits it cannot.
 */
export function describeAiIntent(
  intent: CommandIntent,
  titles: ReadonlyMap<Id, string>,
  today: DateStr,
): string {
  if (intent.kind === 'task.add') {
    const { draft } = intent
    const parts = [`Add task: ${quoted(draft.title)}`]

    if (draft.dueDate !== null || draft.dueTime !== null) {
      parts.push(whenLabel(draft.dueDate, draft.dueTime, today))
    }
    if (draft.priority !== 'none') parts.push(`${draft.priority} priority`)
    if (draft.projectName !== null) parts.push(`in ${quoted(draft.projectName)}`)
    if (draft.estimateMin !== null) parts.push(formatEstimate(draft.estimateMin))

    return parts.join(' · ')
  }

  if (intent.kind === 'task.complete') {
    // The ref is an id by this point — resolution already happened — so the
    // name comes from the database rather than from the phrase the model used.
    const title = intent.ref.by === 'id' ? titleOf(titles, intent.ref.id) : null
    return `Complete task: ${title === null ? MISSING : quoted(title)}`
  }

  if (intent.kind === 'task.reschedule') {
    const title = intent.ref.by === 'id' ? titleOf(titles, intent.ref.id) : null
    const name = title === null ? MISSING : quoted(title)

    if (intent.dueDate === null && intent.dueTime === null) {
      return `Clear the due date on ${name}`
    }
    return `Reschedule task: ${name} → ${whenLabel(intent.dueDate, intent.dueTime, today)}`
  }

  // Unreachable while the allowlist holds. Kept so a widened allowlist produces
  // an honest placeholder rather than a confident description of the wrong
  // thing — and so the gap is visible in the interface rather than in a diff.
  return `Run ${intent.kind} (this action has no description yet)`
}

/**
 * The ids a set of intents will act on.
 *
 * Used to fetch exactly the titles the summaries need, once, rather than
 * reading per step.
 */
export function targetIdsOf(intents: readonly CommandIntent[]): Id[] {
  const ids: Id[] = []
  for (const intent of intents) {
    if ('ref' in intent && intent.ref.by === 'id') ids.push(intent.ref.id)
  }
  return ids
}
