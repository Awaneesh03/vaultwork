import { messageLogRepo } from '@/repositories'
import type { Id } from '@/types/entities'
import { getAnalytics } from '../analyticsQueryService'
import { getDashboard, type DashboardData } from '../dashboard/dashboardQueryService'
import { getBacklinks, type Backlink } from '../noteQueryService'
import {
  daysLate,
  progressFor,
  reasonFor,
  timeBudgetFor,
  type TimeBudget,
  type TodayProgress,
} from './todayEngine'

/**
 * The Today Engine (M19): one coherent context for "what matters today".
 *
 * It is the Dashboard's view model plus the few facts the Dashboard could not
 * answer — why each item is there, how late it is, how the day is going, what
 * is planned, what knowledge relates to the next action, and which sources
 * actually contributed. It is not a second query of the task table: every task
 * figure still comes from `getDashboard`'s single read, and everything else is
 * read through the service that owns it.
 *
 * Deterministic, local and explainable. No model is called, nothing is
 * written, and a source that is not connected says so instead of contributing
 * anything that looks like data.
 */

/** How many related notes the next action may bring with it. */
export const TODAY_LIMITS = { knowledge: 3 } as const

/**
 * Where today's information came from, stated honestly.
 *
 * `vaultwork` is always the source of the day: tasks, schedule, projects,
 * habits, goals. `knowledge` is included only when notes linked to the next
 * action actually exist. The rest are not built yet, and say so — they are
 * listed so that a future connector has a slot to fill rather than a page to
 * redesign.
 */
export interface TodaySources {
  vaultwork: 'included'
  knowledge: 'included' | 'none'
  calendar: 'notConnected'
  email: 'notConnected'
  external: 'notConnected'
}

export interface TodayContext extends DashboardData {
  /** Why each task on the page is there, keyed by task id. */
  reasons: Map<Id, string>
  /** Whole days late, for the overdue rows that are late. */
  lateness: Map<Id, number>
  /**
   * How the day is going. Not `progress`: the Dashboard already uses that name
   * for per-task subtask progress, and this is a different thing.
   */
  dayProgress: TodayProgress
  timeBudget: TimeBudget
  /** Notes linked to the next action or its project — never a search. */
  knowledge: Backlink[]
  /** Universal Inbox captures still waiting for a decision. */
  capturesWaiting: number
  sources: TodaySources
}

/**
 * Notes that relate to the next action, by relationships that already exist.
 *
 * The task's own linked notes first, then its project's — the more specific
 * relationship wins. A note linked to both appears once. Nothing is found by
 * text: a note shows up here because someone linked it, not because a word
 * happened to match.
 */
async function relatedKnowledge(dashboard: DashboardData): Promise<Backlink[]> {
  const next = dashboard.nextAction
  if (next === null) return []

  const [forTask, forProject] = await Promise.all([
    getBacklinks('task', next.id),
    next.projectId === null ? Promise.resolve([]) : getBacklinks('project', next.projectId),
  ])

  const seen = new Set<Id>()
  const related: Backlink[] = []
  for (const note of [...forTask, ...forProject]) {
    if (seen.has(note.noteId)) continue
    seen.add(note.noteId)
    related.push(note)
    if (related.length === TODAY_LIMITS.knowledge) break
  }
  return related
}

export async function getTodayContext(): Promise<TodayContext> {
  const dashboard = await getDashboard()
  const { today } = dashboard

  const [analytics, pending, knowledge] = await Promise.all([
    // Focus minutes by the Analytics screen's own rule — the session's actual
    // duration, on the local day it ended — rather than a second definition.
    getAnalytics(7),
    messageLogRepo.listByStatus('pending'),
    relatedKnowledge(dashboard),
  ])

  const projectNames = new Map(dashboard.allProjects.map((project) => [project.id, project.name]))
  const nameOf = (projectId: Id | null) =>
    projectId === null ? null : (projectNames.get(projectId) ?? null)

  // Every task the page shows, once.
  const shown = [
    ...(dashboard.nextAction ? [dashboard.nextAction] : []),
    ...dashboard.overdue,
    ...dashboard.todayGroups.flatMap((group) => group.tasks),
    ...dashboard.upcomingGroups.flatMap((group) => group.tasks),
  ]
  const reasons = new Map<Id, string>()
  const lateness = new Map<Id, number>()
  for (const task of shown) {
    if (reasons.has(task.id)) continue
    reasons.set(task.id, reasonFor(task, today, nameOf(task.projectId)))
    const late = daysLate(task, today)
    if (late !== null) lateness.set(task.id, late)
  }

  const focusToday = analytics.days.find((day) => day.date === today)?.focusMinutes ?? 0

  return {
    ...dashboard,
    reasons,
    lateness,
    dayProgress: progressFor({
      completedToday: dashboard.summary.completedToday,
      openDueToday: dashboard.summary.dueToday,
      focusMinutes: focusToday,
      habitsDone: dashboard.habits.completed,
      habitsScheduled: dashboard.habits.scheduled,
    }),
    timeBudget: timeBudgetFor(dashboard.planned),
    knowledge,
    capturesWaiting: pending.filter((row) => row.source === 'inbox').length,
    sources: {
      vaultwork: 'included',
      knowledge: knowledge.length > 0 ? 'included' : 'none',
      calendar: 'notConnected',
      email: 'notConnected',
      external: 'notConnected',
    },
  }
}
