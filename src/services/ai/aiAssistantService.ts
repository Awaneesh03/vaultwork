import { parseAiResponse } from '@/ai/aiResponseParser'
import { buildAiRequest } from '@/ai/aiPrompt'
import { buildAiContext } from '@/ai/context/aiContextBuilder'
import { purposeFor } from '@/ai/context/aiContextPurpose'
import type { AiContextPurpose } from '@/ai/context/aiContextTypes'
import { resolveAiResponse } from '@/ai/bridge/aiIntentBridge'
import { PLAN_NOT_ATTEMPTED, type AiResolution, type AiStepOutcome } from '@/ai/bridge/aiBridgeTypes'
import { AiError, platform, type AiStatus } from '@/platform'
import type { Id } from '@/types/entities'
import type { CommandIntent } from '../commands/intents'
import { createAiConfirmation, type AiConfirmation } from './aiConfirmationService'
import { createAiEntityLookup } from './aiEntityLookup'
import { readAiSource } from './aiReadModel'

/**
 * One question, all the way through.
 *
 * This is the first caller of the whole M15 pipeline, and it exists so that the
 * pipeline is assembled in exactly one place. A React component that wired
 * these six steps itself would be a second assembly, and the two would drift —
 * which for a chain whose last link is a mutation is not a cosmetic problem.
 *
 * Transport-agnostic on purpose. Nothing here knows about React, and nothing
 * knows about a chat window; M15.7 should be able to hand Telegram the same
 * function without changing it.
 *
 * The order is the safety argument, and every step is somewhere else's code:
 *
 *   purpose  → `purposeFor`, deterministic, never the model's choice
 *   context  → M15.3, bounded and redacted
 *   provider → `AiPort`, the key never leaving Rust
 *   parse    → M15.2, which refuses anything it does not recognise
 *   resolve  → M15.4, which turns names into ids against current data
 *   propose  → M15.5, which is where it stops until a person says yes
 *
 * The last step is the point: this function's most mutating outcome is a
 * *proposal*. Nothing below it writes a row.
 */

export type AiUnavailableReason = 'unsupported' | 'not-configured' | 'disabled'

export type AiAskResult =
  /** The provider cannot be used, and why — a state to show, not an error. */
  | { kind: 'unavailable'; reason: AiUnavailableReason; status: AiStatus }
  /** Nothing to do: the model answered a question. */
  | { kind: 'answer'; message: string }
  /** The model itself was unsure what was meant. */
  | { kind: 'clarification'; message: string; options: string[] }
  /** A resolved plan, waiting behind M15.5's gate. */
  | { kind: 'proposal'; message: string; confirmation: AiConfirmation }
  /** A reference matched several rows. The user picks; the model does not. */
  | { kind: 'choices'; message: string; steps: AiStepOutcome[] }
  /** A reference matched nothing, or a step could not be represented. */
  | { kind: 'unresolved'; message: string; steps: AiStepOutcome[] }
  | { kind: 'error'; message: string }

/** Why a provider cannot be asked, in the order the reasons matter. */
function unavailableReason(status: AiStatus): AiUnavailableReason | null {
  if (!platform.ai.isAvailable) return 'unsupported'
  if (!status.configured) return 'not-configured'
  if (!status.enabled) return 'disabled'
  return null
}

/**
 * The first line of a resolution's trouble, for the caller to show.
 *
 * Steps refused only because the plan was are skipped: when a plan is rejected
 * as a whole every step comes back invalid, and showing "Not attempted." as the
 * reason would hide the one sentence that explains anything.
 */
function describeProblem(steps: readonly AiStepOutcome[]): string {
  const first = steps.find(
    (step) =>
      step.status === 'not_found' ||
      (step.status === 'invalid' && step.reason !== PLAN_NOT_ATTEMPTED),
  )
  if (first?.status === 'not_found') return `Nothing here matches “${first.query}”.`
  if (first?.status === 'invalid') return first.reason
  return 'That request could not be turned into an action.'
}

/**
 * Asks the assistant one thing.
 *
 * Exactly one provider call, always. There is no retry, no second opinion, and
 * no follow-up request hidden behind a branch — if this returns `choices`, the
 * next step is the user picking one, not another question to the model.
 */
export async function askAi(text: string): Promise<AiAskResult> {
  const request = text.trim()
  if (request.length === 0) return { kind: 'error', message: 'Ask a question first.' }

  const status = await platform.ai.status()
  const blocked = unavailableReason(status)
  if (blocked !== null) return { kind: 'unavailable', reason: blocked, status }

  try {
    const purpose: AiContextPurpose = purposeFor(request)
    // The request text reaches the read model only to drive the local document
    // search on the `documents` profile. It is never a provider-side query.
    const context = buildAiContext(await readAiSource(purpose, request), purpose)

    const completion = await platform.ai.complete(buildAiRequest(request, context))

    const parsed = parseAiResponse(completion.text, request)
    if (!parsed.ok) return { kind: 'error', message: parsed.error.message }

    const response = parsed.value
    if (response.kind === 'answer') return { kind: 'answer', message: response.message }
    if (response.kind === 'clarification') {
      return {
        kind: 'clarification',
        message: response.message,
        options: [...response.options],
      }
    }

    const resolution = await resolveAiResponse(response, createAiEntityLookup())

    if (resolution.status === 'needs_clarification') {
      return { kind: 'choices', message: response.message, steps: resolution.steps }
    }
    if (resolution.status === 'invalid') {
      return { kind: 'unresolved', message: describeProblem(resolution.steps), steps: resolution.steps }
    }

    const confirmation = await createAiConfirmation(resolution)
    if (confirmation === null) {
      return { kind: 'error', message: 'That plan could not be prepared for review.' }
    }
    return { kind: 'proposal', message: response.message, confirmation }
  } catch (error) {
    // `AiError` messages are written by the adapter and the parser and are
    // already safe to show — no key, no header, no URL. Anything else is
    // reported generically rather than stringified, since an unexpected value
    // could carry something that should not reach a screen.
    return {
      kind: 'error',
      message:
        error instanceof AiError
          ? error.message
          : 'The assistant could not complete that request.',
    }
  }
}

/**
 * Turns the user's answer to "which one did you mean?" into a proposal.
 *
 * Note what this does **not** do. It does not ask the model again — the user
 * choosing between two of their own tasks is not a question a provider can
 * answer better than they can. And it does not call the command layer's
 * `resolveChoice`, which rebuilds an ambiguous intent *and executes it*: that
 * is the right behaviour for the palette, where the click is the confirmation,
 * and exactly the wrong one here, where the click only settles which row is
 * meant. The pinned intent still has to pass M15.5's gate.
 *
 * Every ambiguous step must have been answered. A plan half-decided is not a
 * plan anyone should be able to confirm.
 */
export async function proposeAiChoices(
  steps: readonly AiStepOutcome[],
  chosen: ReadonlyMap<string, Id>,
): Promise<AiConfirmation | null> {
  const intents: CommandIntent[] = []

  for (const step of steps) {
    if (step.status === 'resolved') {
      intents.push(step.intent)
      continue
    }
    if (step.status !== 'ambiguous') return null

    const pick = chosen.get(step.id)
    if (pick === undefined) return null
    // Only an id the resolver itself offered. A choice the user could not have
    // seen is not a choice they made.
    if (!step.choices.some((choice) => choice.id === pick)) return null

    // The same rebuild `resolveChoice` performs, minus the execution.
    intents.push({ ...step.intent, ref: { by: 'id', id: pick } } as CommandIntent)
  }

  if (intents.length === 0 || intents.length !== steps.length) return null

  // Built in step order, so index `i` is the intent for step `i` — which is the
  // pairing `createAiConfirmation` relies on when it lines each summary up with
  // the model's description of the same step.
  const resolution: AiResolution = {
    status: 'resolved',
    intents,
    steps: steps.map((step, index) => ({
      status: 'resolved',
      id: step.id,
      description: step.description,
      intent: intents[index] as CommandIntent,
    })),
  }

  return createAiConfirmation(resolution)
}
