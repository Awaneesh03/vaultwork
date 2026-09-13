import type { Task } from '@/types/entities'
import { AI_CONTEXT_LIMITS, DROP_ORDER } from './aiContextLimits'
import type {
  AiContext,
  AiContextPurpose,
  AiGoal,
  AiHabit,
  AiDocument,
  AiNote,
  AiProject,
  AiSourceData,
  AiTask,
  AiTruncation,
} from './aiContextTypes'

/**
 * Assembling what a model is shown.
 *
 * A pure function of a snapshot. It performs no query, holds no clock, touches
 * no database and mutates nothing it is given — every value it returns is newly
 * constructed, so building a context twice cannot change the application.
 *
 * The work is deliberately dull: project each row onto a hand-written shape,
 * cut each collection to its limit, and cut whole sections if the total is
 * still too big. Being dull is the feature. This is the last place before the
 * network where the question "is this the user's private data?" can be asked,
 * and it should be answerable by reading one file top to bottom.
 */

/**
 * Which sections each purpose carries.
 *
 * Fixed maps rather than anything computed from the request text. A context
 * whose contents depended on how a question was phrased would be a context
 * nobody could audit — and would be steerable by whatever the model last read.
 */
const SECTIONS: Record<AiContextPurpose, ReadonlySet<string>> = {
  /** Barely anything: the date and three numbers. For an unclear request. */
  general: new Set(),
  /** Adding, completing, rescheduling, "what should I do next". */
  tasks: new Set(['tasks', 'projects']),
  /** "Plan my revision", "which goals are behind" — the widest profile. */
  planning: new Set(['tasks', 'projects', 'goals', 'habits', 'notes']),
  /**
   * "Summarize my system design PDF" — document excerpts, and nothing else.
   *
   * Deliberately the *narrowest* profile after `general`: a question about a
   * document does not need the user's task list, their goals or their habits,
   * so it is not given them. Reading a PDF must not become a reason to send
   * everything else.
   */
  documents: new Set(['documents']),
}

export function sectionsFor(purpose: AiContextPurpose): ReadonlySet<string> {
  return SECTIONS[purpose]
}

/**
 * Shortens one free-text field, always at the same place.
 *
 * An ellipsis rather than a hard cut so a truncated title reads as truncated;
 * a model shown "Revise Java collections and" cannot tell whether that is the
 * whole title, and might well propose completing a task by that name.
 */
export function clip(text: string, max: number = AI_CONTEXT_LIMITS.text): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

/** Cuts a collection to its limit, keeping the front. Never samples. */
function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit)
}

function noteTruncation(
  section: string,
  kept: number,
  total: number,
  into: AiTruncation[],
): void {
  if (total > kept) into.push({ section, kept, total })
}

// ------------------------------------------------------------ projections

/**
 * One task, as a model sees it.
 *
 * Written field by field on purpose. `Task` also carries `vaultPath`,
 * `seriesId`, `isTemplate`, `sortOrder`, `reminderAt`, `milestoneId`,
 * `createdAt`, `updatedAt`, `deletedAt` and its `id` — none of which a model
 * needs and one of which is a filesystem path. Spreading the row would have
 * sent all of them, and would have kept sending each new field somebody added
 * to the entity later.
 */
function toTask(
  task: Task,
  projectNames: ReadonlyMap<string, string>,
  tagNames: ReadonlyMap<string, string>,
): AiTask {
  const tags = task.tagIds
    .map((id) => tagNames.get(id))
    .filter((name): name is string => name !== undefined)

  return {
    title: clip(task.title),
    status: task.status === 'done' ? 'done' : 'todo',
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    estimateMin: task.estimateMin,
    project: task.projectId === null ? null : (projectNames.get(task.projectId) ?? null),
    tags: take(tags, AI_CONTEXT_LIMITS.tagsPerTask).map((tag) => clip(tag)),
  }
}

const toProject = (source: AiSourceData['projects'][number]): AiProject => ({
  name: clip(source.name),
  status: source.status,
  deadline: source.deadline,
  openTasks: source.openTasks,
  totalTasks: source.totalTasks,
})

const toGoal = (source: AiSourceData['goals'][number]): AiGoal => ({
  title: clip(source.title),
  targetDate: source.targetDate,
  percent: source.percent,
  health: source.health,
})

const toHabit = (source: AiSourceData['habits'][number]): AiHabit => ({
  name: clip(source.name),
  completedToday: source.completedToday,
})

/** Title and timestamp. Never a body, never an excerpt — see `AiNote`. */
/**
 * One document, clipped to its own ceiling.
 *
 * `clipped` is stated rather than left for the model to notice: an excerpt that
 * stops mid-sentence with no flag invites a confident summary of a document
 * whose second half was never sent.
 */
const toDocument = (source: AiSourceData['documents'][number]): AiDocument => {
  const passage = clip(source.passage, AI_CONTEXT_LIMITS.documentChars)
  return {
    title: clip(source.title),
    path: clip(source.path),
    passage,
    clipped: passage.length < source.totalChars,
  }
}

const toNote = (source: AiSourceData['notes'][number]): AiNote => ({
  title: clip(source.title),
  updatedAt: source.updatedAt,
})

// ---------------------------------------------------------------- building

/**
 * Builds the context for one request.
 *
 * The snapshot arrives already ordered by the application's own rules — tasks
 * in `rankForNextAction` order — so this function chooses nothing about
 * priority. It only decides how much of that order survives.
 */
export function buildAiContext(source: AiSourceData, purpose: AiContextPurpose): AiContext {
  const sections = SECTIONS[purpose]
  const truncated: AiTruncation[] = []

  const tasks = sections.has('tasks')
    ? take(source.rankedOpenTasks, AI_CONTEXT_LIMITS.tasks).map((task) =>
        toTask(task, source.projectNames, source.tagNames),
      )
    : []
  if (sections.has('tasks')) noteTruncation('tasks', tasks.length, source.totals.tasks, truncated)

  const projects = sections.has('projects')
    ? take(source.projects, AI_CONTEXT_LIMITS.projects).map(toProject)
    : []
  if (sections.has('projects')) {
    noteTruncation('projects', projects.length, source.totals.projects, truncated)
  }

  const goals = sections.has('goals')
    ? take(source.goals, AI_CONTEXT_LIMITS.goals).map(toGoal)
    : []
  if (sections.has('goals')) noteTruncation('goals', goals.length, source.totals.goals, truncated)

  const habits = sections.has('habits')
    ? take(source.habits, AI_CONTEXT_LIMITS.habits).map(toHabit)
    : []
  if (sections.has('habits')) {
    noteTruncation('habits', habits.length, source.totals.habits, truncated)
  }

  const notes = sections.has('notes')
    ? take(source.notes, AI_CONTEXT_LIMITS.notes).map(toNote)
    : []
  if (sections.has('notes')) noteTruncation('notes', notes.length, source.totals.notes, truncated)

  const documents = sections.has('documents')
    ? take(source.documents, AI_CONTEXT_LIMITS.documents).map(toDocument)
    : []
  if (sections.has('documents')) {
    noteTruncation('documents', documents.length, source.totals.documents, truncated)
  }

  // Keys are written in a fixed order, which `JSON.stringify` preserves, so two
  // equal contexts serialize to byte-identical strings.
  const context: AiContext = {
    today: source.today,
    now: source.now,
    purpose,
    counts: {
      openTasks: source.counts.openTasks,
      dueToday: source.counts.dueToday,
      overdue: source.counts.overdue,
    },
    tasks,
    projects,
    goals,
    habits,
    notes,
    documents,
    truncated,
  }

  return enforceBudget(context)
}

/**
 * Drops whole sections until the payload fits.
 *
 * Sections rather than rows, and in a fixed order, because dropping rows from
 * the middle of a ranked list produces a context that quietly misrepresents the
 * application — a model told about tasks 1, 2 and 7 will reason as though 3
 * through 6 do not exist. Losing a whole section is legible; the `truncated`
 * list says which, and the model is told what it is missing rather than being
 * left to assume.
 *
 * The task list is never dropped *wholesale* — a context with no tasks is not a
 * smaller answer to "what should I do next", it is a wrong one — but it is
 * shortened from the tail if the other sections were not enough. The tail is
 * the correct end to lose: the list arrives in Next Action order, so the rows
 * given up are the ones the application already ranked least urgent, and the
 * front of the ranking is preserved exactly.
 *
 * That last step is not hypothetical. Forty tasks whose titles are each at the
 * text limit serialize to more than the total budget on their own, so the
 * per-section caps alone do not bound the payload.
 */
function enforceBudget(context: AiContext): AiContext {
  const fits = (candidate: AiContext) =>
    serializeAiContext(candidate).length <= AI_CONTEXT_LIMITS.totalChars

  if (fits(context)) return context

  const trimmed: AiContext = { ...context, truncated: [...context.truncated] }

  const recordCut = (section: string, kept: number, total: number) => {
    const already = trimmed.truncated.find((entry) => entry.section === section)
    if (already) already.kept = kept
    else trimmed.truncated.push({ section, kept, total })
  }

  for (const section of DROP_ORDER) {
    const dropped = trimmed[section]
    if (dropped.length === 0) continue

    // Report against the honest total: whatever an earlier cut already recorded
    // for this section, or the count that is about to be discarded.
    const already = trimmed.truncated.find((entry) => entry.section === section)
    recordCut(section, 0, already?.total ?? dropped.length)

    trimmed[section] = []
    if (fits(trimmed)) return trimmed
  }

  // Still over. Give up the least urgent tasks, one at a time, keeping at least
  // one so the context never claims the user has nothing to do.
  const total = trimmed.truncated.find((entry) => entry.section === 'tasks')?.total ??
    trimmed.tasks.length
  while (trimmed.tasks.length > 1 && !fits(trimmed)) {
    trimmed.tasks = trimmed.tasks.slice(0, -1)
    recordCut('tasks', trimmed.tasks.length, total)
  }

  return trimmed
}

/**
 * The exact bytes handed to a provider.
 *
 * One function, so there is a single answer to "what was sent?" — and so the
 * budget above measures the same string the request carries rather than an
 * approximation of it.
 */
export function serializeAiContext(context: AiContext): string {
  return JSON.stringify(context)
}
