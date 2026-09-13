import type { AiContextPurpose } from './aiContextTypes'

/**
 * Choosing how much of the user's application to send.
 *
 * M15.3 built three context profiles and deliberately made the caller name one.
 * This is that decision, and it is made **here, deterministically, from the
 * user's own words** — never by asking the model. Two reasons, and the second
 * is the important one:
 *
 *  1. Asking a model which context it should be given costs a second round trip
 *     to answer a question the application can answer itself.
 *  2. It would let the request decide how much private data leaves the machine.
 *     A phrase read out of a note could then widen its own context. The profile
 *     is a privacy control, and a privacy control that the input can steer is
 *     not one.
 *
 * The rules are intentionally dull — two ordered lists of word matches — and
 * the tie-break is conservative: anything unrecognised gets `general`, which is
 * the date and three counts. Being wrong here should cost an unhelpful answer,
 * never an oversharing one.
 *
 * This is not a classifier and must not grow into one. If the routing is
 * visibly wrong for a phrasing that matters, add the word to a list.
 */

/**
 * Requests that need the long view: goals, habits and note titles alongside the
 * task list. The widest profile, so the list is the narrowest.
 */
/**
 * Requests about an imported PDF.
 *
 * Checked *first*, and the narrowest profile of the three that carry data: a
 * question about a document gets document excerpts and nothing else — not the
 * task list, not goals, not habits. "Summarize my system design PDF" is not a
 * reason to send someone's whole week.
 */
const DOCUMENTS = [
  'pdf',
  'document',
  'documents',
  'paper',
  'papers',
  'handout',
  'slides',
  'textbook',
  'attachment',
]

const PLANNING = [
  'plan',
  'planning',
  'schedule my',
  'revision',
  'revise for',
  'prepare for',
  'study plan',
  'goal',
  'goals',
  'habit',
  'habits',
  'behind',
  'falling behind',
  'this week',
  'next week',
  'exam',
  // Asking for work to be *arranged* is a planning request even when the words
  // for the work itself ("overdue", "tasks") are the narrower ones.
  'organize',
  'organise',
  'break down',
  'prioritise',
  'prioritize',
  'workload',
]

/**
 * Requests about the work itself — adding, finishing, moving, or asking what to
 * do next. Gets tasks and projects, and nothing else.
 */
const TASKS = [
  'task',
  'tasks',
  'add',
  'create',
  'complete',
  'completed',
  'finish',
  'finished',
  'done',
  'reschedule',
  'move',
  'postpone',
  'due',
  'overdue',
  'today',
  'tomorrow',
  'deadline',
  'priority',
  'work on',
  'next',
  'project',
  'projects',
  'inbox',
]

/** Whole words only, so "add" does not match "address" or "ladder". */
function mentions(words: readonly string[], text: string): boolean {
  const haystack = ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `
  return words.some((word) => haystack.includes(` ${word} `))
}

/**
 * The context profile for one request.
 *
 * Documents are checked first, and that ordering is a privacy decision rather
 * than a precedence one: "summarize my system design pdf" also mentions a
 * planning word, and answering it needs the document, not the user's goals and
 * habits. Sending less is the safer way to be wrong.
 *
 * Planning is checked next because it is a superset of tasks: "plan my revision
 * for tomorrow" mentions a task word too, and the broader intent is the right
 * one. Everything else falls to `general`.
 */
export function purposeFor(text: string): AiContextPurpose {
  if (mentions(DOCUMENTS, text)) return 'documents'
  if (mentions(PLANNING, text)) return 'planning'
  if (mentions(TASKS, text)) return 'tasks'
  return 'general'
}
