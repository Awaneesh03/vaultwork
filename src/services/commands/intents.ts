import type {
  DateStr,
  Goal,
  Habit,
  Id,
  Milestone,
  Note,
  Project,
  Subtask,
  Task,
  TimeStr,
} from '@/types/entities'
import type { EventSource, Priority, ProjectStatus, RefType } from '@/types/enums'
import type { GoalPatch, MilestonePatch } from '../goalService'
import type { NoteLinkInput, NotePatch } from '../noteService'
import type { HabitPatch } from '../habitService'
import type { ProjectPatch } from '../projectService'
import type { QuickAddToken, TaskDraft } from '../quickadd/quickAddParser'
import type { TaskPatch } from '../taskService'
import type { TaskViewId } from '../tasks/taskViews'

/**
 * The command layer's vocabulary.
 *
 * A CommandIntent is "what the user wants", stated without reference to who
 * asked. That is the entire design: the web UI, Quick Add, the command palette
 * and — from M14 — a Telegram message and a model response all produce values
 * of this type, and the executor cannot tell them apart except by the `source`
 * it stamps on the resulting event.
 *
 * A CommandResult is the answer, also stated without reference to the asker:
 * it carries a human-readable `message`, the rows that changed, an optional
 * `undo` intent, and — crucially — an `ambiguous` case, so "which task did you
 * mean?" is a first-class outcome rather than a guess.
 */

/**
 * How a command names a row: by id from a click, or by text from a message.
 *
 * Tasks and projects share the shape, and both intent families put it on a
 * field called `ref` — which is what lets `resolveChoice` rebuild *any*
 * ambiguous intent with an id without knowing what kind of thing it names.
 */
export type EntityRef = { by: 'id'; id: Id } | { by: 'text'; query: string }

/** Kept as the M3 name; `EntityRef` is the same type under a wider label. */
export type TaskRef = EntityRef

export const byId = (id: Id): EntityRef => ({ by: 'id', id })
export const byText = (query: string): EntityRef => ({ by: 'text', query })

interface IntentBase {
  source: EventSource
  /** The text the intent came from, for the log and for error messages. */
  raw: string
}

type Intent<K extends string, P = object> = IntentBase & { kind: K } & P

export type CommandIntent =
  | Intent<
      'task.add',
      {
        draft: TaskDraft
        tokens: QuickAddToken[]
        /**
         * The project a task lands in when the text did not name one. Set by
         * the project detail screen, so capture inside "College" files under
         * College without the user having to type `@College`.
         */
        defaultProjectId?: Id | null | undefined
      }
    >
  | Intent<'task.complete', { ref: TaskRef }>
  | Intent<'task.uncomplete', { ref: TaskRef }>
  | Intent<'task.toggle', { ref: TaskRef }>
  | Intent<'task.delete', { ref: TaskRef }>
  | Intent<'task.restore', { taskId: Id }>
  | Intent<'task.update', { taskId: Id; patch: TaskPatch }>
  | Intent<'task.reschedule', { ref: TaskRef; dueDate: DateStr | null; dueTime: TimeStr | null }>
  | Intent<'task.prioritize', { ref: TaskRef; priority: Priority }>
  | Intent<'task.move', { orderedIds: Id[]; fromIndex: number; toIndex: number }>
  | Intent<'subtask.add', { taskId: Id; title: string }>
  | Intent<'subtask.toggle', { subtaskId: Id }>
  | Intent<'subtask.delete', { subtaskId: Id }>
  | Intent<'subtask.restore', { subtaskId: Id }>
  | Intent<'subtask.move', { taskId: Id; fromIndex: number; toIndex: number }>
  | Intent<'tag.assign', { taskId: Id; tagIds: Id[] }>
  | Intent<'task.assignProject', { taskId: Id; projectId: Id | null }>
  | Intent<'project.add', { name: string; description: string | null; color: string | null; icon: string | null; status: ProjectStatus | null; deadline: DateStr | null }>
  | Intent<'project.update', { projectId: Id; patch: ProjectPatch }>
  | Intent<'project.archive', { ref: EntityRef }>
  | Intent<'project.unarchive', { projectId: Id }>
  | Intent<'project.delete', { ref: EntityRef }>
  | Intent<'project.restore', { projectId: Id }>
  | Intent<'project.move', { orderedIds: Id[]; fromIndex: number; toIndex: number }>
  | Intent<'project.open', { ref: EntityRef }>
  | Intent<'habit.add', { name: string; color: string | null }>
  | Intent<'habit.update', { habitId: Id; patch: HabitPatch }>
  | Intent<'habit.toggle', { habitId: Id; date?: DateStr | undefined }>
  | Intent<'habit.archive', { ref: EntityRef }>
  | Intent<'habit.unarchive', { habitId: Id }>
  | Intent<'habit.delete', { ref: EntityRef }>
  | Intent<'habit.restore', { habitId: Id }>
  | Intent<'habit.move', { orderedIds: Id[]; fromIndex: number; toIndex: number }>
  | Intent<'habit.open', { ref: EntityRef }>
  | Intent<'goal.add', { title: string; why: string | null; targetDate: DateStr | null }>
  | Intent<'goal.update', { goalId: Id; patch: GoalPatch }>
  | Intent<'goal.complete', { ref: EntityRef }>
  | Intent<'goal.reopen', { goalId: Id }>
  | Intent<'goal.archive', { ref: EntityRef }>
  | Intent<'goal.unarchive', { goalId: Id }>
  | Intent<'goal.delete', { ref: EntityRef }>
  | Intent<'goal.restore', { goalId: Id }>
  | Intent<'goal.move', { orderedIds: Id[]; fromIndex: number; toIndex: number }>
  | Intent<'goal.open', { ref: EntityRef }>
  | Intent<'milestone.add', { goalId: Id; title: string; targetDate: DateStr | null }>
  | Intent<'milestone.update', { milestoneId: Id; patch: MilestonePatch }>
  | Intent<'milestone.toggle', { milestoneId: Id }>
  | Intent<'milestone.delete', { milestoneId: Id }>
  | Intent<'milestone.restore', { milestoneId: Id }>
  | Intent<'milestone.move', { goalId: Id; orderedIds: Id[]; fromIndex: number; toIndex: number }>
  | Intent<'task.assignMilestone', { taskId: Id; milestoneId: Id | null }>
  | Intent<
      'note.add',
      { title: string; body: string; tagIds: Id[]; links: NoteLinkInput[] }
    >
  | Intent<'note.update', { noteId: Id; patch: NotePatch }>
  | Intent<'note.delete', { ref: EntityRef }>
  | Intent<'note.restore', { noteId: Id }>
  | Intent<'note.link', { noteId: Id; refType: RefType; refId: Id }>
  | Intent<'note.unlink', { noteId: Id; refType: RefType; refId: Id }>
  | Intent<'note.rename_path', { noteId: Id }>
  | Intent<'note.open', { ref: EntityRef }>
  | Intent<'view.open', { view: TaskViewId }>
  | Intent<'app.navigate', { path: string; label: string }>
  | Intent<'help'>
  | Intent<'unknown', { command: string }>

export type CommandIntentKind = CommandIntent['kind']

/** One numbered option in an ambiguous result. */
export interface CommandChoice {
  /** 1-based, so it can be read aloud or typed as a reply. */
  index: number
  id: Id
  label: string
  hint: string | null
}

export interface CommandHelpEntry {
  usage: string
  summary: string
}

export type CommandResult =
  | { status: 'ok'; kind: 'task'; message: string; task: Task; undo: CommandIntent | null }
  | {
      status: 'ok'
      kind: 'subtask'
      message: string
      taskId: Id
      subtask: Subtask
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'project'
      message: string
      project: Project
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'habit'
      message: string
      habit: Habit
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'goal'
      message: string
      goal: Goal
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'milestone'
      message: string
      milestone: Milestone
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'note'
      message: string
      note: Note
      undo: CommandIntent | null
    }
  | {
      status: 'ok'
      kind: 'view'
      message: string
      view: TaskViewId
      path: string
      tasks: Task[]
    }
  | { status: 'ok'; kind: 'navigate'; message: string; path: string }
  | { status: 'ok'; kind: 'help'; message: string; commands: CommandHelpEntry[] }
  | { status: 'ok'; kind: 'none'; message: string }
  | {
      status: 'ambiguous'
      message: string
      choices: CommandChoice[]
      /** Re-runnable once a choice is made. */
      intent: CommandIntent
    }
  | { status: 'not_found'; message: string; query: string }
  | { status: 'error'; message: string; error: Error | null }

export type CommandStatus = CommandResult['status']

// ------------------------------------------------------------- constructors

export const okNone = (message: string): CommandResult => ({
  status: 'ok',
  kind: 'none',
  message,
})

export const okTask = (
  message: string,
  task: Task,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'task', message, task, undo })

export const okSubtask = (
  message: string,
  taskId: Id,
  subtask: Subtask,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'subtask', message, taskId, subtask, undo })

export const okProject = (
  message: string,
  project: Project,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'project', message, project, undo })

export const okHabit = (
  message: string,
  habit: Habit,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'habit', message, habit, undo })

export const okGoal = (
  message: string,
  goal: Goal,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'goal', message, goal, undo })

export const okMilestone = (
  message: string,
  milestone: Milestone,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'milestone', message, milestone, undo })

export const okNote = (
  message: string,
  note: Note,
  undo: CommandIntent | null = null,
): CommandResult => ({ status: 'ok', kind: 'note', message, note, undo })

export const okView = (
  message: string,
  view: TaskViewId,
  path: string,
  tasks: Task[],
): CommandResult => ({ status: 'ok', kind: 'view', message, view, path, tasks })

export const okNavigate = (message: string, path: string): CommandResult => ({
  status: 'ok',
  kind: 'navigate',
  message,
  path,
})

export const ambiguous = (
  message: string,
  choices: CommandChoice[],
  intent: CommandIntent,
): CommandResult => ({ status: 'ambiguous', message, choices, intent })

export const notFound = (message: string, query: string): CommandResult => ({
  status: 'not_found',
  message,
  query,
})

export const failed = (message: string, error: Error | null = null): CommandResult => ({
  status: 'error',
  message,
  error,
})

export const isOk = (result: CommandResult): boolean => result.status === 'ok'

/** True for results the UI should surface as a toast rather than inline. */
export const isTerminal = (result: CommandResult): boolean =>
  result.status === 'ok' || result.status === 'error' || result.status === 'not_found'
