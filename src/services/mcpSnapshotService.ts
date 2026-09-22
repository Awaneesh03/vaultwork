import { AI_CONTEXT_LIMITS } from '@/ai/context/aiContextLimits'
import { toDateStr } from '@/lib/date'
import { platform } from '@/platform'
import type { DateStr, FocusSession, Id, Project, Task, Timestamp } from '@/types/entities'
import { eventBus } from './eventBus'
import { getActiveFocus, listFocusHistory } from './focusService'
import { getTodayHabits } from './habitQueryService'
import { getProjectsView } from './projectQueryService'
import { getTaskView } from './taskQueryService'
import type { ProjectSummary } from './projects/projectStats'

/**
 * The MCP snapshot (M18.1).
 *
 * Claude Desktop launches its MCP servers itself, as separate processes. Such a
 * process cannot read Vaultwork's data: Dexie lives in the WebView, and nothing
 * outside it can open that database. So the reachable half of the application
 * publishes a bounded projection to a file, and the MCP server reads the file.
 *
 * Three properties are load-bearing:
 *
 *  1. **Every read here is an existing query service.** The same functions the
 *     screens call, so what Claude is told about the day and what the Today
 *     screen shows cannot drift apart. No query, no ranking and no date rule is
 *     invented in this file.
 *
 *  2. **The projection is a hand-written shape, row by row.** A Dexie record is
 *     never spread into the output. Fields arrive here by being named, which is
 *     what makes "no credential, no vault path, no note body" a property of the
 *     code rather than a promise — see `toTask`, where `vaultPath` is dropped
 *     on purpose.
 *
 *  3. **It is read-only in both directions.** Nothing in this module writes to
 *     Dexie, and the MCP server can only read what lands in the file. M18.1
 *     exposes no mutation, and the shortest way to keep that true is to have no
 *     mutation path to expose.
 */

/** Bumped only when the shape changes incompatibly; the reader refuses others. */
export const MCP_SNAPSHOT_SCHEMA_VERSION = 1

/**
 * How much of the application travels.
 *
 * Borrowed from the AI context limits rather than restated: both answer the
 * same question — how much of someone's private day leaves the database for a
 * model to read — and two sets of numbers would eventually disagree. The one
 * addition is `focus`, which the AI context has no section for.
 */
export const MCP_SNAPSHOT_LIMITS = {
  tasks: AI_CONTEXT_LIMITS.tasks,
  projects: AI_CONTEXT_LIMITS.projects,
  habits: AI_CONTEXT_LIMITS.habits,
  tags: AI_CONTEXT_LIMITS.tagsPerTask,
  /** Finished sessions from today, for "how much did I focus". */
  focus: 10,
} as const

export interface McpTask {
  id: Id
  title: string
  status: Task['status']
  priority: Task['priority']
  dueDate: DateStr | null
  dueTime: string | null
  estimateMin: number | null
  projectId: Id | null
  projectName: string | null
  tags: string[]
}

export interface McpProject {
  id: Id
  name: string
  status: Project['status']
  deadline: DateStr | null
  /** Straight from `projectStats`, which is what the Projects screen shows. */
  total: number
  completed: number
  remaining: number
  overdue: number
  dueToday: number
  progress: number
  nextDueDate: DateStr | null
}

export interface McpFocusSnapshot {
  /** The session running right now, if one is. */
  active: { kind: FocusSession['kind']; startedAt: string; plannedMin: number } | null
  /** Sessions finished today. */
  completedToday: number
  minutesToday: number
}

export interface McpTodaySnapshot {
  date: DateStr
  dueTodayCount: number
  overdueCount: number
  habits: {
    scheduled: number
    completed: number
    remaining: number
    percent: number
    items: { name: string; completed: boolean }[]
  }
  focus: McpFocusSnapshot
}

export interface McpSnapshot {
  schemaVersion: number
  /** ISO 8601. The one exported timestamp a reader can compare without context. */
  generatedAt: string
  today: McpTodaySnapshot
  /**
   * The four views `vaultwork_get_tasks` can ask for, each already bounded.
   *
   * Stored per view rather than as one list with flags, because the views are
   * the application's own definitions of "today" and "overdue" — recomputing
   * them in the MCP process would be a second implementation of the rules the
   * screens use.
   */
  tasks: {
    today: McpTask[]
    overdue: McpTask[]
    upcoming: McpTask[]
    active: McpTask[]
  }
  projects: McpProject[]
}

/**
 * One task row, field by field.
 *
 * `vaultPath` is absent deliberately: it is an on-disk location, it says where
 * someone's Obsidian vault lives, and no MCP tool needs it. `description` is
 * absent for the same reason a note body is — the three tools answer "what is
 * on today", which needs a title, not a private paragraph.
 */
function toTask(
  task: Task,
  projectName: (id: Id | null) => string | null,
  tagName: (id: Id) => string | null,
): McpTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    estimateMin: task.estimateMin,
    projectId: task.projectId,
    projectName: projectName(task.projectId),
    tags: task.tagIds
      .slice(0, MCP_SNAPSHOT_LIMITS.tags)
      .map(tagName)
      .filter((name): name is string => name !== null),
  }
}

function toProject(entry: ProjectSummary): McpProject {
  const { project, stats } = entry
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    deadline: project.deadline,
    total: stats.total,
    completed: stats.completed,
    remaining: stats.remaining,
    overdue: stats.overdue,
    dueToday: stats.dueToday,
    progress: stats.progress,
    nextDueDate: stats.nextDueDate,
  }
}

function focusOf(
  active: FocusSession | null,
  history: FocusSession[],
  today: DateStr,
): McpFocusSnapshot {
  const finishedToday = history.filter(
    (session) => session.endedAt !== null && toDateStr(new Date(session.endedAt)) === today,
  )
  return {
    active:
      active === null
        ? null
        : {
            kind: active.kind,
            startedAt: new Date(active.startedAt).toISOString(),
            plannedMin: active.plannedMin,
          },
    completedToday: finishedToday.length,
    minutesToday: finishedToday.reduce((total, session) => total + session.actualMin, 0),
  }
}

/**
 * Reads one snapshot. Pure of side effects: it queries and returns, and the
 * caller decides whether it reaches a disk.
 */
export async function buildMcpSnapshot(
  now: Timestamp = platform.clock.now(),
): Promise<McpSnapshot> {
  const today = platform.clock.today()

  const [todayView, overdueView, upcomingView, activeView, projectsView, habits, active, history] =
    await Promise.all([
      getTaskView('today'),
      getTaskView('overdue'),
      getTaskView('upcoming'),
      getTaskView('all'),
      getProjectsView(),
      getTodayHabits(),
      getActiveFocus(),
      listFocusHistory(MCP_SNAPSHOT_LIMITS.focus),
    ])

  /*
   * Today, split the way the Dashboard splits it.
   *
   * `getTaskView('today')` folds overdue work into Today on purpose — that is
   * what /today renders — but this snapshot reports `today` and `overdue` as
   * two fields, exactly as the Dashboard shows two cards. So it drops the same
   * group the Dashboard drops, from the same `groupToday` output, rather than
   * asking a second time what "due today" means. Without this, thirty overdue
   * tasks were reported as thirty tasks due today while the Dashboard said
   * none were, and the two disagreed about a day the user could see.
   */
  const dueTodayOnly = todayView.groups
    .filter((group) => group.id !== 'overdue')
    .flatMap((group) => group.tasks)

  // One name table for every view, built from the live rows the task views
  // already loaded — so a project's name in the snapshot is the name on screen.
  const projectNames = new Map(todayView.projects.map((project) => [project.id, project.name]))
  const tagNames = new Map(todayView.tags.map((tag) => [tag.id, tag.name]))
  const nameOfProject = (id: Id | null) => (id === null ? null : (projectNames.get(id) ?? null))
  const nameOfTag = (id: Id) => tagNames.get(id) ?? null

  const project = (tasks: Task[]) =>
    tasks
      .filter((task) => !task.isTemplate)
      .slice(0, MCP_SNAPSHOT_LIMITS.tasks)
      .map((task) => toTask(task, nameOfProject, nameOfTag))

  return {
    schemaVersion: MCP_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    today: {
      date: today,
      // Counts are the full lists' lengths, taken before the per-view cap, so
      // "30 overdue" stays true even when only 40 rows can travel.
      dueTodayCount: dueTodayOnly.length,
      overdueCount: overdueView.tasks.length,
      habits: {
        scheduled: habits.scheduled,
        completed: habits.completed,
        remaining: habits.remaining,
        percent: habits.percent,
        items: habits.habits
          .slice(0, MCP_SNAPSHOT_LIMITS.habits)
          .map((habit) => ({ name: habit.name, completed: habit.completed })),
      },
      focus: focusOf(active, history, today),
    },
    tasks: {
      today: project(dueTodayOnly),
      overdue: project(overdueView.tasks),
      upcoming: project(upcomingView.tasks),
      active: project(activeView.tasks.filter((task) => task.status === 'todo')),
    },
    projects: [...projectsView.active, ...projectsView.archived]
      .slice(0, MCP_SNAPSHOT_LIMITS.projects)
      .map(toProject),
  }
}

/**
 * When this process last published a snapshot successfully (M18.4).
 *
 * The one fact about MCP Vaultwork can actually verify: that the file was
 * written. Whether Claude Desktop is configured to read it is outside this
 * process, and nothing here pretends to know.
 */
let lastPublishedAt: Timestamp | null = null

export function getMcpSnapshotPublishedAt(): Timestamp | null {
  return lastPublishedAt
}

/** Builds and publishes. Silent about its contents, loud about nothing. */
export async function writeMcpSnapshot(): Promise<boolean> {
  if (!platform.desktop.isSupported) return false
  try {
    const snapshot = await buildMcpSnapshot()
    await platform.desktop.writeMcpSnapshot(JSON.stringify(snapshot))
    lastPublishedAt = platform.clock.now()
    return true
  } catch (error) {
    // Never the snapshot itself: a failure is reported by kind, and the user's
    // day does not travel into a console log to explain a disk error.
    console.error('MCP snapshot could not be written', error instanceof Error ? error.message : '')
    return false
  }
}

/**
 * How long a burst of writes is allowed to collapse into one.
 *
 * Completing five tasks in ten seconds is one intention, and writing the file
 * five times to describe it would be five disk writes for one answer nobody is
 * waiting on. Claude reads on its own schedule, so a few seconds of lag costs
 * nothing that an unnecessary write does not cost more.
 */
export const MCP_SNAPSHOT_DEBOUNCE_MS = 3_000

let pending: ReturnType<typeof setTimeout> | null = null

/**
 * Keeps the snapshot current for as long as Vaultwork is open.
 *
 * Subscribes to the existing event bus rather than introducing a second
 * notification path: every mutation already announces itself there, which is
 * exactly the set of moments the snapshot is stale. Returns an unsubscribe.
 */
export function startMcpSnapshotWriter(debounceMs: number = MCP_SNAPSHOT_DEBOUNCE_MS): () => void {
  if (!platform.desktop.isSupported) return () => {}

  // Once at start-up, so a user who opens Vaultwork and asks Claude a question
  // without touching anything is answered from today rather than from last week.
  void writeMcpSnapshot()

  const unsubscribe = eventBus.subscribe(() => {
    if (pending !== null) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      void writeMcpSnapshot()
    }, debounceMs)
  })

  return () => {
    unsubscribe()
    if (pending !== null) clearTimeout(pending)
    pending = null
  }
}
