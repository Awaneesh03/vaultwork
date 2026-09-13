import type { AiResolution } from '@/ai/bridge/aiBridgeTypes'
import { newId } from '@/lib/id'
import { platform } from '@/platform'
import type { Id, Timestamp } from '@/types/entities'
import { execute } from '../commands/commandExecutor'
import type { CommandIntent, CommandResult } from '../commands/intents'
import { getTaskView } from '../taskQueryService'
import { describeAiIntent, targetIdsOf } from './aiSummary'

/**
 * The gate between what a model proposed and what Vaultwork does.
 *
 * Everything before this point is interpretation: M15.2 read a reply, M15.4
 * turned its phrases into real ids. Nothing so far has changed a row, and
 * nothing here changes one either — until a person, having read what will
 * happen, says yes.
 *
 * The invariant is worth stating flatly: **no AI-proposed mutation runs without
 * an explicit confirmation of that exact action.** Not when the match was
 * unique, not when the model was confident, not when the user's original
 * sentence was itself an instruction. "Complete my Java task" is a request to
 * be shown a proposal; it is not consent to the proposal it produces.
 *
 * Four properties carry that weight, and each is small enough to check:
 *
 *  1. **The intent is pinned.** A confirmation holds the resolved
 *     `CommandIntent` — the id included. Confirming never re-resolves a name,
 *     never re-asks the provider, and never rebuilds a command from the user's
 *     text. There is no API that accepts a replacement intent.
 *  2. **Single use.** The state moves out of `pending` synchronously, before
 *     the first `await`, so two confirmations racing each other cannot both
 *     get through.
 *  3. **It expires.** A proposal describing a database from five minutes ago is
 *     not one anybody should be able to accept.
 *  4. **It executes through the existing executor.** No repository, no service,
 *     no second mutation path — the same `execute` a mouse click reaches, which
 *     is what makes events, undo and domain rules happen by themselves.
 */

/**
 * How long a proposal stands.
 *
 * Five minutes, matching what the Telegram adapter already uses for its own
 * pending confirmations. The constant is restated rather than shared because
 * that one is private to `telegramService` and M15.5 must not modify M14 — if a
 * third caller ever needs it, that is the moment to hoist one definition.
 */
export const AI_CONFIRMATION_TTL_MS = 5 * 60 * 1000

/**
 * The lifecycle, with nothing in it that is not needed for correctness.
 *
 * There is deliberately no `confirmed` state distinct from `consumed`:
 * authorising and executing happen inside one call, so a confirmation is never
 * observably confirmed-but-not-yet-run. A state nobody can see is a state that
 * only exists to be got wrong.
 */
export type AiConfirmationState = 'pending' | 'consumed' | 'cancelled' | 'expired'

export interface AiConfirmation {
  id: string
  state: AiConfirmationState
  /**
   * The exact commands that will run. Resolved, pinned, and never re-derived.
   */
  intents: readonly CommandIntent[]
  /** One application-written line per intent, in the same order. */
  summary: readonly string[]
  /**
   * What the model said each step was for.
   *
   * Context for the reader, never authority. `summary` is what will happen.
   */
  aiDescriptions: readonly string[]
  createdAt: Timestamp
  expiresAt: Timestamp
}

export type AiConfirmationRefusal = 'unknown' | 'expired' | 'cancelled' | 'consumed'

export type AiExecutionOutcome =
  | {
      status: 'executed'
      results: CommandResult[]
      /**
       * The undo intents the executor produced, in order.
       *
       * Passed through rather than reimplemented: `task.complete` comes back
       * with a `task.uncomplete`, `task.add` with a `task.delete`, and
       * `task.reschedule` with the previous date and time. There is no
       * AI-specific undo, because there did not need to be one.
       */
      undo: CommandIntent[]
    }
  /** The confirmation was not in a state that permits execution. Nothing ran. */
  | { status: 'refused'; reason: AiConfirmationRefusal; message: string }
  /**
   * A step failed. The steps before it did run — see `results`.
   *
   * Execution stops at the first failure rather than pressing on, and the
   * remaining steps are never attempted.
   */
  | { status: 'failed'; results: CommandResult[]; undo: CommandIntent[]; message: string }

/**
 * Pending proposals, in memory and nowhere else.
 *
 * Deliberately not a Dexie store. A proposal describes a database as it was a
 * moment ago; one that survived a restart would be an action the user could
 * accept long after the reason for it had gone, and persisting it would mean
 * writing expiry and replay rules for a value whose whole purpose is to be
 * short-lived. Losing them on restart is the safe failure, and it is the same
 * choice the Telegram adapter made for the same reason.
 */
const pending = new Map<string, AiConfirmation>()

/**
 * Makes a stored proposal unable to change after it is issued.
 *
 * The confirmation object is handed back to the caller, and without this the
 * caller holds a reference to the very value the gate will execute — so
 * `confirmation.intents[0].ref = somethingElse` would retarget the mutation
 * after the user had read the summary. Freezing turns that into a no-op (a
 * throw, under the strict mode ES modules always run in) rather than a silent
 * substitution.
 *
 * This is the structural half of "the id refers to exactly one pinned action";
 * the other half is that no API accepts a replacement intent.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/** Test seam, and what a restart does for free. */
export function resetAiConfirmations(): void {
  pending.clear()
}

const expired = (confirmation: AiConfirmation, now: Timestamp) =>
  confirmation.state === 'pending' && now >= confirmation.expiresAt

/**
 * Reads a confirmation, applying expiry.
 *
 * Expiry is evaluated on access rather than by a timer: there is no scheduler
 * to keep alive, no wake-up to get wrong, and a proposal nobody looks at cannot
 * do any harm by lingering in a map.
 */
export function getAiConfirmation(id: string): AiConfirmation | null {
  const confirmation = pending.get(id)
  if (confirmation === undefined) return null

  if (expired(confirmation, platform.clock.now())) {
    const lapsed: AiConfirmation = { ...confirmation, state: 'expired' }
    pending.set(id, lapsed)
    return lapsed
  }
  return confirmation
}

/**
 * Turns a fully resolved plan into a proposal awaiting a decision.
 *
 * Only a `resolved` resolution is accepted. A plan with an ambiguous or missing
 * reference has no pinned id to confirm, so there is nothing here to authorise
 * — the caller must go back and ask.
 *
 * Creating a proposal reads the database (for the titles the summary needs) and
 * writes nothing.
 */
export async function createAiConfirmation(
  resolution: AiResolution,
): Promise<AiConfirmation | null> {
  if (resolution.status !== 'resolved') return null
  if (resolution.intents.length === 0) return null

  // Attribution is checked rather than assumed. Everything reaching here should
  // already be stamped by the bridge; a plan that is not is a bug upstream, and
  // executing it would file someone else's name on the event.
  if (resolution.intents.some((intent) => intent.source !== 'ai')) return null

  const view = await getTaskView('all')
  const wanted = new Set<Id>(targetIdsOf(resolution.intents))
  const titles = new Map<Id, string>(
    view.tasks.filter((task) => wanted.has(task.id)).map((task) => [task.id, task.title]),
  )

  const now = platform.clock.now()
  const confirmation: AiConfirmation = {
    id: newId(),
    state: 'pending',
    intents: [...resolution.intents],
    summary: resolution.intents.map((intent) => describeAiIntent(intent, titles, view.today)),
    aiDescriptions: resolution.steps.map((step) => step.description),
    createdAt: now,
    expiresAt: now + AI_CONFIRMATION_TTL_MS,
  }

  const pinned = deepFreeze(confirmation)
  pending.set(pinned.id, pinned)
  return pinned
}

/** Withdraws a proposal. Nothing runs, and nothing changes. */
export function cancelAiConfirmation(id: string): boolean {
  const confirmation = getAiConfirmation(id)
  if (confirmation === null || confirmation.state !== 'pending') return false

  pending.set(id, { ...confirmation, state: 'cancelled' })
  return true
}

const REFUSALS: Record<AiConfirmationRefusal, string> = {
  unknown: 'That proposal is no longer available.',
  expired: 'That proposal has expired. Ask again to get a fresh one.',
  cancelled: 'That proposal was cancelled.',
  consumed: 'That proposal has already been applied.',
}

const refuse = (reason: AiConfirmationRefusal): AiExecutionOutcome => ({
  status: 'refused',
  reason,
  message: REFUSALS[reason],
})

/**
 * Authorises a pinned proposal and runs it.
 *
 * Note what this function does *not* do. It does not call the provider, does
 * not resolve a name, does not parse the user's original text, and does not
 * consult the model about whether the action is still a good idea. All of that
 * happened before the user was shown anything; confirming means only "run the
 * commands I was shown".
 *
 * The steps run in order through the existing executor, and stop at the first
 * one that does not succeed. **This is not atomic.** Each command is its own
 * transaction with its own event, so a plan that fails halfway leaves the
 * earlier steps applied — they are reported in `results`, and each carries the
 * executor's own undo. Vaultwork has no multi-command transaction to reuse, and
 * M15.5 does not invent one; claiming atomicity would be worse than lacking it.
 */
export async function confirmAiAction(id: string): Promise<AiExecutionOutcome> {
  const confirmation = getAiConfirmation(id)
  if (confirmation === null) return refuse('unknown')
  if (confirmation.state !== 'pending') return refuse(confirmation.state)

  /*
   * Claimed before the first `await`, which is what makes single use real.
   *
   * Two confirmations arriving together — a double click, two windows — both
   * read `pending`, but only the first reaches this line before the other; the
   * second finds `consumed` and is refused. Relying on a disabled button would
   * make the invariant a property of the UI rather than of the application.
   */
  pending.set(id, { ...confirmation, state: 'consumed' })

  const results: CommandResult[] = []
  const undo: CommandIntent[] = []

  for (const intent of confirmation.intents) {
    // The pinned intent, unchanged. Never `executeText`, which would re-parse
    // the user's sentence and could mean something else by now.
    const result = await execute(intent)
    results.push(result)

    if (result.status !== 'ok') {
      // The executor is the final authority. A target deleted since the
      // proposal was made comes back `not_found` here, and that is the answer —
      // no retry, no fallback target, no second resolution, no asking the model
      // what to do instead.
      return {
        status: 'failed',
        results,
        undo,
        message: result.message,
      }
    }

    if ('undo' in result && result.undo !== null) undo.push(result.undo)
  }

  return { status: 'executed', results, undo }
}
