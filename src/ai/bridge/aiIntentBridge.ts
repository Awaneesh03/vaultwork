import type { CommandIntent, EntityRef } from '@/services/commands/intents'
import type { AiResponse, AiStep, ProposedIntent } from '../aiTypes'
import { checkPlanCoherence } from './aiPlanCheck'
import { PLAN_NOT_ATTEMPTED } from './aiBridgeTypes'
import type {
  AiEntityLookup,
  AiRefResolution,
  AiRefScope,
  AiResolution,
  AiStepOutcome,
} from './aiBridgeTypes'

/**
 * The bridge from a model's proposal to the application's own vocabulary.
 *
 * Read the direction of trust here. A `ProposedIntent` is something a model
 * said; a `CommandIntent` is something Vaultwork could do. This module is the
 * only place the first becomes the second, and it does so by *rebuilding* the
 * value rather than adapting it — every field on the way out is either resolved
 * against the database or written by this file.
 *
 * That is why `source` is a literal below rather than a copy. It is already
 * `'ai'` on the way in, since M15.2's parser stamps it and refuses a model that
 * supplies one. Writing it again costs nothing and means attribution does not
 * depend on an upstream layer having done its job.
 *
 * Nothing here executes. The executor is not imported, `execute` is not called,
 * and the output is a value. Whether a plan is ever run is M15.5's question.
 */

/**
 * Which pool each kind resolves against, matching the executor.
 *
 * `task.complete` refuses to act on a finished task, so it resolves among open
 * ones; `task.reschedule` may move anything live. Written down rather than
 * inferred, so a divergence from `commandExecutor` is a visible edit.
 */
const SCOPE: Record<'task.complete' | 'task.reschedule', AiRefScope> = {
  'task.complete': 'open',
  'task.reschedule': 'live',
}

/**
 * The reference shape a model is allowed to hand over.
 *
 * `ProposedIntent` already makes `{ by: 'id' }` unrepresentable, so this is the
 * runtime half of a rule the types already state. It matters because a
 * `ProposedIntent` could reach this function from somewhere other than the
 * parser — a test, a future caller, a refactor — and "the model cannot supply
 * an id" should not quietly depend on who called.
 */
function textQuery(ref: unknown): { query: string } | { reason: string } {
  if (typeof ref !== 'object' || ref === null) {
    return { reason: 'The step has no reference.' }
  }
  const candidate = ref as { by?: unknown; query?: unknown }

  if (candidate.by === 'id') {
    return {
      reason: 'A reference must name a task by text. Only Vaultwork may turn a name into an id.',
    }
  }
  if (candidate.by !== 'text' || typeof candidate.query !== 'string') {
    return { reason: 'The step does not name a task by text.' }
  }
  const query = candidate.query.trim()
  if (query.length === 0) return { reason: 'The step names an empty task.' }

  return { query }
}

/**
 * The reference the application built, once it knows the answer.
 *
 * Written as a literal rather than through the command layer's `byId` helper so
 * that `src/ai` keeps no runtime import from `services/` — the same invariant
 * M15.2 and M15.3 hold. It is two fields of the existing `EntityRef` type, so
 * the shape is still checked by the compiler.
 */
const resolvedRef = (id: string): EntityRef => ({ by: 'id', id })

// ------------------------------------------------------------------ mapping

/**
 * Builds the `task.add` intent.
 *
 * No reference to resolve: adding names nothing that already exists. Two
 * details are load-bearing.
 *
 * `projectName` is passed through **unresolved**, because the executor resolves
 * it itself — with `resolveProjectByName`, and with a deliberate rule that an
 * unmatched `@name` files the task in the Inbox and says why rather than
 * inventing a project. Resolving it here would be a second answer to a question
 * the command layer already answers, and a worse one.
 *
 * `tokens` is empty because tokens are character offsets into text the user
 * typed, used to highlight Quick Add's input. There is no such text here, and
 * the executor never reads the field.
 */
function toAddIntent(proposed: Extract<ProposedIntent, { kind: 'task.add' }>): CommandIntent {
  return {
    kind: 'task.add',
    source: 'ai',
    raw: proposed.raw,
    draft: {
      title: proposed.title,
      description: null,
      dueDate: proposed.dueDate,
      dueTime: proposed.dueTime,
      priority: proposed.priority,
      projectName: proposed.projectName,
      // Tags and subtasks are not in the M15.2 vocabulary, so a model cannot
      // propose them and this cannot invent them.
      tagNames: [],
      estimateMin: proposed.estimateMin,
      subtasks: [],
    },
    tokens: [],
  }
}

/** The intent for a ref-carrying kind, given whichever ref applies. */
function toRefIntent(
  proposed: Extract<ProposedIntent, { kind: 'task.complete' | 'task.reschedule' }>,
  ref: EntityRef,
): CommandIntent {
  if (proposed.kind === 'task.complete') {
    return { kind: 'task.complete', source: 'ai', raw: proposed.raw, ref }
  }
  return {
    kind: 'task.reschedule',
    source: 'ai',
    raw: proposed.raw,
    ref,
    dueDate: proposed.dueDate,
    dueTime: proposed.dueTime,
  }
}

// ------------------------------------------------------------------- steps

async function resolveStep(step: AiStep, lookup: AiEntityLookup): Promise<AiStepOutcome> {
  const { id, description } = step
  const proposed = step.intent
  const invalid = (reason: string): AiStepOutcome => ({
    status: 'invalid',
    id,
    description,
    reason,
  })

  if (proposed.kind === 'task.add') {
    return { status: 'resolved', id, description, intent: toAddIntent(proposed) }
  }

  if (proposed.kind !== 'task.complete' && proposed.kind !== 'task.reschedule') {
    // Unreachable through the parser, whose allowlist is these three kinds. Kept
    // because "the allowlist is enforced" should not rest on the caller.
    return invalid('That is not an action the assistant may propose.')
  }

  const read = textQuery(proposed.ref)
  if ('reason' in read) return invalid(read.reason)

  const resolution: AiRefResolution = await lookup.resolveTask(read.query, SCOPE[proposed.kind])

  if (resolution.status === 'resolved') {
    return {
      status: 'resolved',
      id,
      description,
      intent: toRefIntent(proposed, resolvedRef(resolution.id)),
    }
  }

  if (resolution.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      id,
      description,
      query: resolution.query,
      choices: resolution.choices,
      // The text reference is kept, so `resolveChoice` can rebuild this against
      // whichever row the user picks — the same path the palette and Telegram
      // already use.
      intent: toRefIntent(proposed, proposed.ref),
    }
  }

  return { status: 'not_found', id, description, query: resolution.query }
}

// -------------------------------------------------------------------- plan

/**
 * Resolves a whole proposed plan against current application state.
 *
 * Every step is resolved before any verdict is reached, so the caller learns
 * what happened to all of them rather than only up to the first failure. Steps
 * are resolved in order and the order is preserved: a plan that completes a
 * task and then schedules its follow-up is not the same plan backwards.
 *
 * The resolution is done against the *database*, never against the M15.3
 * context snapshot. Context is a photograph taken before the model answered;
 * between the two the user may have finished the task, renamed it, or created a
 * second one with a similar name. Current state wins, which is why a step can
 * come back `not_found` for something the model was told about.
 */
export async function resolveAiPlan(
  steps: readonly AiStep[],
  lookup: AiEntityLookup,
): Promise<AiResolution> {
  /*
   * The plan is judged as a sequence first, and refused before a single
   * reference is looked up. Two reasons: a plan that cannot work should not
   * cost database reads, and the reason it cannot work is clearer here than it
   * would be as a downstream "nothing matches" on the step that suffered.
   */
  const incoherent = checkPlanCoherence(steps)
  if (incoherent !== null) {
    return {
      status: 'invalid',
      steps: steps.map((step) => ({
        status: 'invalid',
        id: step.id,
        description: step.description,
        reason: step.id === incoherent.stepId ? incoherent.reason : PLAN_NOT_ATTEMPTED,
      })),
    }
  }

  const outcomes: AiStepOutcome[] = []
  for (const step of steps) {
    // Sequential rather than concurrent: the lookup reads one snapshot for the
    // whole pass, and resolving in order keeps the outcomes in the plan's order
    // without a reassembly step that could get it wrong.
    outcomes.push(await resolveStep(step, lookup))
  }

  if (outcomes.some((outcome) => outcome.status === 'invalid' || outcome.status === 'not_found')) {
    return { status: 'invalid', steps: outcomes }
  }
  if (outcomes.some((outcome) => outcome.status === 'ambiguous')) {
    return { status: 'needs_clarification', steps: outcomes }
  }

  return {
    status: 'resolved',
    intents: outcomes.flatMap((outcome) => (outcome.status === 'resolved' ? [outcome.intent] : [])),
    steps: outcomes,
  }
}

/**
 * Resolves a plan response, and refuses anything else.
 *
 * An answer or a clarification proposes no action, so there is nothing to
 * resolve and nothing that could become runnable. Handing one here is a caller
 * mistake rather than a model failure, and it is reported as such instead of
 * being quietly treated as an empty plan.
 */
export function resolveAiResponse(
  response: AiResponse,
  lookup: AiEntityLookup,
): Promise<AiResolution> {
  if (response.kind !== 'plan') {
    return Promise.resolve({
      status: 'invalid',
      steps: [
        {
          status: 'invalid',
          id: 'response',
          description: response.message,
          reason: `A ${response.kind} proposes no actions to resolve.`,
        },
      ],
    })
  }
  return resolveAiPlan(response.steps, lookup)
}
