import { platform } from '@/platform'
import { eventRepo, maintenanceRepo, messageLogRepo, taskRepo } from '@/repositories'
import type { AppEvent } from '@/types/entities'

export interface DatabaseSummary {
  counts: Record<string, number>
  openTasks: number
  completedTasks: number
  dueToday: number
  overdue: number
  events: number
  messages: number
  recentEvents: AppEvent[]
}

/**
 * Everything the shell needs to prove the stack is wired end to end.
 *
 * This is not the analytics service — that arrives in M10 and reads the event
 * log properly. This exists so M1/M2 has a screen that reads real rows through
 * the real layers instead of a placeholder that proves nothing.
 */
export async function getDatabaseSummary(): Promise<DatabaseSummary> {
  const today = platform.clock.today()

  const [counts, openTasks, completedTasks, dueToday, overdue, events, messages, recentEvents] =
    await Promise.all([
      maintenanceRepo.liveCounts(),
      taskRepo.countOpen(),
      taskRepo.countCompleted(),
      taskRepo.dueOn(today),
      taskRepo.overdue(today),
      eventRepo.count(),
      messageLogRepo.count(),
      eventRepo.latest(8),
    ])

  return {
    counts,
    openTasks,
    completedTasks,
    dueToday: dueToday.length,
    overdue: overdue.length,
    events,
    messages,
    recentEvents,
  }
}
