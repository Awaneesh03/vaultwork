import { formatDayLabel } from '@/lib/date'
import { platform } from '@/platform'
import { projectRepo, taskRepo } from '@/repositories'
import type { Goal, Habit, Id, Note, Project, Task } from '@/types/entities'
import * as goals from '../goalService'
import * as habits from '../habitService'
import * as notes from '../noteService'
import * as projects from '../projectService'
import { resolveTagNames } from '../tagService'
import * as tasks from '../taskService'
import { getTaskView } from '../taskQueryService'
import { TASK_VIEW_LABELS, TASK_VIEW_PATHS } from '../tasks/taskViews'
import {
  goalChoices,
  habitChoices,
  noteChoices,
  resolveNoteByTitle,
  projectChoices,
  resolveGoalByName,
  resolveHabitByName,
  resolveProjectByName,
  resolveTaskByText,
  taskChoices,
} from './entityResolver'
import { COMMAND_HELP, parseCommand, type RouteContext } from './commandRouter'
import {
  ambiguous,
  byId,
  failed,
  notFound,
  okGoal,
  okHabit,
  okMilestone,
  okNavigate,
  okNote,
  okNone,
  okProject,
  okSubtask,
  okTask,
  okView,
  type CommandIntent,
  type CommandResult,
  type EntityRef,
} from './intents'

/** Where a project's own screen lives. Duplicated nowhere else. */
export const projectPath = (id: Id): string => `/projects/${id}`

/**
 * The one place a task mutation can be started.
 *
 * Every producer — the web UI, Quick Add, the command palette, and later a
 * Telegram message — hands an intent to `execute` and renders whatever
 * CommandResult comes back. Nothing above this layer calls `taskService`, and
 * nothing at all calls `taskRepo` except the services below it.
 *
 * The executor never guesses. When a text reference matches several tasks it
 * returns an `ambiguous` result with numbered choices and the original intent,
 * and the producer asks. `resolveChoice` then re-runs the intent against one id.
 */

const quoted = (value: string) => `“${value}”`

function describeTask(task: Task, today: string): string | null {
  const parts: string[] = []
  if (task.dueDate) {
    parts.push(task.dueTime ? `${formatDayLabel(task.dueDate, today)} ${task.dueTime}` : formatDayLabel(task.dueDate, today))
  }
  if (task.priority !== 'none') parts.push(task.priority)
  if (task.status === 'done') parts.push('completed')
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Resolves a reference against a candidate pool, or explains why it cannot. */
async function resolveRef(
  ref: EntityRef,
  pool: () => Promise<Task[]>,
  intent: CommandIntent,
  prompt: string,
): Promise<{ task: Task } | { result: CommandResult }> {
  if (ref.by === 'id') {
    const task = await taskRepo.get(ref.id)
    if (!task) return { result: notFound('That task no longer exists.', ref.id) }
    return { task }
  }

  const query = ref.query.trim()
  if (query.length === 0) {
    return { result: failed('Name the task, for example /done binary trees') }
  }

  const candidates = await pool()
  const resolution = resolveTaskByText(candidates, query)
  const today = platform.clock.today()

  if (resolution.status === 'resolved') return { task: resolution.entity }

  if (resolution.status === 'ambiguous') {
    const choices = taskChoices(resolution.candidates, (task) => describeTask(task, today))
    return { result: ambiguous(prompt, choices, intent) }
  }

  return { result: notFound(`Nothing matches ${quoted(query)}.`, query) }
}

/**
 * The project equivalent of `resolveRef`, with the same refusal to guess: a
 * command that archives the wrong project is worse than one that asks.
 */
async function resolveProjectRef(
  ref: EntityRef,
  intent: CommandIntent,
  prompt: string,
): Promise<{ project: Project } | { result: CommandResult }> {
  if (ref.by === 'id') {
    const project = await projectRepo.get(ref.id)
    if (!project) return { result: notFound('That project no longer exists.', ref.id) }
    return { project }
  }

  const query = ref.query.trim()
  if (query.length === 0) {
    return { result: failed('Name the project, for example /project college') }
  }

  const candidates = await projects.listProjects()
  const resolution = resolveProjectByName(candidates, query)

  if (resolution.status === 'resolved') return { project: resolution.entity }

  if (resolution.status === 'ambiguous') {
    return {
      result: ambiguous(prompt, projectChoices(resolution.candidates, describeProject), intent),
    }
  }

  return { result: notFound(`No project matches ${quoted(query)}.`, query) }
}

function describeProject(project: Project): string | null {
  const parts: string[] = [project.status.replace('_', ' ')]
  if (project.deadline) parts.push(`due ${project.deadline}`)
  return parts.join(' · ')
}

/** The habit equivalent of `resolveRef`, with the same refusal to guess. */
async function resolveHabitRef(
  ref: EntityRef,
  intent: CommandIntent,
  prompt: string,
): Promise<{ habit: Habit } | { result: CommandResult }> {
  if (ref.by === 'id') {
    const habit = await habits.getHabit(ref.id)
    if (!habit) return { result: notFound('That habit no longer exists.', ref.id) }
    return { habit }
  }

  const query = ref.query.trim()
  if (query.length === 0) {
    return { result: failed('Name the habit, for example /habit reading') }
  }

  const candidates = await habits.listHabits()
  const resolution = resolveHabitByName(candidates, query)

  if (resolution.status === 'resolved') return { habit: resolution.entity }
  if (resolution.status === 'ambiguous') {
    return {
      result: ambiguous(
        prompt,
        habitChoices(resolution.candidates, (habit) =>
          habit.archivedAt === null ? null : 'archived',
        ),
        intent,
      ),
    }
  }
  return { result: notFound(`No habit matches ${quoted(query)}.`, query) }
}

/** Where a habit lives. One definition, shared by the log and the commands. */
export const habitPath = (id: Id): string => `/habits?habit=${id}`

/** The goal equivalent of `resolveRef`, with the same refusal to guess. */
async function resolveGoalRef(
  ref: EntityRef,
  intent: CommandIntent,
  prompt: string,
): Promise<{ goal: Goal } | { result: CommandResult }> {
  if (ref.by === 'id') {
    const goal = await goals.getGoal(ref.id)
    if (!goal) return { result: notFound('That goal no longer exists.', ref.id) }
    return { goal }
  }

  const query = ref.query.trim()
  if (query.length === 0) {
    return { result: failed('Name the goal, for example /goal dsa') }
  }

  const candidates = await goals.listGoals()
  const resolution = resolveGoalByName(candidates, query)

  if (resolution.status === 'resolved') return { goal: resolution.entity }
  if (resolution.status === 'ambiguous') {
    return {
      result: ambiguous(
        prompt,
        goalChoices(resolution.candidates, (goal) =>
          goal.status === 'active' ? null : goal.status,
        ),
        intent,
      ),
    }
  }
  return { result: notFound(`No goal matches ${quoted(query)}.`, query) }
}

/** Where a goal lives. One definition, shared by the log and the commands. */
export const goalPath = (id: Id): string => `/goals?goal=${id}`

/** The note equivalent of `resolveRef`, with the same refusal to guess. */
async function resolveNoteRef(
  ref: EntityRef,
  intent: CommandIntent,
  prompt: string,
): Promise<{ note: Note } | { result: CommandResult }> {
  if (ref.by === 'id') {
    const note = await notes.getNote(ref.id)
    if (!note) return { result: notFound('That note no longer exists.', ref.id) }
    return { note }
  }

  const query = ref.query.trim()
  if (query.length === 0) {
    return { result: failed('Name the note, for example /note binary search') }
  }

  const candidates = await notes.listNotes()
  const resolution = resolveNoteByTitle(candidates, query)

  if (resolution.status === 'resolved') return { note: resolution.entity }
  if (resolution.status === 'ambiguous') {
    return {
      result: ambiguous(
        prompt,
        noteChoices(resolution.candidates, () => null),
        intent,
      ),
    }
  }
  return { result: notFound(`No note matches ${quoted(query)}.`, query) }
}

/** Where a note lives. One definition, shared by the log and the commands. */
export const notePath = (id: Id): string => `/notes/${id}`

const openTasks = () => taskRepo.byStatus('todo')
const doneTasks = () => taskRepo.byStatus('done')
const liveTasks = () => taskRepo.listLive()

// ------------------------------------------------------------------ task.add

async function runAdd(
  intent: Extract<CommandIntent, { kind: 'task.add' }>,
): Promise<CommandResult> {
  const { draft, source } = intent
  if (draft.title.trim().length === 0) {
    return failed('Give the task a title.')
  }

  const notes: string[] = []

  /*
   * Where the task is filed, in precedence order:
   *
   *   1. the `@project` the text named, if it resolves to exactly one project
   *   2. the screen's own project, when captured from inside one
   *   3. nowhere — the Inbox, which is what "no project" means
   *
   * An unresolvable `@name` never invents a project: a project is a deliberate
   * structure, and quick add is a capture surface. The task is still captured
   * and the note says why it did not land where it was aimed.
   */
  let projectId: Id | null = intent.defaultProjectId ?? null

  if (draft.projectName) {
    const known = await projects.listProjects()
    const resolution = resolveProjectByName(known, draft.projectName)
    if (resolution.status === 'resolved') {
      projectId = resolution.entity.id
    } else {
      notes.push(
        resolution.status === 'ambiguous'
          ? `@${draft.projectName} matched several projects`
          : `no project called ${quoted(draft.projectName)}`,
      )
    }
  }

  const tagIds = await resolveTagNames(draft.tagNames, source)

  const task = await tasks.createTask(
    {
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      dueDate: draft.dueDate,
      dueTime: draft.dueTime,
      estimateMin: draft.estimateMin,
      projectId,
      tagIds,
      subtasks: draft.subtasks,
    },
    { source },
  )

  const today = platform.clock.today()
  const detail = describeTask(task, today)
  const message = [`Added ${quoted(task.title)}`, detail, ...notes].filter(Boolean).join(' · ')

  return okTask(message, task, {
    kind: 'task.delete',
    source,
    raw: '',
    ref: byId(task.id),
  })
}

// ------------------------------------------------------------------ executor

export async function execute(intent: CommandIntent): Promise<CommandResult> {
  try {
    return await run(intent)
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error))
    return failed(wrapped.message, wrapped)
  }
}

async function run(intent: CommandIntent): Promise<CommandResult> {
  const source = intent.source

  switch (intent.kind) {
    case 'task.add':
      return runAdd(intent)

    case 'task.complete': {
      const found = await resolveRef(
        intent.ref,
        openTasks,
        intent,
        'Which task did you mean?',
      )
      if ('result' in found) return found.result
      if (found.task.status === 'done') {
        return okNone(`${quoted(found.task.title)} is already complete.`)
      }
      const task = await tasks.completeTask(found.task.id, { source })
      return okTask(`Completed ${quoted(task.title)}`, task, {
        kind: 'task.uncomplete',
        source,
        raw: '',
        ref: byId(task.id),
      })
    }

    case 'task.uncomplete': {
      const found = await resolveRef(
        intent.ref,
        doneTasks,
        intent,
        'Which completed task did you mean?',
      )
      if ('result' in found) return found.result
      const task = await tasks.uncompleteTask(found.task.id, { source })
      return okTask(`Reopened ${quoted(task.title)}`, task, {
        kind: 'task.complete',
        source,
        raw: '',
        ref: byId(task.id),
      })
    }

    case 'task.toggle': {
      const found = await resolveRef(intent.ref, liveTasks, intent, 'Which task did you mean?')
      if ('result' in found) return found.result
      const task = await tasks.toggleTask(found.task.id, { source })
      const undoKind = task.status === 'done' ? 'task.uncomplete' : 'task.complete'
      return okTask(
        task.status === 'done' ? `Completed ${quoted(task.title)}` : `Reopened ${quoted(task.title)}`,
        task,
        { kind: undoKind, source, raw: '', ref: byId(task.id) },
      )
    }

    case 'task.delete': {
      const found = await resolveRef(
        intent.ref,
        liveTasks,
        intent,
        'Which task did you want to delete?',
      )
      if ('result' in found) return found.result
      const task = await tasks.deleteTask(found.task.id, { source })
      // Soft delete plus an undo token is why deletion needs no confirmation.
      return okTask('Task deleted', task, {
        kind: 'task.restore',
        source,
        raw: '',
        taskId: task.id,
      })
    }

    case 'task.restore': {
      const task = await tasks.restoreTask(intent.taskId, { source })
      return okTask(`Restored ${quoted(task.title)}`, task, {
        kind: 'task.delete',
        source,
        raw: '',
        ref: byId(task.id),
      })
    }

    case 'task.update': {
      const task = await tasks.updateTask(intent.taskId, intent.patch, { source })
      return okTask(`Saved ${quoted(task.title)}`, task)
    }

    case 'task.reschedule': {
      const found = await resolveRef(intent.ref, liveTasks, intent, 'Which task did you mean?')
      if ('result' in found) return found.result
      const before = found.task
      const task = await tasks.rescheduleTask(
        before.id,
        intent.dueDate,
        intent.dueTime,
        { source },
      )
      const today = platform.clock.today()
      const message =
        task.dueDate === null
          ? `Cleared the due date on ${quoted(task.title)}`
          : `${quoted(task.title)} → ${formatDayLabel(task.dueDate, today)}`
      return okTask(message, task, {
        kind: 'task.reschedule',
        source,
        raw: '',
        ref: byId(task.id),
        dueDate: before.dueDate,
        dueTime: before.dueTime,
      })
    }

    case 'task.prioritize': {
      const found = await resolveRef(intent.ref, liveTasks, intent, 'Which task did you mean?')
      if ('result' in found) return found.result
      const before = found.task.priority
      const task = await tasks.setTaskPriority(found.task.id, intent.priority, { source })
      return okTask(`${quoted(task.title)} → ${task.priority}`, task, {
        kind: 'task.prioritize',
        source,
        raw: '',
        ref: byId(task.id),
        priority: before,
      })
    }

    case 'task.move': {
      const moved = await tasks.moveTask(intent.orderedIds, intent.fromIndex, intent.toIndex, {
        source,
      })
      if (!moved) return okNone('Nothing moved.')
      return okTask('Reordered', moved, {
        kind: 'task.move',
        source,
        raw: '',
        orderedIds: intent.orderedIds,
        fromIndex: intent.toIndex,
        toIndex: intent.fromIndex,
      })
    }

    case 'tag.assign': {
      const task = await tasks.setTaskTags(intent.taskId, intent.tagIds, { source })
      return okTask(`Tags updated on ${quoted(task.title)}`, task)
    }

    case 'subtask.add': {
      const subtask = await tasks.addSubtask(intent.taskId, intent.title, { source })
      return okSubtask(`Added ${quoted(subtask.title)}`, intent.taskId, subtask, {
        kind: 'subtask.delete',
        source,
        raw: '',
        subtaskId: subtask.id,
      })
    }

    case 'subtask.toggle': {
      const subtask = await tasks.toggleSubtask(intent.subtaskId, { source })
      return okSubtask(
        subtask.done ? `Checked ${quoted(subtask.title)}` : `Unchecked ${quoted(subtask.title)}`,
        subtask.taskId,
        subtask,
      )
    }

    case 'subtask.delete': {
      const subtask = await tasks.deleteSubtask(intent.subtaskId, { source })
      return okSubtask('Subtask deleted', subtask.taskId, subtask, {
        kind: 'subtask.restore',
        source,
        raw: '',
        subtaskId: subtask.id,
      })
    }

    case 'subtask.restore': {
      const subtask = await tasks.restoreSubtask(intent.subtaskId, { source })
      return okSubtask(`Restored ${quoted(subtask.title)}`, subtask.taskId, subtask)
    }

    case 'subtask.move': {
      const subtask = await tasks.moveSubtask(intent.taskId, intent.fromIndex, intent.toIndex, {
        source,
      })
      if (!subtask) return okNone('Nothing moved.')
      return okSubtask('Reordered', subtask.taskId, subtask)
    }

    // ------------------------------------------------------------- projects

    case 'project.add': {
      const project = await projects.createProject(
        intent.name,
        {
          description: intent.description,
          ...(intent.color === null ? {} : { color: intent.color }),
          ...(intent.icon === null ? {} : { icon: intent.icon }),
          ...(intent.status === null ? {} : { status: intent.status }),
          deadline: intent.deadline,
        },
        source,
      )
      return okProject(`Added project ${quoted(project.name)}`, project, {
        kind: 'project.delete',
        source,
        raw: '',
        ref: byId(project.id),
      })
    }

    case 'project.update': {
      const project = await projects.updateProject(intent.projectId, intent.patch, { source })
      return okProject(`Saved ${quoted(project.name)}`, project)
    }

    case 'project.archive': {
      const found = await resolveProjectRef(
        intent.ref,
        intent,
        'Which project did you want to archive?',
      )
      if ('result' in found) return found.result
      if (found.project.status === 'archived') {
        return okNone(`${quoted(found.project.name)} is already archived.`)
      }
      const counts = await projects.projectTaskCounts(found.project.id)
      const project = await projects.archiveProject(found.project.id, { source })
      // Saying how many tasks survived is the point: archiving is not deleting,
      // and the message is where that promise is either kept or broken.
      const kept =
        counts.total === 0
          ? 'no tasks'
          : counts.total === 1
            ? '1 task kept'
            : `${counts.total} tasks kept`
      return okProject(`Archived ${quoted(project.name)} · ${kept}`, project, {
        kind: 'project.unarchive',
        source,
        raw: '',
        projectId: project.id,
      })
    }

    case 'project.unarchive': {
      const project = await projects.unarchiveProject(intent.projectId, { source })
      return okProject(`Restored ${quoted(project.name)}`, project, {
        kind: 'project.archive',
        source,
        raw: '',
        ref: byId(project.id),
      })
    }

    case 'project.delete': {
      const found = await resolveProjectRef(
        intent.ref,
        intent,
        'Which project did you want to delete?',
      )
      if ('result' in found) return found.result
      const deletion = await projects.deleteProject(found.project.id, { source })
      // Not one task was touched. The count says what is now unfiled, so the
      // message can be honest about what deleting a project does and does not
      // do — and the undo token means nothing has to be confirmed first.
      const orphans =
        deletion.orphanedTaskCount === 0
          ? 'no tasks affected'
          : `${deletion.orphanedTaskCount} task${deletion.orphanedTaskCount === 1 ? '' : 's'} kept`
      return okProject(`Project deleted · ${orphans}`, deletion.project, {
        kind: 'project.restore',
        source,
        raw: '',
        projectId: deletion.project.id,
      })
    }

    case 'project.restore': {
      const project = await projects.restoreProject(intent.projectId, { source })
      return okProject(`Restored ${quoted(project.name)}`, project, {
        kind: 'project.delete',
        source,
        raw: '',
        ref: byId(project.id),
      })
    }

    case 'project.move': {
      const moved = await projects.moveProject(
        intent.orderedIds,
        intent.fromIndex,
        intent.toIndex,
        { source },
      )
      if (!moved) return okNone('Nothing moved.')
      return okProject('Reordered', moved, {
        kind: 'project.move',
        source,
        raw: '',
        orderedIds: intent.orderedIds,
        fromIndex: intent.toIndex,
        toIndex: intent.fromIndex,
      })
    }

    case 'project.open': {
      const found = await resolveProjectRef(intent.ref, intent, 'Which project did you mean?')
      if ('result' in found) return found.result
      return okNavigate(found.project.name, projectPath(found.project.id))
    }

    case 'task.assignProject': {
      const before = await taskRepo.get(intent.taskId)
      if (!before) return notFound('That task no longer exists.', intent.taskId)

      const task = await tasks.updateTask(
        intent.taskId,
        { projectId: intent.projectId },
        { source },
      )

      const target =
        intent.projectId === null
          ? null
          : ((await projectRepo.get(intent.projectId)) ?? null)
      const message =
        target === null
          ? `${quoted(task.title)} → Inbox`
          : `${quoted(task.title)} → ${target.name}`

      return okTask(message, task, {
        kind: 'task.assignProject',
        source,
        raw: '',
        taskId: task.id,
        projectId: before.projectId,
      })
    }

    // --------------------------------------------------------------- habits

    case 'habit.add': {
      const habit = await habits.createHabit(
        intent.name,
        intent.color === null ? {} : { color: intent.color },
        source,
      )
      return okHabit(`Added habit ${quoted(habit.name)}`, habit, {
        kind: 'habit.delete',
        source,
        raw: '',
        ref: byId(habit.id),
      })
    }

    case 'habit.update': {
      const habit = await habits.updateHabit(intent.habitId, intent.patch, { source })
      return okHabit(`Saved ${quoted(habit.name)}`, habit)
    }

    case 'habit.toggle': {
      const habit = await habits.getHabit(intent.habitId)
      if (!habit) return notFound('That habit no longer exists.', intent.habitId)

      const done = await habits.toggleHabit(intent.habitId, {
        source,
        ...(intent.date === undefined ? {} : { date: intent.date }),
      })
      return okHabit(
        done ? `${quoted(habit.name)} done for today` : `${quoted(habit.name)} cleared for today`,
        habit,
      )
    }

    case 'habit.archive': {
      const found = await resolveHabitRef(intent.ref, intent, 'Which habit did you mean?')
      if ('result' in found) return found.result
      if (found.habit.archivedAt !== null) {
        return okNone(`${quoted(found.habit.name)} is already archived.`)
      }
      const habit = await habits.archiveHabit(found.habit.id, { source })
      return okHabit(`Archived ${quoted(habit.name)} · history kept`, habit, {
        kind: 'habit.unarchive',
        source,
        raw: '',
        habitId: habit.id,
      })
    }

    case 'habit.unarchive': {
      const habit = await habits.unarchiveHabit(intent.habitId, { source })
      return okHabit(`Restored ${quoted(habit.name)}`, habit, {
        kind: 'habit.archive',
        source,
        raw: '',
        ref: byId(habit.id),
      })
    }

    case 'habit.delete': {
      const found = await resolveHabitRef(intent.ref, intent, 'Which habit did you mean?')
      if ('result' in found) return found.result
      const deletion = await habits.deleteHabit(found.habit.id, { source })
      // Deleting never destroys history, and the message says so.
      const kept =
        deletion.retainedEntryCount === 0
          ? 'no history'
          : `${deletion.retainedEntryCount} recorded ${deletion.retainedEntryCount === 1 ? 'day' : 'days'} kept`
      return okHabit(`Habit deleted · ${kept}`, deletion.habit, {
        kind: 'habit.restore',
        source,
        raw: '',
        habitId: deletion.habit.id,
      })
    }

    case 'habit.restore': {
      const habit = await habits.restoreHabit(intent.habitId, { source })
      return okHabit(`Restored ${quoted(habit.name)}`, habit, {
        kind: 'habit.delete',
        source,
        raw: '',
        ref: byId(habit.id),
      })
    }

    case 'habit.move': {
      const moved = await habits.moveHabit(
        intent.orderedIds,
        intent.fromIndex,
        intent.toIndex,
        { source },
      )
      if (!moved) return okNone('Nothing moved.')
      return okHabit('Reordered', moved)
    }

    case 'habit.open': {
      const found = await resolveHabitRef(intent.ref, intent, 'Which habit did you mean?')
      if ('result' in found) return found.result
      return okNavigate(found.habit.name, habitPath(found.habit.id))
    }

    // ----------------------------------------------------------------- goals

    case 'goal.add': {
      const goal = await goals.createGoal(
        intent.title,
        { why: intent.why, targetDate: intent.targetDate },
        source,
      )
      return okGoal(`Added goal ${quoted(goal.title)}`, goal, {
        kind: 'goal.delete',
        source,
        raw: '',
        ref: byId(goal.id),
      })
    }

    case 'goal.update': {
      const goal = await goals.updateGoal(intent.goalId, intent.patch, { source })
      return okGoal(`Saved ${quoted(goal.title)}`, goal)
    }

    case 'goal.complete': {
      const found = await resolveGoalRef(intent.ref, intent, 'Which goal did you mean?')
      if ('result' in found) return found.result
      if (found.goal.status === 'achieved') {
        return okNone(`${quoted(found.goal.title)} is already complete.`)
      }
      const goal = await goals.completeGoal(found.goal.id, { source })
      // The message says what was *not* touched, because that is the part a
      // user is most likely to have assumed otherwise.
      return okGoal(`Completed ${quoted(goal.title)} · tasks untouched`, goal, {
        kind: 'goal.reopen',
        source,
        raw: '',
        goalId: goal.id,
      })
    }

    case 'goal.reopen': {
      const goal = await goals.reopenGoal(intent.goalId, { source })
      return okGoal(`Reopened ${quoted(goal.title)}`, goal, {
        kind: 'goal.complete',
        source,
        raw: '',
        ref: byId(goal.id),
      })
    }

    case 'goal.archive': {
      const found = await resolveGoalRef(intent.ref, intent, 'Which goal did you mean?')
      if ('result' in found) return found.result
      if (found.goal.status === 'dropped') {
        return okNone(`${quoted(found.goal.title)} is already archived.`)
      }
      const goal = await goals.archiveGoal(found.goal.id, { source })
      return okGoal(`Archived ${quoted(goal.title)} · milestones kept`, goal, {
        kind: 'goal.unarchive',
        source,
        raw: '',
        goalId: goal.id,
      })
    }

    case 'goal.unarchive': {
      const goal = await goals.unarchiveGoal(intent.goalId, { source })
      return okGoal(`Restored ${quoted(goal.title)}`, goal, {
        kind: 'goal.archive',
        source,
        raw: '',
        ref: byId(goal.id),
      })
    }

    case 'goal.delete': {
      const found = await resolveGoalRef(intent.ref, intent, 'Which goal did you mean?')
      if ('result' in found) return found.result
      const deletion = await goals.deleteGoal(found.goal.id, { source })
      const kept = `${deletion.retainedMilestoneCount} milestone${
        deletion.retainedMilestoneCount === 1 ? '' : 's'
      } and ${deletion.retainedTaskCount} task${
        deletion.retainedTaskCount === 1 ? '' : 's'
      } kept`
      return okGoal(`Goal deleted · ${kept}`, deletion.goal, {
        kind: 'goal.restore',
        source,
        raw: '',
        goalId: deletion.goal.id,
      })
    }

    case 'goal.restore': {
      const goal = await goals.restoreGoal(intent.goalId, { source })
      return okGoal(`Restored ${quoted(goal.title)}`, goal, {
        kind: 'goal.delete',
        source,
        raw: '',
        ref: byId(goal.id),
      })
    }

    case 'goal.move': {
      const moved = await goals.moveGoal(intent.orderedIds, intent.fromIndex, intent.toIndex, {
        source,
      })
      if (!moved) return okNone('Nothing moved.')
      return okGoal('Reordered', moved)
    }

    case 'goal.open': {
      const found = await resolveGoalRef(intent.ref, intent, 'Which goal did you mean?')
      if ('result' in found) return found.result
      return okNavigate(found.goal.title, goalPath(found.goal.id))
    }

    // ------------------------------------------------------------ milestones

    case 'milestone.add': {
      const milestone = await goals.createMilestone(
        intent.goalId,
        intent.title,
        { targetDate: intent.targetDate },
        source,
      )
      return okMilestone(`Added milestone ${quoted(milestone.title)}`, milestone, {
        kind: 'milestone.delete',
        source,
        raw: '',
        milestoneId: milestone.id,
      })
    }

    case 'milestone.update': {
      const milestone = await goals.updateMilestone(intent.milestoneId, intent.patch, { source })
      return okMilestone(`Saved ${quoted(milestone.title)}`, milestone)
    }

    case 'milestone.toggle': {
      const milestone = await goals.toggleMilestone(intent.milestoneId, { source })
      return okMilestone(
        milestone.done
          ? `${quoted(milestone.title)} complete`
          : `${quoted(milestone.title)} reopened`,
        milestone,
        { kind: 'milestone.toggle', source, raw: '', milestoneId: milestone.id },
      )
    }

    case 'milestone.delete': {
      const deletion = await goals.deleteMilestone(intent.milestoneId, { source })
      const kept =
        deletion.retainedTaskCount === 0
          ? 'no tasks affected'
          : `${deletion.retainedTaskCount} task${
              deletion.retainedTaskCount === 1 ? '' : 's'
            } kept`
      return okMilestone(`Milestone deleted · ${kept}`, deletion.milestone, {
        kind: 'milestone.restore',
        source,
        raw: '',
        milestoneId: deletion.milestone.id,
      })
    }

    case 'milestone.restore': {
      const milestone = await goals.restoreMilestone(intent.milestoneId, { source })
      return okMilestone(`Restored ${quoted(milestone.title)}`, milestone, {
        kind: 'milestone.delete',
        source,
        raw: '',
        milestoneId: milestone.id,
      })
    }

    case 'milestone.move': {
      const moved = await goals.moveMilestone(
        intent.goalId,
        intent.orderedIds,
        intent.fromIndex,
        intent.toIndex,
        { source },
      )
      if (!moved) return okNone('Nothing moved.')
      return okMilestone('Reordered', moved)
    }

    case 'task.assignMilestone': {
      // Goes through GoalService, which validates and then delegates the write
      // itself to TaskService — the only function that writes a task row.
      const task = await goals.assignTaskToMilestone(intent.taskId, intent.milestoneId, {
        source,
      })
      return okTask(
        intent.milestoneId === null ? 'Removed from milestone' : 'Added to milestone',
        task,
      )
    }

    // ----------------------------------------------------------------- notes

    case 'note.add': {
      const note = await notes.createNote(
        {
          title: intent.title,
          body: intent.body,
          tagIds: intent.tagIds,
          links: intent.links,
        },
        { source },
      )
      return okNote(`Added note ${quoted(notes.noteTitle(note))}`, note, {
        kind: 'note.delete',
        source,
        raw: '',
        ref: byId(note.id),
      })
    }

    case 'note.update': {
      const note = await notes.updateNote(intent.noteId, intent.patch, { source })
      return okNote(`Saved ${quoted(notes.noteTitle(note))}`, note)
    }

    case 'note.delete': {
      const found = await resolveNoteRef(intent.ref, intent, 'Which note did you mean?')
      if ('result' in found) return found.result
      const deletion = await notes.deleteNote(found.note.id, { source })
      const kept =
        deletion.retainedLinkCount === 0
          ? 'no links affected'
          : `${deletion.retainedLinkCount} link${
              deletion.retainedLinkCount === 1 ? '' : 's'
            } kept`
      return okNote(`Note deleted · ${kept}`, deletion.note, {
        kind: 'note.restore',
        source,
        raw: '',
        noteId: deletion.note.id,
      })
    }

    case 'note.restore': {
      const note = await notes.restoreNote(intent.noteId, { source })
      return okNote(`Restored ${quoted(notes.noteTitle(note))}`, note, {
        kind: 'note.delete',
        source,
        raw: '',
        ref: byId(note.id),
      })
    }

    case 'note.link': {
      await notes.attachLink(intent.noteId, intent.refType, intent.refId, { source })
      const note = await notes.getNote(intent.noteId)
      if (!note) return notFound('That note no longer exists.', intent.noteId)
      return okNote('Linked', note, {
        kind: 'note.unlink',
        source,
        raw: '',
        noteId: intent.noteId,
        refType: intent.refType,
        refId: intent.refId,
      })
    }

    case 'note.unlink': {
      const removed = await notes.detachLink(intent.noteId, intent.refType, intent.refId, {
        source,
      })
      const note = await notes.getNote(intent.noteId)
      if (!note) return notFound('That note no longer exists.', intent.noteId)
      if (!removed) return okNone('That link was already gone.')
      return okNote('Unlinked', note, {
        kind: 'note.link',
        source,
        raw: '',
        noteId: intent.noteId,
        refType: intent.refType,
        refId: intent.refId,
      })
    }

    case 'note.rename_path': {
      const note = await notes.renameVaultPath(intent.noteId, { source })
      return okNote(`Vault path is now ${note.vaultPath ?? 'unset'}`, note)
    }

    case 'note.open': {
      const found = await resolveNoteRef(intent.ref, intent, 'Which note did you mean?')
      if ('result' in found) return found.result
      return okNavigate(notes.noteTitle(found.note), notePath(found.note.id))
    }

    case 'view.open': {
      const data = await getTaskView(intent.view)
      const label = TASK_VIEW_LABELS[intent.view]
      const count = data.tasks.filter((task) => task.status === 'todo').length
      const message =
        intent.view === 'completed'
          ? `${label} · ${data.tasks.length}`
          : `${label} · ${count} open`
      return okView(message, intent.view, TASK_VIEW_PATHS[intent.view], data.tasks)
    }

    case 'app.navigate':
      return okNavigate(intent.label, intent.path)

    case 'help':
      return { status: 'ok', kind: 'help', message: 'Commands', commands: COMMAND_HELP }

    case 'unknown':
      return failed(
        intent.command.length > 0
          ? `There is no /${intent.command} command. Try /help.`
          : 'Type a task, or /help for the commands.',
      )
  }
}

/** parseCommand + execute, for producers that only have text. */
export function executeText(input: string, context: RouteContext): Promise<CommandResult> {
  return execute(parseCommand(input, context))
}

/**
 * Re-runs an ambiguous intent against the task the user picked. The intent is
 * rebuilt with an id reference, so the resolver is not consulted again and the
 * choice cannot drift.
 */
export function resolveChoice(intent: CommandIntent, id: Id): Promise<CommandResult> {
  if ('ref' in intent) {
    return execute({ ...intent, ref: byId(id) } as CommandIntent)
  }
  return execute(intent)
}
