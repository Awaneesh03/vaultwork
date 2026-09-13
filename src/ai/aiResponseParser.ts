import { isDateStr, isTimeStr } from '@/lib/date'
import { AiError } from '@/platform/ports'
import { err, ok, type Result } from '@/types/result'
import { isMember, PRIORITIES } from '@/types/enums'
import {
  AI_ALLOWED_INTENT_KINDS,
  AI_LIMITS,
  AI_RESPONSE_KINDS,
  type AiRef,
  type AiResponse,
  type AiStep,
  type ProposedIntent,
} from './aiTypes'

/**
 * The boundary between a model's output and Vaultwork.
 *
 * Everything in this file exists because `JSON.parse` is not validation. The
 * provider returns a string; that string may be malformed, truncated,
 * hallucinated, or shaped by text a model read out of the user's own notes. It
 * is treated the way `parseBackup` treats a file the user picked off disk —
 * checked field by field, refused on the first thing that is wrong, and never
 * repaired.
 *
 * **Rejection over repair** is the rule worth stating plainly. A parser that
 * silently drops an unknown field, coerces a bad date, or trims an over-long
 * list is a parser that decides what the user meant. If a response does not
 * satisfy the contract, the honest answer is that this one could not be read,
 * and a later phase may ask again.
 *
 * The function is pure. It touches no database, resolves no reference, calls no
 * service, and executes nothing — `entityResolver` runs in M15.4 and the
 * command executor in M15.5. A parser that could mutate would make every
 * argument about the layers above it worthless.
 */

/** The shape of a refusal. Never carries raw provider output. */
type Refusal = Result<never, AiError>

const invalid = (message: string): Refusal => err(new AiError('invalid-response', message))

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A string that is present, non-blank and within its bound.
 *
 * Blank is rejected rather than treated as absent: a model that returns
 * `"message": "   "` has not answered, and pretending otherwise would put an
 * empty bubble in front of the user.
 */
function readString(value: unknown, field: string, max: number): Result<string, AiError> {
  if (typeof value !== 'string') return invalid(`"${field}" must be a string.`)
  const trimmed = value.trim()
  if (trimmed.length === 0) return invalid(`"${field}" is empty.`)
  if (value.length > max) return invalid(`"${field}" is longer than ${max} characters.`)
  return ok(trimmed)
}

/** An optional field: absent, `null`, or a valid value. Never `undefined`-ish junk. */
function readOptional<T>(
  value: unknown,
  field: string,
  check: (value: unknown) => value is T,
  expected: string,
): Result<T | null, AiError> {
  if (value === undefined || value === null) return ok(null)
  if (!check(value)) return invalid(`"${field}" must be ${expected}.`)
  return ok(value)
}

/**
 * Refuses any key the contract does not name.
 *
 * This is the single most valuable check here, and it is what stops a model
 * smuggling `taskId`, `id`, `source` or `raw` past the fields that are read.
 * Ignoring unknown keys would make each of those a silent no-op today and a
 * latent hazard the moment some later phase started reading them.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): Refusal | null {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length === 0) return null
  const sorted = [...unknown].sort()
  return invalid(
    `${where} has unexpected ${sorted.length === 1 ? 'field' : 'fields'}: ${sorted.join(', ')}.`,
  )
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// -------------------------------------------------------------- references

const REF_KEYS = ['by', 'query'] as const

/**
 * The only reference a model may make: text.
 *
 * `{ by: 'id' }` is refused explicitly rather than falling through the generic
 * "unknown value" path, because it is the interesting failure — a model that
 * offers an id has invented a row, and the message should say so.
 */
function readRef(value: unknown, where: string): Result<AiRef, AiError> {
  if (!isObject(value)) return invalid(`${where} must be an object.`)

  // Checked before the unknown-key sweep, and deliberately so. An id reference
  // is the single most interesting thing a model can get wrong, and reporting
  // it as "unexpected field: id" would bury the reason under a generic message.
  if (value.by === 'id') {
    return err(
      new AiError(
        'invalid-reference',
        'A reference must name a task by text, not by id. The model does not know real ids.',
      ),
    )
  }
  if (value.by !== 'text') {
    return err(new AiError('invalid-reference', `${where} must use { by: "text" }.`))
  }

  // A text reference carrying anything else — an `id` alongside a `query`, say
  // — is a smuggling attempt rather than a typo.
  const unknown = rejectUnknownKeys(value, REF_KEYS, where)
  if (unknown) return unknown

  const query = readString(value.query, `${where}.query`, AI_LIMITS.query)
  if (!query.ok) return err(new AiError('invalid-reference', query.error.message))

  return ok({ by: 'text', query: query.value })
}

// ----------------------------------------------------------------- intents

const ADD_KEYS = [
  'kind',
  'title',
  'dueDate',
  'dueTime',
  'priority',
  'projectName',
  'estimateMin',
] as const
const COMPLETE_KEYS = ['kind', 'ref'] as const
const RESCHEDULE_KEYS = ['kind', 'ref', 'dueDate', 'dueTime'] as const

const isPriority = isMember(PRIORITIES)

/**
 * One proposed action.
 *
 * `source` and `raw` are attached here, by the application, from the request
 * the user actually made — never from the response. A model that supplies
 * either has already been refused by the unknown-key check above.
 */
function readIntent(value: unknown, raw: string, where: string): Result<ProposedIntent, AiError> {
  if (!isObject(value)) return invalid(`${where} must be an object.`)

  const kind = value.kind
  if (typeof kind !== 'string') return invalid(`${where}.kind must be a string.`)
  if (!(AI_ALLOWED_INTENT_KINDS as readonly string[]).includes(kind)) {
    // A well-formed request for something outside the allowlist is a different
    // failure from a malformed one, and a later phase may want to say so.
    return err(
      new AiError('unsupported-intent', `"${kind}" is not an action the assistant may propose.`),
    )
  }

  const base = { source: 'ai', raw } as const

  if (kind === 'task.add') {
    const unknown = rejectUnknownKeys(value, ADD_KEYS, where)
    if (unknown) return unknown

    const title = readString(value.title, `${where}.title`, AI_LIMITS.title)
    if (!title.ok) return title

    const dueDate = readOptional(value.dueDate, `${where}.dueDate`, isDateStr, 'a YYYY-MM-DD date')
    if (!dueDate.ok) return dueDate

    const dueTime = readOptional(value.dueTime, `${where}.dueTime`, isTimeStr, 'an HH:mm time')
    if (!dueTime.ok) return dueTime

    // Absent means "no opinion", which is `none` — the same default
    // `emptyDraft()` uses, so an omitted priority behaves as Quick Add does.
    const priority = value.priority ?? 'none'
    if (!isPriority(priority)) {
      return invalid(`${where}.priority must be one of: ${PRIORITIES.join(', ')}.`)
    }

    const projectName =
      value.projectName === undefined || value.projectName === null
        ? ok(null)
        : readString(value.projectName, `${where}.projectName`, AI_LIMITS.title)
    if (!projectName.ok) return projectName

    const estimate = readOptional(
      value.estimateMin,
      `${where}.estimateMin`,
      isFiniteNumber,
      'a number of minutes',
    )
    if (!estimate.ok) return estimate
    if (estimate.value !== null) {
      if (!Number.isInteger(estimate.value) || estimate.value <= 0) {
        return invalid(`${where}.estimateMin must be a whole number of minutes above zero.`)
      }
      if (estimate.value > AI_LIMITS.estimateMin) {
        return invalid(`${where}.estimateMin must not exceed ${AI_LIMITS.estimateMin} minutes.`)
      }
    }

    return ok({
      ...base,
      kind: 'task.add',
      title: title.value,
      dueDate: dueDate.value,
      dueTime: dueTime.value,
      priority,
      projectName: projectName.value,
      estimateMin: estimate.value,
    })
  }

  if (kind === 'task.complete') {
    const unknown = rejectUnknownKeys(value, COMPLETE_KEYS, where)
    if (unknown) return unknown

    const ref = readRef(value.ref, `${where}.ref`)
    if (!ref.ok) return ref

    return ok({ ...base, kind: 'task.complete', ref: ref.value })
  }

  const unknown = rejectUnknownKeys(value, RESCHEDULE_KEYS, where)
  if (unknown) return unknown

  const ref = readRef(value.ref, `${where}.ref`)
  if (!ref.ok) return ref

  const dueDate = readOptional(value.dueDate, `${where}.dueDate`, isDateStr, 'a YYYY-MM-DD date')
  if (!dueDate.ok) return dueDate

  const dueTime = readOptional(value.dueTime, `${where}.dueTime`, isTimeStr, 'an HH:mm time')
  if (!dueTime.ok) return dueTime

  // Rescheduling to nothing at all is not a reschedule. Clearing a due date is
  // a real operation, but it is not one a model may propose in M15.2 — and
  // silently accepting it would make "move my Java revision" able to unschedule
  // it instead.
  if (dueDate.value === null && dueTime.value === null) {
    return invalid(`${where} must give a dueDate, a dueTime, or both.`)
  }

  return ok({
    ...base,
    kind: 'task.reschedule',
    ref: ref.value,
    dueDate: dueDate.value,
    dueTime: dueTime.value,
  })
}

// ------------------------------------------------------------------- steps

const STEP_KEYS = ['description', 'intent'] as const

function readStep(value: unknown, raw: string, index: number): Result<AiStep, AiError> {
  const where = `steps[${index}]`
  if (!isObject(value)) return invalid(`${where} must be an object.`)

  // `id` is deliberately not an accepted key: the application numbers its own
  // steps, so a model-supplied identifier — which could look like a row id —
  // is refused rather than trusted or quietly overwritten.
  const unknown = rejectUnknownKeys(value, STEP_KEYS, where)
  if (unknown) return unknown

  const description = readString(value.description, `${where}.description`, AI_LIMITS.description)
  if (!description.ok) return description

  const intent = readIntent(value.intent, raw, `${where}.intent`)
  if (!intent.ok) return intent

  return ok({
    // Generated after validation, and deterministic: the same response always
    // produces the same ids, which is what lets a test assert on them.
    id: `step-${index + 1}`,
    description: description.value,
    intent: intent.value,
  })
}

// ---------------------------------------------------------------- response

const ANSWER_KEYS = ['kind', 'message'] as const
const CLARIFICATION_KEYS = ['kind', 'message', 'options'] as const
const PLAN_KEYS = ['kind', 'message', 'steps'] as const

/**
 * Reads one provider response into the only shape the application will accept.
 *
 * `raw` is the user's original request. It is threaded onto every proposed
 * intent to satisfy the `CommandIntent` contract, and it comes from the caller
 * rather than the response for the obvious reason.
 */
export function parseAiResponse(text: unknown, raw: string): Result<AiResponse, AiError> {
  if (typeof text !== 'string') {
    return invalid('The assistant returned no text.')
  }
  // Checked before parsing: a refusal should not require building a megabyte of
  // objects first.
  if (text.length > AI_LIMITS.rawResponse) {
    return invalid(`The assistant's reply was longer than ${AI_LIMITS.rawResponse} characters.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Deliberately does not quote the text back: it is untrusted, potentially
    // enormous, and shaped by content the model was shown.
    return invalid('The assistant did not return valid JSON.')
  }

  if (!isObject(parsed)) {
    return invalid('The assistant did not return a JSON object.')
  }

  const kind = parsed.kind
  if (typeof kind !== 'string') return invalid('"kind" is missing.')
  if (!(AI_RESPONSE_KINDS as readonly string[]).includes(kind)) {
    return invalid(`"${kind}" is not a kind of reply this application understands.`)
  }

  if (kind === 'answer') {
    const unknown = rejectUnknownKeys(parsed, ANSWER_KEYS, 'the reply')
    if (unknown) return unknown

    const message = readString(parsed.message, 'message', AI_LIMITS.message)
    if (!message.ok) return message

    return ok({ kind: 'answer', message: message.value })
  }

  if (kind === 'clarification') {
    const unknown = rejectUnknownKeys(parsed, CLARIFICATION_KEYS, 'the reply')
    if (unknown) return unknown

    const message = readString(parsed.message, 'message', AI_LIMITS.message)
    if (!message.ok) return message

    if (!Array.isArray(parsed.options)) return invalid('"options" must be an array.')
    // A clarification with nothing to choose between is not a clarification.
    if (parsed.options.length === 0) return invalid('"options" is empty.')
    if (parsed.options.length > AI_LIMITS.options) {
      return invalid(`"options" must not hold more than ${AI_LIMITS.options} choices.`)
    }

    const options: string[] = []
    for (const [index, option] of parsed.options.entries()) {
      const read = readString(option, `options[${index}]`, AI_LIMITS.optionLength)
      if (!read.ok) return read
      options.push(read.value)
    }

    return ok({ kind: 'clarification', message: message.value, options })
  }

  const unknown = rejectUnknownKeys(parsed, PLAN_KEYS, 'the reply')
  if (unknown) return unknown

  const message = readString(parsed.message, 'message', AI_LIMITS.message)
  if (!message.ok) return message

  if (!Array.isArray(parsed.steps)) return invalid('"steps" must be an array.')
  // A plan that proposes nothing is an answer, and calling it a plan would put
  // an empty confirmation in front of the user in a later phase.
  if (parsed.steps.length === 0) return invalid('"steps" is empty.')
  if (parsed.steps.length > AI_LIMITS.steps) {
    return invalid(`A plan must not hold more than ${AI_LIMITS.steps} steps.`)
  }

  const steps: AiStep[] = []
  for (const [index, step] of parsed.steps.entries()) {
    const read = readStep(step, raw, index)
    if (!read.ok) return read
    steps.push(read.value)
  }

  return ok({ kind: 'plan', message: message.value, steps })
}
