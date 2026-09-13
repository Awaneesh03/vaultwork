import type { Id } from '@/types/entities'
import type { CommandChoice, CommandIntent } from '@/services/commands/intents'

/**
 * Turning a proposal into something the application could run.
 *
 * M15.2 established that a model may only refer to things by text, because it
 * knows no real ids. This is the milestone that is finally allowed to look one
 * up — and the whole design is about *where* that lookup happens.
 *
 * It happens on the application side, against current data, through the
 * resolver the command layer already uses. The model gets no say in it. That
 * distinction is the point: `{ by: 'text' }` is a question, `{ by: 'id' }` is an
 * answer, and only Vaultwork may answer.
 *
 * Nothing here executes. The output of this layer is a `CommandIntent` — the
 * same value a mouse click produces — sitting in a result object, waiting for
 * the confirmation flow that M15.5 will build.
 */

/**
 * Which pool a reference is resolved against.
 *
 * Mirrors the executor exactly: `task.complete` resolves against open tasks
 * (`byStatus('todo')`) and `task.reschedule` against every live task
 * (`listLive()`). Keeping the pools in step matters — a bridge that resolved
 * against a wider set than the executor would hand M15.5 an id the executor
 * would then refuse, and the user would see a plan that could not run.
 */
export type AiRefScope = 'open' | 'live'

/**
 * The reason given to steps that were refused only because the plan was.
 *
 * A plan is rejected whole, so every step comes back `invalid` — but only one
 * of them is *why*. Naming the placeholder means a caller can tell the
 * explanation from the collateral and show the user the sentence that helps.
 */
export const PLAN_NOT_ATTEMPTED = 'Not attempted.'

/**
 * What became of one text reference.
 *
 * Deliberately the same three outcomes the command layer already has —
 * resolved, nothing matched, several matched — and the ambiguous case carries
 * `CommandChoice[]`, the application's existing numbered-choice type, rather
 * than a second numbering protocol invented for AI.
 */
export type AiRefResolution =
  | { status: 'resolved'; id: Id }
  | { status: 'not_found'; query: string }
  | { status: 'ambiguous'; query: string; choices: CommandChoice[] }

/**
 * The one thing this layer asks the application for.
 *
 * Declared here and implemented in `services/ai`, the same inversion M15.3 uses
 * for its read model. `src/ai` therefore still has no runtime dependency on a
 * service, a repository or Dexie — it receives a resolver rather than reaching
 * for one, which is also what makes the bridge testable against a fake.
 */
export interface AiEntityLookup {
  resolveTask(query: string, scope: AiRefScope): Promise<AiRefResolution>
}

/**
 * What became of one proposed step.
 *
 * Every case keeps the model's own `id` and `description`, so a later UI can
 * show the user the step it was told about rather than a reconstruction of it —
 * including for the steps that failed. Nothing is silently dropped.
 */
export type AiStepOutcome =
  | {
      status: 'resolved'
      id: string
      description: string
      /** The existing command vocabulary. No AI-shaped command type exists. */
      intent: CommandIntent
    }
  | { status: 'not_found'; id: string; description: string; query: string }
  | {
      status: 'ambiguous'
      id: string
      description: string
      query: string
      choices: CommandChoice[]
      /**
       * The intent with its *text* reference still in place.
       *
       * Re-runnable exactly as `CommandResult.ambiguous` is: the existing
       * `resolveChoice(intent, id)` rebuilds it against the row the user picked.
       * Keeping the text ref rather than a half-resolved one is what makes that
       * possible without a second code path.
       */
      intent: CommandIntent
    }
  | { status: 'invalid'; id: string; description: string; reason: string }

/**
 * What became of a whole plan.
 *
 * `resolved` is the only status that carries `intents`, and it is only reached
 * when *every* step resolved. That is deliberate: a plan is a proposal the user
 * will accept or reject as a whole, and offering a partially-resolvable plan as
 * runnable would invite exactly the partial application M15.4 is told not to
 * perform.
 *
 * `steps` is always present and always complete, so a caller can show what
 * happened to each one whatever the overall verdict.
 */
export type AiResolution =
  | { status: 'resolved'; intents: CommandIntent[]; steps: AiStepOutcome[] }
  /** At least one reference matched several rows. Ask before doing anything. */
  | { status: 'needs_clarification'; steps: AiStepOutcome[] }
  /** At least one step named nothing, or could not be represented at all. */
  | { status: 'invalid'; steps: AiStepOutcome[] }
