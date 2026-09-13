/**
 * Telegram syntax, mapped onto commands Vaultwork already has.
 *
 * This module is a *translator*, not an interpreter. It decides which of three
 * things a line of Telegram text is:
 *
 *   - a conversational command that only Telegram needs (`/start`, `/cancel`),
 *   - a *list* request that maps onto an existing task view,
 *   - or something to hand verbatim to the existing command router.
 *
 * That third case is the important one. `/add Study Java tomorrow #dsa` is not
 * parsed here: it is passed to `parseCommand`, the same function the command
 * palette uses, so Telegram inherits every Quick Add token — dates, times,
 * priorities, estimates, tags, projects — without a second parser existing that
 * could disagree with the first.
 *
 * Pure: no I/O, no persistence, no Telegram API types.
 */

import type { TaskViewId } from '@/services/tasks/taskViews'

/** A reference the user typed: a list position, or text to resolve. */
export type TelegramRef =
  | { by: 'index'; index: number }
  | { by: 'text'; query: string }
  | { by: 'none' }

export type TelegramAction =
  | { kind: 'start' }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'cancel' }
  | { kind: 'confirm' }
  /** A task view the UI already has: today, inbox, upcoming, overdue. */
  | { kind: 'list'; view: TaskViewId }
  | { kind: 'habits' }
  | { kind: 'projects' }
  | { kind: 'goals' }
  /** Completing or deleting, where the target may be a list position. */
  | { kind: 'complete'; ref: TelegramRef }
  | { kind: 'delete'; ref: TelegramRef }
  /** Capture a note: first line is the title, the rest is the body. */
  | { kind: 'note'; title: string; body: string }
  /** Hand this text to the existing command router untouched. */
  | { kind: 'route'; text: string }
  /**
   * Ask the assistant.
   *
   * A named verb rather than a reinterpretation of plain text: plain text is
   * quick capture, and has been since M14. Turning "remind me to call mum" into
   * a question rather than a task would break the one thing this chat is
   * fastest at, so asking is something you say you are doing.
   */
  | { kind: 'ask'; text: string }
  | { kind: 'unknown'; command: string }

/** Telegram sends `/done@my_bot 1` in groups; the suffix is not part of the verb. */
function splitCommand(text: string): { verb: string | null; rest: string } {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { verb: null, rest: trimmed }

  const space = trimmed.search(/\s/)
  const head = space === -1 ? trimmed : trimmed.slice(0, space)
  const rest = space === -1 ? '' : trimmed.slice(space + 1).trim()
  const verb = head.slice(1).split('@')[0]?.toLowerCase() ?? ''
  return { verb, rest }
}

function refOf(rest: string): TelegramRef {
  const trimmed = rest.trim()
  if (trimmed.length === 0) return { by: 'none' }
  // A bare number is a position in the last list this chat was shown. It is
  // resolved against that list rather than treated as a search for "1".
  if (/^\d{1,3}$/.test(trimmed)) return { by: 'index', index: Number(trimmed) }
  return { by: 'text', query: trimmed }
}

const VIEWS: Record<string, TaskViewId> = {
  today: 'today',
  inbox: 'inbox',
  upcoming: 'upcoming',
  overdue: 'overdue',
  completed: 'completed',
  tasks: 'all',
}

/**
 * Every verb this chat recognises, aliases included.
 *
 * Written down so the assistant fallback can tell "I have never heard of this
 * command" from "you used a command I know, but wrongly". Those deserve
 * different answers: the first is a reasonable thing to hand to an assistant,
 * the second is a syntax error, and quietly reinterpreting it would let the
 * assistant paper over mistakes the user should be told about.
 *
 * Kept beside the switch it mirrors; `telegramCommands.test.ts` asserts the two
 * agree, so a verb added to one without the other fails a test.
 */
const KNOWN_VERBS: ReadonlySet<string> = new Set([
  ...Object.keys(VIEWS),
  'start',
  'help',
  'h',
  'status',
  'cancel',
  'confirm',
  'yes',
  'habits',
  'projects',
  'goals',
  'done',
  'complete',
  'check',
  'delete',
  'del',
  'rm',
  'ask',
  'note',
  'add',
  'a',
  'new',
  'search',
])

/** True when the text names a command this chat knows, however badly used. */
export function isKnownCommand(text: string): boolean {
  const { verb } = splitCommand(text)
  return verb !== null && KNOWN_VERBS.has(verb)
}

/**
 * The commands M14 answers.
 *
 * Anything not listed here that begins with `/` is `unknown` — it is *not*
 * quietly passed to the router, because `/deleteeverything` should be a
 * "I don't know that command" rather than a fuzzy match.
 */
export function parseTelegramText(text: string): TelegramAction {
  const { verb, rest } = splitCommand(text)

  // Plain text is quick capture, exactly as typing it into Quick Add would be.
  if (verb === null) {
    if (rest.length === 0) return { kind: 'unknown', command: '' }
    return { kind: 'route', text: rest }
  }

  const view = VIEWS[verb]
  if (view) return { kind: 'list', view }

  switch (verb) {
    case 'start':
      return { kind: 'start' }
    case 'help':
    case 'h':
      return { kind: 'help' }
    case 'status':
      return { kind: 'status' }
    case 'cancel':
      return { kind: 'cancel' }
    case 'confirm':
    case 'yes':
      return { kind: 'confirm' }
    case 'habits':
      return { kind: 'habits' }
    case 'projects':
      return { kind: 'projects' }
    case 'goals':
      return { kind: 'goals' }

    case 'done':
    case 'complete':
    case 'check':
      return { kind: 'complete', ref: refOf(rest) }

    case 'delete':
    case 'del':
    case 'rm':
      return { kind: 'delete', ref: refOf(rest) }

    /*
     * `/note` is the one command Telegram shapes itself, and it is worth saying
     * why. The existing router maps `/note <title>` to `note.open` — navigation
     * to a screen — which is the right thing in the app and meaningless in a
     * chat. So Telegram builds the *existing* `note.add` intent instead: same
     * command union, same executor, same NoteService. What it does not do is
     * invent a note model.
     */
    case 'ask':
      // An empty /ask is a malformed command, not a question. It falls through
      // to the same "I don't know that" reply any other empty verb gets rather
      // than sending a blank prompt to a provider.
      return rest.length === 0 ? { kind: 'unknown', command: verb } : { kind: 'ask', text: rest }

    case 'note': {
      if (rest.length === 0) return { kind: 'unknown', command: verb }
      const [first = '', ...body] = rest.split('\n')
      return { kind: 'note', title: first.trim(), body: body.join('\n').trim() }
    }

    // Handed to the existing router, which owns the syntax.
    case 'add':
    case 'a':
    case 'new':
    case 'search':
    case 'find':
      return rest.length === 0 && (verb === 'add' || verb === 'a' || verb === 'new')
        ? { kind: 'unknown', command: verb }
        : { kind: 'route', text: `/${verb} ${rest}`.trim() }

    default:
      return { kind: 'unknown', command: verb }
  }
}

/** What `/help` lists. Kept here so the text and the parser cannot drift. */
export const TELEGRAM_HELP: { usage: string; summary: string }[] = [
  { usage: '/add <text>', summary: 'Capture a task. Plain text works too.' },
  { usage: '/note <title>', summary: 'Capture a note. Extra lines become the body.' },
  { usage: '/today', summary: "Today's tasks, numbered." },
  { usage: '/inbox', summary: 'Uncategorised tasks.' },
  { usage: '/upcoming', summary: 'The next two weeks, by day.' },
  { usage: '/overdue', summary: 'Past their date, still open.' },
  { usage: '/done <n or text>', summary: 'Complete a task.' },
  { usage: '/delete <n or text>', summary: 'Delete a task. Asks first.' },
  { usage: '/habits', summary: "Today's habits." },
  { usage: '/projects', summary: 'Active projects.' },
  { usage: '/goals', summary: 'Open goals.' },
  { usage: '/ask <question>', summary: 'Ask the assistant. It proposes; you confirm.' },
  { usage: '/status', summary: 'What Vaultwork is holding.' },
  { usage: '/cancel', summary: 'Drop whatever I just asked you.' },
  { usage: '/help', summary: 'This list.' },
]
