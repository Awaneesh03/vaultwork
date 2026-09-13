import { AI_CONTEXT_LIMITS } from '@/ai/context/aiContextLimits'
import type {
  AiContextPurpose,
  AiReadModel,
  AiSourceData,
  AiSourceGoal,
  AiSourceDocument,
  AiSourceHabit,
  AiSourceNote,
} from '@/ai/context/aiContextTypes'
import { platform } from '@/platform'
import type { Id } from '@/types/entities'
import { rankForNextAction } from '../dashboard/dashboardStats'
import { getGoalsView } from '../goalQueryService'
import { getTodayHabits } from '../habitQueryService'
import { retrieveDocumentPassages } from '../documentQueryService'
import { getRecentNotes } from '../noteQueryService'
import { getProjectsView } from '../projectQueryService'
import { getTaskCounts, getTaskView } from '../taskQueryService'

/**
 * The application's answer to what the AI layer may ask for.
 *
 * This is the adapter half of the inversion declared in `aiContextTypes`: the
 * AI layer states the interface it needs, and this — a service, in the layer
 * that is allowed to reach repositories — satisfies it. The direction matters.
 * `src/ai` imports nothing from `src/services` at runtime, so the claim that
 * the AI layer cannot reach the database is a property of the import graph
 * rather than a promise about how carefully it was written.
 *
 * Every read below is an existing query service. Nothing here runs a query of
 * its own and nothing here ranks: a second definition of "your open work" would
 * eventually disagree with the screens, and the assistant would then confidently
 * describe a day the Dashboard did not show.
 *
 * A note on why this is not built from `getDashboard`, which would have been
 * one call instead of several. That aggregate is a *preview*: it caps overdue at
 * five rows, today at six, upcoming at six over a seven-day window, and projects
 * at five. Those caps exist for a card on a screen. Sourcing the assistant's
 * context from them would silently hide a task due in a fortnight and then have
 * the model reason as though it did not exist — a wrong answer that looks like
 * a confident one.
 */

/** Every live tag and project name, so the projection can resolve ids to words. */
function namesById<T extends { id: Id }>(rows: readonly T[], name: (row: T) => string) {
  return new Map(rows.map((row) => [row.id, name(row)]))
}

const EMPTY = {
  goals: [] as AiSourceGoal[],
  habits: [] as AiSourceHabit[],
  notes: [] as AiSourceNote[],
  documents: [] as AiSourceDocument[],
}

/**
 * Reads one snapshot for a purpose.
 *
 * Tasks, projects and counts are always read: every purpose that shows anything
 * shows those, and the `general` profile discards them at the builder. Goals,
 * habits and notes are read *only* for planning — which is the point of the
 * profile. Data that is never fetched cannot leak, so the cheapest privacy
 * control available is not asking for it.
 */
export async function readAiSource(purpose: AiContextPurpose, query = ''): Promise<AiSourceData> {
  const wide = purpose === 'planning'
  const wantsDocuments = purpose === 'documents'

  const [taskView, counts, projectView, goalView, habitSummary, recentNotes] = await Promise.all([
    getTaskView('all'),
    getTaskCounts(),
    getProjectsView(),
    wide ? getGoalsView() : null,
    wide ? getTodayHabits() : null,
    // Asked for at exactly the context limit, so the slice the model sees is
    // the slice this application chose rather than a list trimmed after the
    // fact. The builder caps again; a boundary is allowed to be redundant.
    wide ? getRecentNotes(AI_CONTEXT_LIMITS.notes) : null,
  ])

  /*
   * Documents are *retrieved*, not listed.
   *
   * The same deterministic local search the Knowledge page runs, over text that
   * is already in Dexie because the user imported it. Three consequences worth
   * stating: the model does not choose which document is read, the filesystem
   * is never touched, and a question that matches nothing sends nothing rather
   * than falling back to "here are some documents".
   */
  const documentHits = wantsDocuments
    ? await retrieveDocumentPassages(query, AI_CONTEXT_LIMITS.documents)
    : []

  // `rankForNextAction` filters to open tasks and applies M5's ordering. The AI
  // layer neither chooses nor reimplements it.
  const rankedOpenTasks = rankForNextAction(taskView.tasks, taskView.today)

  const goals: AiSourceGoal[] =
    goalView === null
      ? EMPTY.goals
      : goalView.goals.map((item) => ({
          title: item.goal.title,
          targetDate: item.goal.targetDate,
          percent: item.progress.percent,
          health: item.health,
        }))

  const habits: AiSourceHabit[] =
    habitSummary === null
      ? EMPTY.habits
      : habitSummary.habits.map((habit) => ({
          name: habit.name,
          completedToday: habit.completed,
        }))

  // Titles and timestamps only. `RecentNote` also carries an `excerpt` of the
  // body, which is deliberately not read here and has no field to land in.
  const notes: AiSourceNote[] =
    recentNotes === null
      ? EMPTY.notes
      : recentNotes.map((note) => ({ title: note.title, updatedAt: note.updatedAt }))

  const documents: AiSourceDocument[] = documentHits.map((hit) => ({
    title: hit.title,
    path: hit.path ?? '',
    passage: hit.snippet,
    // The document's real size, so the builder can state honestly that what it
    // sent is a passage rather than the document.
    totalChars: hit.snippet.length + 1,
  }))

  return {
    today: taskView.today,
    now: platform.clock.now(),
    rankedOpenTasks,
    projects: projectView.active.map((summary) => ({
      name: summary.project.name,
      status: summary.project.status,
      deadline: summary.project.deadline,
      openTasks: summary.stats.remaining,
      totalTasks: summary.stats.total,
    })),
    goals,
    habits,
    notes,
    documents,
    counts: {
      openTasks: rankedOpenTasks.length,
      dueToday: counts.today,
      overdue: counts.overdue,
    },
    totals: {
      tasks: rankedOpenTasks.length,
      projects: projectView.activeTotal,
      goals: goalView?.totals.active ?? 0,
      habits: habits.length,
      notes: notes.length,
      documents: documents.length,
    },
    projectNames: namesById(taskView.projects, (project) => project.name),
    tagNames: namesById(taskView.tags, (tag) => tag.name),
  }
}

/** The read model the AI layer is handed in production. */
export const aiReadModel: AiReadModel = { read: readAiSource }
