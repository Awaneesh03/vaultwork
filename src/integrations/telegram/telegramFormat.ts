import { formatDayLabel, formatEstimate, formatTime } from '@/lib/date'
import type { DateStr, Goal, Habit, Project, Task } from '@/types/entities'

/**
 * How Vaultwork talks in a chat window.
 *
 * Plain text, deliberately. Telegram's Markdown would turn a task called
 * `array_index_out_of_bounds` into a parse error the user never sees the cause
 * of, and escaping every title correctly is a bug farm for no gain. Bullets and
 * a middle dot carry the structure instead.
 *
 * Two rules run through all of it: keep it short enough to read on a phone, and
 * never put an internal id in a message. A numbered list is the reference the
 * user works with — `/done 2` — because a UUID is not something anyone should
 * be asked to type or trust.
 *
 * Pure: takes rows, returns a string.
 */

const DOT = ' · '

export const MAX_LIST = 15

function priorityLabel(task: Task): string | null {
  switch (task.priority) {
    case 'high':
      return 'High'
    case 'medium':
      return 'Medium'
    case 'low':
      return 'Low'
    default:
      return null
  }
}

/** The second line under a task: when, how urgent, how long. */
export function taskDetailLine(task: Task, today: DateStr): string | null {
  const parts: string[] = []

  if (task.dueDate !== null) {
    const day = formatDayLabel(task.dueDate, today)
    parts.push(task.dueTime !== null ? `${day} ${formatTime(task.dueTime)}` : day)
  } else if (task.dueTime !== null) {
    parts.push(formatTime(task.dueTime))
  }

  const priority = priorityLabel(task)
  if (priority !== null) parts.push(priority)
  if (task.estimateMin !== null && task.estimateMin > 0) {
    parts.push(formatEstimate(task.estimateMin))
  }

  return parts.length === 0 ? null : parts.join(DOT)
}

/**
 * A numbered task list.
 *
 * The numbers are the whole point: they are the reference the user replies
 * with, and they are positions in *this* message rather than anything stored,
 * so they cannot leak an id or go stale in a way that mutates the wrong row.
 */
export function taskList(title: string, tasks: Task[], today: DateStr, empty: string): string {
  if (tasks.length === 0) return empty

  const shown = tasks.slice(0, MAX_LIST)
  const lines = shown.map((task, index) => {
    const detail = taskDetailLine(task, today)
    const head = `${index + 1}. ${task.title}`
    return detail === null ? head : `${head}\n   ${detail}`
  })

  const more =
    tasks.length > shown.length ? `\n\n…and ${tasks.length - shown.length} more.` : ''

  return `${title}\n\n${lines.join('\n')}${more}`
}

/** Upcoming, grouped by day — the shape the UI's Upcoming screen uses. */
export function groupedTaskList(
  title: string,
  groups: { label: string; tasks: Task[] }[],
  today: DateStr,
  empty: string,
): string {
  const populated = groups.filter((group) => group.tasks.length > 0)
  if (populated.length === 0) return empty

  let counter = 0
  const blocks: string[] = []

  for (const group of populated) {
    const lines: string[] = []
    for (const task of group.tasks) {
      if (counter >= MAX_LIST) break
      counter += 1
      const detail = taskDetailLine(task, today)
      lines.push(detail === null ? `${counter}. ${task.title}` : `${counter}. ${task.title}${DOT}${detail}`)
    }
    if (lines.length > 0) blocks.push(`${group.label}\n${lines.join('\n')}`)
    if (counter >= MAX_LIST) break
  }

  return `${title}\n\n${blocks.join('\n\n')}`
}

/** The confirmation after a task is captured. */
export function taskCreated(task: Task, today: DateStr): string {
  const detail = taskDetailLine(task, today)
  return detail === null ? `Task created\n\n${task.title}` : `Task created\n\n${task.title}\n${detail}`
}

export function habitList(habits: { habit: Habit; doneToday: boolean }[]): string {
  if (habits.length === 0) return 'No habits yet.'
  const lines = habits
    .slice(0, MAX_LIST)
    .map(({ habit, doneToday }) => `${doneToday ? '✓' : '·'} ${habit.name}`)
  return `Habits\n\n${lines.join('\n')}`
}

export function projectList(projects: { project: Project; open: number }[]): string {
  if (projects.length === 0) return 'No active projects.'
  const lines = projects
    .slice(0, MAX_LIST)
    .map(({ project, open }, index) => `${index + 1}. ${project.name}${DOT}${open} open`)
  return `Projects\n\n${lines.join('\n')}`
}

export function goalList(goals: { goal: Goal; done: number; total: number }[]): string {
  if (goals.length === 0) return 'No open goals.'
  const lines = goals.slice(0, MAX_LIST).map(({ goal, done, total }, index) => {
    const progress = total === 0 ? 'no milestones' : `${done}/${total} milestones`
    return `${index + 1}. ${goal.title}${DOT}${progress}`
  })
  return `Goals\n\n${lines.join('\n')}`
}

/** "Which task did you mean?" — the M3 ambiguity outcome, in a chat. */
export function ambiguity(candidates: { title: string }[]): string {
  const lines = candidates
    .slice(0, MAX_LIST)
    .map((candidate, index) => `${index + 1}. ${candidate.title}`)
  return `Which task did you mean?\n\n${lines.join('\n')}\n\nReply with the number.`
}

export function confirmDelete(title: string): string {
  return `Delete this task?\n\n${title}\n\n/confirm to delete, /cancel to keep it.`
}

export function help(entries: { usage: string; summary: string }[]): string {
  const lines = entries.map((entry) => `${entry.usage}\n   ${entry.summary}`)
  return `Vaultwork\n\n${lines.join('\n')}`
}

export function status(counts: {
  today: number
  inbox: number
  overdue: number
  habitsDone: number
  habitsTotal: number
}): string {
  return [
    'Vaultwork',
    '',
    `Today: ${counts.today}`,
    `Inbox: ${counts.inbox}`,
    `Overdue: ${counts.overdue}`,
    `Habits: ${counts.habitsDone}/${counts.habitsTotal}`,
  ].join('\n')
}

/**
 * Telegram refuses anything over 4096 characters, and a refused send is a lost
 * reply rather than a truncated one. Clamped well under the limit so a footer
 * added later cannot push a message over it.
 */
export const MAX_MESSAGE = 3500

/** Shortens a reply to something Telegram will actually accept. */
export function clamp(text: string, max: number = MAX_MESSAGE): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

// --------------------------------------------------------------- assistant
//
// Formatting only. These take strings the application already produced — the
// summaries come from the confirmation gate, never from the model — so nothing
// here decides what an action is, only how it reads in a chat.

/** "Which task did you mean?", with the resolver's own numbering. */
export function aiChoices(query: string, labels: string[]): string {
  const lines = labels.map((label, index) => `${index + 1}. ${label}`)
  return [`Which task did you mean for “${query}”?`, '', ...lines, '', 'Reply with a number.'].join(
    '\n',
  )
}

/** The model's own question, with whatever options it offered. */
export function aiClarification(message: string, options: string[]): string {
  if (options.length === 0) return clamp(message)
  const lines = options.map((option, index) => `${index + 1}. ${option}`)
  return clamp([message, '', ...lines].join('\n'))
}

/**
 * What is about to happen, and the ask.
 *
 * Every line is a confirmation summary written by the application from the
 * resolved command. The model's own description of its plan is deliberately not
 * shown here: a reply that says "tidy up a few old things" while proposing
 * something else is the ordinary failure mode, and the confirmation is the one
 * place that must be exact.
 */
export function aiProposal(summary: readonly string[]): string {
  const heading =
    summary.length === 1 ? 'This would:' : `This would make ${summary.length} changes:`
  const lines = summary.map((line, index) => `${index + 1}. ${line}`)
  return clamp(
    [heading, '', ...lines, '', 'Nothing has changed yet.', '/confirm to apply · /cancel to drop'].join('\n'),
  )
}

export const AI_UNSUPPORTED = 'The assistant needs the desktop app.'
export const AI_NOT_CONFIGURED = 'The assistant is not configured on this machine.'
export const AI_DISABLED = 'The assistant is switched off.'
export const AI_EXPIRED = 'That suggestion has expired. Ask again to get a fresh one.'
export const AI_NO_CHOICE = "I couldn't match that number to an option."

export const GREETING = [
  'Vaultwork is listening.',
  '',
  'Send a task to capture it, or use /today to see what is due.',
  '/help lists everything.',
].join('\n')

export const UNKNOWN_COMMAND = "I don't know that command.\n\nTry:\n/help"
export const NOTHING_TO_CANCEL = 'Nothing to cancel.'
export const CANCELLED = 'Cancelled. Nothing was changed.'
export const NO_SUCH_TASK = "I couldn't find that task."
export const NOTHING_TO_CONFIRM = 'Nothing is waiting for confirmation.'
