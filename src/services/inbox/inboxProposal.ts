import { isDateStr, isTimeStr, toDateStr } from '@/lib/date'
import type { DateStr, Id, Project, TimeStr } from '@/types/entities'
import { INBOX_TYPES, KNOWLEDGE_KINDS, type InboxType, type KnowledgeKind } from '@/types/enums'
import { resolveProjectByName } from '../commands/entityResolver'
import type { CommandIntent } from '../commands/intents'
import { emptyDraft, parseQuickAdd } from '../quickadd/quickAddParser'

/**
 * The Universal Inbox's decisions (M18.3) — pure, and small on purpose.
 *
 * A capture is raw text. This module answers three questions about it, each
 * without I/O:
 *
 *  1. **What does it look like it is?** `classifyCapture` — explicit rules over
 *     the Quick Add parser the rest of the app already trusts for dates. It
 *     never guesses: where the text leaves a real question open ("at 4" — in
 *     the morning?), the answer is a question, not a default.
 *  2. **Is this proposal allowed?** `validateInboxProposal` — a closed set of
 *     types and, per type, a closed set of fields. Anything else is refused,
 *     whoever produced it.
 *  3. **Which existing command does it become?** `proposalToIntent` — one of
 *     the five creation intents the executor already runs. The inbox adds a
 *     way in, not a way to write.
 *
 * "Event" is a task with a date and a time. Vaultwork has no separate event
 * entity — the Calendar places tasks by `dueDate` and `dueTime` — so an event
 * proposal is exactly that, and it lands on the Calendar.
 */

interface Dated {
  title: string
  dueDate: DateStr | null
  dueTime: TimeStr | null
  projectId: Id | null
}

export type InboxProposal =
  | ({ type: 'task' } & Dated)
  | ({ type: 'event' } & Dated)
  | { type: 'note'; title: string; body: string }
  | { type: 'knowledge'; title: string; kind: KnowledgeKind; projectId: Id | null }
  | { type: 'project'; name: string }
  | { type: 'goal'; title: string }
  | { type: 'habit'; name: string }

/**
 * Something the user must settle before the proposal can run.
 *
 * The labels are the Assistant's own ("Needs a detail", "Needs a choice"), and
 * each option is a *complete* proposal, so choosing one replaces the proposal
 * outright — there is no partial patch to misapply.
 */
export interface InboxQuestion {
  kind: 'detail' | 'choice'
  question: string
  options: { label: string; proposal: InboxProposal }[]
}

export interface Classification {
  proposal: InboxProposal
  confidence: 'high' | 'low'
  /** Why, in plain words — shown beside the proposal. */
  reason: string
  question: InboxQuestion | null
}

export const INBOX_LIMITS = { title: 200, body: 20_000, capture: 2_000 } as const

// ------------------------------------------------------------------ classify

export interface ClassifyContext {
  /** The user's local now; resolves "tomorrow" the way Quick Add does. */
  now: Date
  projects: Project[]
}

const firstLine = (text: string) => (text.split('\n')[0] ?? '').trim().slice(0, INBOX_LIMITS.title)
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

/** `Project: FixKaru` — the user said what it is, so nothing is inferred. */
const PREFIX = /^(task|todo|note|research|learn|project|goal|habit)\s*:\s*(.+)$/is

const REMEMBER = /^(remember|note)(\s+that)?\s+(.+)$/is
const RESEARCH = /^(research|investigate|explore|look into|read about|read up on)\b/i
const LEARN = /^learn\b/i
const RECURRING =
  /\b(every\s+(day|morning|evening|night|weekday|week)|daily|each\s+(day|morning|evening|night))\b/i
const UNSURE =
  /^(i\s+don'?t\s+know|not\s+sure|should\s+i|what\s+(should|do)\s+i|how\s+(should|do)\s+i)\b/i
const VENTURE = /^(build|start|launch|found|create)\s+(a|an|my|our)\b/i
const MEETING = /^(meeting|meet|call|appointment|interview|lunch|dinner|coffee)\b/i
/**
 * Words that sound like a date and are not one.
 *
 * "Next week" is a week, not a day. Quick Add turns it into the coming Monday
 * because a task field needs a date — the inbox does not, and inventing one is
 * exactly what it must not do. The phrase stays in the title instead.
 */
const VAGUE_DATE = /^(next|this)\s+(week|month)$|^(later|someday|soon)$/i
/** "at 4" with no am/pm: Quick Add leaves it in the title, and so must we — as a question. */
const BARE_HOUR = /\s*\bat\s+(\d{1,2})\b(?!\s*(?:[ap]\.?m\b|:|h\b|o'?clock))/i

function hourLabel(date: DateStr, time: TimeStr): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = ((h + 11) % 12) + 1
  return `${date} · ${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function fromPrefix(word: string, rest: string): Classification {
  const text = tidy(rest)
  const title = firstLine(text)
  const kind = word.toLowerCase()
  const said = { confidence: 'high' as const, question: null, reason: `You said “${kind}”.` }
  switch (kind) {
    case 'note':
      return { ...said, proposal: { type: 'note', title, body: text } }
    case 'research':
    case 'learn':
      return {
        ...said,
        proposal: {
          type: 'knowledge',
          title,
          kind: kind === 'learn' ? 'learning' : 'research',
          projectId: null,
        },
      }
    case 'project':
      return { ...said, proposal: { type: 'project', name: title } }
    case 'goal':
      return { ...said, proposal: { type: 'goal', title } }
    case 'habit':
      return { ...said, proposal: { type: 'habit', name: title } }
    default:
      return {
        ...said,
        proposal: { type: 'task', title, dueDate: null, dueTime: null, projectId: null },
      }
  }
}

/**
 * What a capture looks like, and what — if anything — is still open.
 *
 * Rules, not a model: every outcome is reproducible, works offline and costs
 * nothing, and a reviewer can read why "Research RAG" became knowledge. The
 * order below is the precedence: an explicit prefix beats everything, then the
 * few phrasings that name their own kind, then Quick Add's task reading.
 */
export function classifyCapture(raw: string, context: ClassifyContext): Classification {
  const text = tidy(raw).slice(0, INBOX_LIMITS.capture)

  const prefixed = PREFIX.exec(text)
  if (prefixed?.[1] && prefixed[2]) return fromPrefix(prefixed[1], prefixed[2])

  const remembered = REMEMBER.exec(text)
  if (remembered?.[3]) {
    const fact = capitalise(tidy(remembered[3]))
    return {
      proposal: { type: 'note', title: firstLine(fact), body: fact },
      confidence: 'high',
      reason: 'It starts with “remember”, so it is something to keep, not to do.',
      question: null,
    }
  }

  if (RESEARCH.test(text) || LEARN.test(text)) {
    const kind: KnowledgeKind = LEARN.test(text) ? 'learning' : 'research'
    return {
      proposal: { type: 'knowledge', title: firstLine(text), kind, projectId: null },
      confidence: 'high',
      reason: `It reads as ${kind}: knowledge to keep, not a task to tick off.`,
      question: null,
    }
  }

  if (UNSURE.test(text) || text.endsWith('?')) {
    const title = firstLine(text)
    return {
      proposal: { type: 'note', title, body: text },
      confidence: 'low',
      reason: 'This reads like an open question rather than an action.',
      question: {
        kind: 'choice',
        question: 'What should this become?',
        options: [
          { label: 'A note to think with', proposal: { type: 'note', title, body: text } },
          {
            label: 'A decision to work through',
            proposal: { type: 'knowledge', title, kind: 'decision', projectId: null },
          },
          {
            label: 'A task to follow up',
            proposal: { type: 'task', title, dueDate: null, dueTime: null, projectId: null },
          },
        ],
      },
    }
  }

  if (RECURRING.test(text)) {
    return {
      proposal: { type: 'habit', name: firstLine(tidy(text.replace(RECURRING, ''))) },
      confidence: 'high',
      reason: 'Something done “every day” is a habit.',
      question: null,
    }
  }

  // ------------------------------------------------ Quick Add's task reading
  const parse = parseQuickAdd(text, { now: context.now })
  const notes: string[] = []
  let title = parse.draft.title
  let dueDate = parse.draft.dueDate
  const dueTime = parse.draft.dueTime

  const vague = parse.tokens.find((token) => token.kind === 'date' && VAGUE_DATE.test(token.text))
  if (vague) {
    dueDate = null
    title = tidy(`${title} ${vague.text}`)
    notes.push(`“${vague.text}” is not a day, so no date is set`)
  }

  let projectId: Id | null = null
  let candidates: Project[] = []
  if (parse.draft.projectName) {
    const resolution = resolveProjectByName(context.projects, parse.draft.projectName)
    if (resolution.status === 'resolved') projectId = resolution.entity.id
    else if (resolution.status === 'ambiguous') candidates = resolution.candidates
    else notes.push(`there is no project called “${parse.draft.projectName}”`)
  }

  const bare = BARE_HOUR.exec(title)
  const hour = bare?.[1] === undefined ? null : Number(bare[1])
  const ambiguousHour = bare !== null && hour !== null && hour >= 1 && hour <= 12
  if (ambiguousHour && bare) title = tidy(title.replace(bare[0], ''))

  const type: 'task' | 'event' =
    dueTime !== null || ambiguousHour || MEETING.test(title) ? 'event' : 'task'
  const dated: Dated = { title, dueDate, dueTime, projectId }

  let question: InboxQuestion | null = null
  if (ambiguousHour && hour !== null) {
    // Both readings, each on a named day: nothing is chosen for the user.
    const day = dueDate ?? toDateStr(context.now)
    const at = (h: number) => `${String(h).padStart(2, '0')}:00`
    question = {
      kind: 'detail',
      question: `${hour} in the morning or the afternoon?`,
      options: [at(hour % 12), at((hour % 12) + 12)].map((time) => ({
        label: hourLabel(day, time),
        proposal: { type: 'event', ...dated, dueDate: day, dueTime: time },
      })),
    }
  } else if (candidates.length > 0) {
    question = {
      kind: 'choice',
      question: 'Which project did you mean?',
      options: candidates.map((candidate) => ({
        label: candidate.name,
        proposal: { type, ...dated, projectId: candidate.id },
      })),
    }
  } else if (type === 'event' && dueDate === null) {
    question = { kind: 'detail', question: 'Which day is it?', options: [] }
  } else if (type === 'event' && dueTime === null) {
    question = { kind: 'detail', question: 'What time is it?', options: [] }
  } else if (VENTURE.test(text) && dueDate === null) {
    question = {
      kind: 'choice',
      question: 'Is this a project, or a single task?',
      options: [
        { label: 'A project', proposal: { type: 'project', name: firstLine(text) } },
        { label: 'A single task', proposal: { type: 'task', ...dated } },
      ],
    }
  }

  const reason =
    type === 'event'
      ? 'It has a time, or reads like a meeting, so it belongs on the Calendar.'
      : 'A plain action is a task — the same reading Quick Add gives it.'

  return {
    proposal: { type, ...dated },
    confidence: question === null ? 'high' : 'low',
    reason: notes.length > 0 ? `${reason} Note: ${notes.join('; ')}.` : reason,
    question,
  }
}

// ------------------------------------------------------------------ validate

export type Validated = { ok: true; proposal: InboxProposal } | { ok: false; error: string }

const FIELDS: Record<InboxType, readonly string[]> = {
  task: ['type', 'title', 'dueDate', 'dueTime', 'projectId'],
  event: ['type', 'title', 'dueDate', 'dueTime', 'projectId'],
  note: ['type', 'title', 'body'],
  knowledge: ['type', 'title', 'kind', 'projectId'],
  project: ['type', 'name'],
  goal: ['type', 'title'],
  habit: ['type', 'name'],
}

const isId = (value: unknown): value is Id =>
  typeof value === 'string' && value.length > 0 && value.length <= 100

/**
 * The one door every proposal passes, whoever built it.
 *
 * Strict in the ways that matter for safety: an unknown type is refused, an
 * unknown *field* is refused (not stripped — a proposal carrying a key it
 * should not have is a proposal that was built wrong), and every string is
 * bounded. It does not check that a `projectId` exists; that is a database
 * question, asked by the service immediately before it executes.
 */
export function validateInboxProposal(value: unknown): Validated {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'A proposal must be an object.' }
  }
  const raw = value as Record<string, unknown>
  const type = raw['type']
  if (typeof type !== 'string' || !(INBOX_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `“${String(type)}” is not something the inbox can create.` }
  }
  const kind = type as InboxType

  const extra = Object.keys(raw).filter((key) => !FIELDS[kind].includes(key))
  if (extra.length > 0) return { ok: false, error: `Unexpected field: ${extra.join(', ')}.` }

  const text = (key: string): string | null => {
    const field = raw[key]
    if (typeof field !== 'string') return null
    const trimmed = field.trim()
    return trimmed.length === 0 || trimmed.length > INBOX_LIMITS.title ? null : trimmed
  }
  /** `null` is allowed; a wrong value is `undefined`, which callers refuse. */
  function optional<T>(key: string, check: (v: unknown) => v is T): T | null | undefined {
    const field = raw[key]
    if (field === null) return null
    return check(field) ? field : undefined
  }

  switch (kind) {
    case 'task':
    case 'event': {
      const title = text('title')
      const dueDate = optional('dueDate', isDateStr)
      const dueTime = optional('dueTime', isTimeStr)
      const projectId = optional('projectId', isId)
      if (title === null) return { ok: false, error: 'Give it a title.' }
      if (dueDate === undefined) return { ok: false, error: 'That is not a date.' }
      if (dueTime === undefined) return { ok: false, error: 'That is not a time.' }
      if (projectId === undefined) return { ok: false, error: 'That is not a project.' }
      if (kind === 'event' && (dueDate === null || dueTime === null)) {
        return { ok: false, error: 'An event needs a day and a time.' }
      }
      return { ok: true, proposal: { type: kind, title, dueDate, dueTime, projectId } }
    }
    case 'note': {
      const title = text('title')
      const body = raw['body']
      if (title === null) return { ok: false, error: 'Give it a title.' }
      if (typeof body !== 'string' || body.length > INBOX_LIMITS.body) {
        return { ok: false, error: 'The note body is missing or too long.' }
      }
      return { ok: true, proposal: { type: 'note', title, body } }
    }
    case 'knowledge': {
      const title = text('title')
      const knowledgeKind = raw['kind']
      const projectId = optional('projectId', isId)
      if (title === null) return { ok: false, error: 'Give it a title.' }
      if (
        typeof knowledgeKind !== 'string' ||
        !(KNOWLEDGE_KINDS as readonly string[]).includes(knowledgeKind)
      ) {
        return { ok: false, error: 'That is not a kind of knowledge.' }
      }
      if (projectId === undefined) return { ok: false, error: 'That is not a project.' }
      return {
        ok: true,
        proposal: { type: 'knowledge', title, kind: knowledgeKind as KnowledgeKind, projectId },
      }
    }
    case 'project':
    case 'habit': {
      const name = text('name')
      if (name === null) return { ok: false, error: 'Give it a name.' }
      return { ok: true, proposal: { type: kind, name } }
    }
    case 'goal': {
      const title = text('title')
      if (title === null) return { ok: false, error: 'Give it a title.' }
      return { ok: true, proposal: { type: 'goal', title } }
    }
  }
}

// ------------------------------------------------------------------- execute

/**
 * The existing command a validated proposal becomes.
 *
 * Only creation intents, and only these five — the inbox cannot express an
 * update, a delete or a move, because no proposal type maps to one. Notes and
 * knowledge carry their provenance: the capture they came from.
 */
export function proposalToIntent(proposal: InboxProposal, captureId: Id): CommandIntent {
  const source = 'inbox' as const
  const provenance = { source, sourceId: captureId, sourceUrl: null, capturedAt: null }

  switch (proposal.type) {
    case 'task':
    case 'event':
      return {
        kind: 'task.add',
        source,
        raw: proposal.title,
        draft: {
          ...emptyDraft(),
          title: proposal.title,
          dueDate: proposal.dueDate,
          dueTime: proposal.dueTime,
        },
        tokens: [],
        // A real, already-resolved id — the `@name` was matched against
        // Vaultwork's own projects before the user saw the proposal, so the
        // executor's name lookup is not involved.
        defaultProjectId: proposal.projectId,
      }
    case 'note':
      return {
        kind: 'note.add',
        source,
        raw: proposal.title,
        title: proposal.title,
        body: proposal.body,
        tagIds: [],
        links: [],
        provenance,
      }
    case 'knowledge':
      return {
        kind: 'note.add',
        source,
        raw: proposal.title,
        title: proposal.title,
        body: '',
        tagIds: [],
        links:
          proposal.projectId === null ? [] : [{ refType: 'project', refId: proposal.projectId }],
        knowledgeKind: proposal.kind,
        provenance,
      }
    case 'project':
      return {
        kind: 'project.add',
        source,
        raw: proposal.name,
        name: proposal.name,
        description: null,
        color: null,
        icon: null,
        status: null,
        deadline: null,
      }
    case 'goal':
      return {
        kind: 'goal.add',
        source,
        raw: proposal.title,
        title: proposal.title,
        why: null,
        targetDate: null,
      }
    case 'habit':
      return { kind: 'habit.add', source, raw: proposal.name, name: proposal.name, color: null }
  }
}
