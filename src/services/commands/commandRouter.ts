import { isCalendarMode } from '@/lib/calendar'
import type { Id } from '@/types/entities'
import type { EventSource } from '@/types/enums'
import { parseQuickAdd } from '../quickadd/quickAddParser'
import { isTaskViewId, TASK_VIEW_LABELS, type TaskViewId } from '../tasks/taskViews'
import { byText, type CommandHelpEntry, type CommandIntent } from './intents'

/**
 * Text in, CommandIntent out. No I/O, no database, no clock of its own.
 *
 * This is the only place that knows about slashes. Everything downstream deals
 * in intents, which is why a Telegram message in M14 needs no new parsing: it
 * arrives as text, comes through here, and joins the same pipeline.
 *
 * Bare text is `/add`, because the fastest capture is the one with no syntax.
 */

export interface RouteContext {
  source: EventSource
  /** Injected so "tomorrow" is deterministic in tests. */
  now?: Date
  /**
   * The project a bare capture belongs to. Set by the project detail screen;
   * text that names a project with `@` still wins over it.
   */
  defaultProjectId?: Id | null
}

type CommandName =
  | 'add'
  | 'done'
  | 'undone'
  | 'delete'
  | 'view'
  | 'search'
  | 'help'
  | 'projects'
  | 'project'
  | 'calendar'
  | 'habits'
  | 'habit'
  | 'goals'
  | 'goal'
  | 'notes'
  | 'note'

interface CommandSpec {
  name: CommandName
  aliases: string[]
  usage: string
  summary: string
  /** For view commands: which view the alias opens. */
  view?: TaskViewId
}

const SPECS: CommandSpec[] = [
  { name: 'add', aliases: ['add', 'a', 'new'], usage: '/add <text>', summary: 'Capture a task. Bare text works too.' },
  { name: 'done', aliases: ['done', 'complete', 'check'], usage: '/done <task>', summary: 'Complete a task by name.' },
  {
    name: 'undone',
    aliases: ['undone', 'uncomplete', 'uncheck', 'reopen'],
    usage: '/undone <task>',
    summary: 'Reopen a completed task.',
  },
  {
    name: 'delete',
    aliases: ['delete', 'del', 'rm', 'remove'],
    usage: '/delete <task>',
    summary: 'Soft-delete a task. Undoable.',
  },
  { name: 'search', aliases: ['search', 'find', 's'], usage: '/search <text>', summary: 'Search every task.' },
  { name: 'help', aliases: ['help', 'h', '?'], usage: '/help', summary: 'List the commands.' },
  {
    name: 'projects',
    aliases: ['projects'],
    usage: '/projects',
    summary: 'Open the Projects screen.',
  },
  {
    name: 'project',
    aliases: ['project', 'proj', 'p'],
    usage: '/project <name>',
    summary: 'Open a project by name.',
  },
  {
    name: 'habits',
    aliases: ['habits'],
    usage: '/habits',
    summary: 'Open the Habits screen.',
  },
  {
    name: 'habit',
    aliases: ['habit'],
    usage: '/habit <name>',
    summary: 'Open a habit by name.',
  },
  {
    name: 'goals',
    aliases: ['goals'],
    usage: '/goals',
    summary: 'Open the Goals screen.',
  },
  {
    name: 'goal',
    aliases: ['goal'],
    usage: '/goal <name>',
    summary: 'Open a goal by name.',
  },
  {
    name: 'notes',
    aliases: ['notes'],
    usage: '/notes',
    summary: 'Open the Notes screen.',
  },
  {
    name: 'note',
    aliases: ['note'],
    usage: '/note <title>',
    summary: 'Open a note by title, or create one.',
  },
  {
    name: 'calendar',
    aliases: ['calendar', 'cal', 'month', 'week', 'day'],
    usage: '/calendar',
    summary: 'Open the calendar. /month, /week and /day pick the view.',
  },
  { name: 'view', aliases: ['inbox'], usage: '/inbox', summary: 'Open the Inbox.', view: 'inbox' },
  { name: 'view', aliases: ['today'], usage: '/today', summary: "Open today's plan.", view: 'today' },
  {
    name: 'view',
    aliases: ['upcoming', 'next'],
    usage: '/upcoming',
    summary: 'Open the next two weeks.',
    view: 'upcoming',
  },
  { name: 'view', aliases: ['overdue', 'late'], usage: '/overdue', summary: 'Open what is late.', view: 'overdue' },
  {
    name: 'view',
    aliases: ['completed'],
    usage: '/completed',
    summary: 'Open what is finished.',
    view: 'completed',
  },
  { name: 'view', aliases: ['tasks', 'all'], usage: '/tasks', summary: 'Open every task.', view: 'all' },
]

const BY_ALIAS = new Map<string, CommandSpec>()
for (const spec of SPECS) {
  for (const alias of spec.aliases) BY_ALIAS.set(alias, spec)
}

export const COMMAND_HELP: CommandHelpEntry[] = SPECS.map((spec) => ({
  usage: spec.usage,
  summary: spec.summary,
}))

/** Every command word, for the palette's suggestions. */
export const COMMAND_ALIASES: string[] = SPECS.flatMap((spec) => spec.aliases)

export function isCommandText(input: string): boolean {
  return input.trimStart().startsWith('/')
}

/** Splits "/done binary trees" into "done" and "binary trees". */
function splitCommand(input: string): { word: string; rest: string } {
  const trimmed = input.trim().slice(1)
  const space = trimmed.search(/\s/)
  if (space === -1) return { word: trimmed.toLowerCase(), rest: '' }
  return { word: trimmed.slice(0, space).toLowerCase(), rest: trimmed.slice(space + 1).trim() }
}

function addIntent(text: string, context: RouteContext): CommandIntent {
  const parse = parseQuickAdd(text, context.now === undefined ? {} : { now: context.now })
  return {
    kind: 'task.add',
    source: context.source,
    raw: text,
    draft: parse.draft,
    tokens: parse.tokens,
    ...(context.defaultProjectId == null ? {} : { defaultProjectId: context.defaultProjectId }),
  }
}

/**
 * `/add project College` — the one qualifier the add command takes.
 *
 * Deliberately the whole of the project grammar. A project has a name, a
 * colour, an icon and a status, and inventing flag syntax for the other three
 * would buy a command language nobody can remember over a two-field form
 * everybody can already use.
 */
const ADD_PROJECT_RE = /^project\s+(.+)$/i

/**
 * `/add habit Read 20 pages` — the second, and last, qualifier `/add` takes.
 *
 * Deliberately explicit. Bare quick-add text always makes a *task*: "Read 20
 * pages daily" is far more often a thing to do today than a routine to commit
 * to, and silently creating a habit from it would be a guess with lasting
 * consequences. The habit composer is where a schedule gets chosen.
 */
const ADD_HABIT_RE = /^habit\s+(.+)$/i

/**
 * `/add goal Become strong in DSA` — the third and last qualifier for `/add`.
 *
 * Explicit for the same reason habits are, only more so. A goal is an outcome
 * with a horizon and a deadline; inferring one from "Become strong in DSA"
 * typed into a task box would silently create a long-lived record the user did
 * not ask for. Bare quick-add text always makes a *task*, and there is no
 * grammar anywhere that turns it into a goal.
 */
const ADD_GOAL_RE = /^goal\s+(.+)$/i

/**
 * `/add note Binary search` — the fourth and last `/add` qualifier.
 *
 * Explicit, like the other three. Bare quick-add text is always a *task*: a
 * note is somewhere to write, and silently turning a captured line into one
 * would put it where the user is not looking for it.
 */
const ADD_NOTE_RE = /^note\s+(.+)$/i

function noteAddIntent(title: string, context: RouteContext): CommandIntent {
  return {
    kind: 'note.add',
    source: context.source,
    raw: title,
    title,
    body: '',
    tagIds: [],
    links: [],
  }
}

function goalAddIntent(title: string, context: RouteContext): CommandIntent {
  return {
    kind: 'goal.add',
    source: context.source,
    raw: title,
    title,
    why: null,
    targetDate: null,
  }
}

function habitAddIntent(name: string, context: RouteContext): CommandIntent {
  return { kind: 'habit.add', source: context.source, raw: name, name, color: null }
}

function projectAddIntent(name: string, context: RouteContext): CommandIntent {
  return {
    kind: 'project.add',
    source: context.source,
    raw: name,
    name,
    description: null,
    color: null,
    icon: null,
    status: null,
    deadline: null,
  }
}

export function parseCommand(input: string, context: RouteContext): CommandIntent {
  const raw = input.trim()
  const { source } = context

  if (raw.length === 0) {
    return { kind: 'unknown', source, raw, command: '' }
  }

  if (!isCommandText(raw)) return addIntent(raw, context)

  const { word, rest } = splitCommand(raw)
  const spec = BY_ALIAS.get(word)

  if (!spec) {
    // An unrecognised slash command is never treated as a task: silently
    // capturing "/dlete foo" as a task titled "/dlete foo" is worse than
    // saying the command does not exist.
    return { kind: 'unknown', source, raw, command: word }
  }

  switch (spec.name) {
    case 'add': {
      const asProject = ADD_PROJECT_RE.exec(rest)
      if (asProject?.[1]) return projectAddIntent(asProject[1].trim(), context)
      const asHabit = ADD_HABIT_RE.exec(rest)
      if (asHabit?.[1]) return habitAddIntent(asHabit[1].trim(), context)
      const asGoal = ADD_GOAL_RE.exec(rest)
      if (asGoal?.[1]) return goalAddIntent(asGoal[1].trim(), context)
      const asNote = ADD_NOTE_RE.exec(rest)
      if (asNote?.[1]) return noteAddIntent(asNote[1].trim(), context)
      return addIntent(rest, { ...context, source })
    }
    case 'done':
      return { kind: 'task.complete', source, raw, ref: byText(rest) }
    case 'undone':
      return { kind: 'task.uncomplete', source, raw, ref: byText(rest) }
    case 'delete':
      return { kind: 'task.delete', source, raw, ref: byText(rest) }
    case 'search':
      return {
        kind: 'app.navigate',
        source,
        raw,
        path: `/tasks?q=${encodeURIComponent(rest)}`,
        label: rest.length > 0 ? `Search “${rest}”` : 'Search tasks',
      }
    case 'help':
      return { kind: 'help', source, raw }
    case 'projects':
      return { kind: 'app.navigate', source, raw, path: '/projects', label: 'Go to Projects' }
    case 'habits':
      return { kind: 'app.navigate', source, raw, path: '/habits', label: 'Go to Habits' }
    case 'habit': {
      if (rest.length === 0) {
        return { kind: 'app.navigate', source, raw, path: '/habits', label: 'Go to Habits' }
      }
      return { kind: 'habit.open', source, raw, ref: byText(rest) }
    }
    case 'goals':
      return { kind: 'app.navigate', source, raw, path: '/goals', label: 'Go to Goals' }
    case 'goal': {
      if (rest.length === 0) {
        return { kind: 'app.navigate', source, raw, path: '/goals', label: 'Go to Goals' }
      }
      return { kind: 'goal.open', source, raw, ref: byText(rest) }
    }
    case 'notes':
      return { kind: 'app.navigate', source, raw, path: '/notes', label: 'Go to Notes' }
    case 'note': {
      if (rest.length === 0) {
        return { kind: 'app.navigate', source, raw, path: '/notes', label: 'Go to Notes' }
      }
      return { kind: 'note.open', source, raw, ref: byText(rest) }
    }
    case 'calendar': {
      /*
       * `/month`, `/week` and `/day` are the same navigation with a starting
       * view. The mode itself is ephemeral UI state, so the query string is an
       * *entry point* rather than a second source of truth: the screen reads it
       * once on arrival and the store owns it from then on.
       */
      const view = isCalendarMode(word) ? word : null
      return {
        kind: 'app.navigate',
        source,
        raw,
        path: view === null ? '/calendar' : `/calendar?view=${view}`,
        label: view === null ? 'Go to Calendar' : `Calendar — ${view}`,
      }
    }
    case 'project': {
      // A bare `/project` is a navigation, not an error: the screen that lists
      // them is the obvious answer to "which project?".
      if (rest.length === 0) {
        return { kind: 'app.navigate', source, raw, path: '/projects', label: 'Go to Projects' }
      }
      return { kind: 'project.open', source, raw, ref: byText(rest) }
    }
    case 'view': {
      const view = spec.view
      if (view && isTaskViewId(view)) return { kind: 'view.open', source, raw, view }
      return { kind: 'unknown', source, raw, command: word }
    }
  }
}

/** The label a producer can show for an intent before running it. */
export function describeIntent(intent: CommandIntent): string {
  switch (intent.kind) {
    case 'task.add':
      return intent.draft.title.length > 0
        ? `Add “${intent.draft.title}”`
        : 'Add a task'
    case 'task.complete':
      return intent.ref.by === 'text' ? `Complete “${intent.ref.query}”` : 'Complete task'
    case 'task.uncomplete':
      return intent.ref.by === 'text' ? `Reopen “${intent.ref.query}”` : 'Reopen task'
    case 'task.delete':
      return intent.ref.by === 'text' ? `Delete “${intent.ref.query}”` : 'Delete task'
    case 'view.open':
      return `Go to ${TASK_VIEW_LABELS[intent.view]}`
    case 'project.add':
      return `Add project “${intent.name}”`
    case 'project.open':
      return intent.ref.by === 'text' ? `Open “${intent.ref.query}”` : 'Open project'
    case 'project.archive':
      return intent.ref.by === 'text' ? `Archive “${intent.ref.query}”` : 'Archive project'
    case 'project.delete':
      return intent.ref.by === 'text' ? `Delete “${intent.ref.query}”` : 'Delete project'
    case 'habit.add':
      return `Add habit “${intent.name}”`
    case 'habit.open':
      return intent.ref.by === 'text' ? `Open “${intent.ref.query}”` : 'Open habit'
    case 'goal.add':
      return `Add goal “${intent.title}”`
    case 'goal.open':
      return intent.ref.by === 'text' ? `Open “${intent.ref.query}”` : 'Open goal'
    case 'goal.complete':
      return intent.ref.by === 'text' ? `Complete “${intent.ref.query}”` : 'Complete goal'
    case 'goal.archive':
      return intent.ref.by === 'text' ? `Archive “${intent.ref.query}”` : 'Archive goal'
    case 'goal.delete':
      return intent.ref.by === 'text' ? `Delete “${intent.ref.query}”` : 'Delete goal'
    case 'milestone.add':
      return `Add milestone “${intent.title}”`
    case 'note.add':
      return `Add note “${intent.title}”`
    case 'note.open':
      return intent.ref.by === 'text' ? `Open “${intent.ref.query}”` : 'Open note'
    case 'note.delete':
      return intent.ref.by === 'text' ? `Delete “${intent.ref.query}”` : 'Delete note'
    case 'app.navigate':
      return intent.label
    case 'help':
      return 'Show the commands'
    case 'unknown':
      return intent.command.length > 0 ? `Unknown command /${intent.command}` : 'Nothing to run'
    default:
      return 'Run command'
  }
}
