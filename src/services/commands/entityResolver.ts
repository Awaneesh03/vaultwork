import type { Goal, Habit, Id, Note, Project, Task } from '@/types/entities'
import type { CommandChoice } from './intents'

/**
 * Turning "binary trees" into a row.
 *
 * The governing rule: **never silently pick a plausible-looking task.** A
 * command that acts on the wrong task is worse than one that asks, because the
 * user does not find out until later. So the resolver only commits when the
 * best-matching *tier* holds exactly one candidate; anything else comes back as
 * an ambiguity with numbered choices, and the caller has to ask.
 *
 * Matching is deterministic — five ranked tiers, no scoring heuristics, no
 * randomness — so the same query against the same rows always resolves the same
 * way, and every case is testable.
 */

export const MAX_CHOICES = 8

export type Resolution<T> =
  { status: 'resolved'; entity: T } | { status: 'ambiguous'; candidates: T[] } | { status: 'none' }

const TIER = {
  exact: 4,
  prefix: 3,
  allWords: 2,
  substring: 1,
  fuzzy: 0,
} as const

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

/** Characters of `query` appear in `text` in order. Catches typos and initials. */
function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (const char of text) {
    if (char === query[i]) i += 1
    if (i === query.length) return true
  }
  return query.length === 0
}

function words(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Which tier a label matches at, or `null` for no match at all. */
export function matchTier(label: string, query: string): number | null {
  const text = normalise(label)
  const needle = normalise(query)
  if (needle.length === 0) return null

  if (text === needle) return TIER.exact
  if (text.startsWith(needle)) return TIER.prefix

  const textWords = new Set(words(text))
  const needleWords = words(needle)
  if (needleWords.length > 0 && needleWords.every((word) => textWords.has(word))) {
    return TIER.allWords
  }

  if (text.includes(needle)) return TIER.substring
  if (isSubsequence(needle.replace(/\s+/g, ''), text.replace(/\s+/g, ''))) return TIER.fuzzy

  return null
}

/**
 * Ranks candidates and commits only when the top tier is unambiguous.
 *
 * Input order is preserved within a tier, so the numbered choices a user sees
 * are stable between two identical commands.
 */
export function resolveByName<T>(
  items: T[],
  query: string,
  label: (item: T) => string,
): Resolution<T> {
  const scored = items
    .map((item) => ({ item, tier: matchTier(label(item), query) }))
    .filter((entry): entry is { item: T; tier: number } => entry.tier !== null)

  if (scored.length === 0) return { status: 'none' }

  const best = Math.max(...scored.map((entry) => entry.tier))
  const top = scored.filter((entry) => entry.tier === best).map((entry) => entry.item)

  const first = top[0]
  if (top.length === 1 && first !== undefined) return { status: 'resolved', entity: first }
  return { status: 'ambiguous', candidates: top.slice(0, MAX_CHOICES) }
}

export function resolveTaskByText(tasks: Task[], query: string): Resolution<Task> {
  return resolveByName(tasks, query, (task) => task.title)
}

export function resolveProjectByName(projects: Project[], query: string): Resolution<Project> {
  return resolveByName(projects, query, (project) => project.name)
}

export function resolveHabitByName(habits: Habit[], query: string): Resolution<Habit> {
  return resolveByName(habits, query, (habit) => habit.name)
}

export function resolveGoalByName(goals: Goal[], query: string): Resolution<Goal> {
  return resolveByName(goals, query, (goal) => goal.title)
}

/**
 * Notes are matched on their stored title only.
 *
 * Deliberately not on the body: a note is a wall of text, and "the note whose
 * body happens to contain this word" is a search result, not an unambiguous
 * reference. `/note x` names a note; the search box finds one.
 */
export function resolveNoteByTitle(notes: Note[], query: string): Resolution<Note> {
  return resolveByName(notes, query, (note) => note.title)
}

/** Numbered options, 1-based, for an ambiguous result. */
export function taskChoices(tasks: Task[], hint: (task: Task) => string | null): CommandChoice[] {
  return tasks.slice(0, MAX_CHOICES).map((task, index) => ({
    index: index + 1,
    id: task.id,
    label: task.title,
    hint: hint(task),
  }))
}

/** The same, for habits. */
export function habitChoices(
  habits: Habit[],
  hint: (habit: Habit) => string | null,
): CommandChoice[] {
  return habits.slice(0, MAX_CHOICES).map((habit, index) => ({
    index: index + 1,
    id: habit.id,
    label: habit.name,
    hint: hint(habit),
  }))
}

/** The same, for goals. */
export function goalChoices(goals: Goal[], hint: (goal: Goal) => string | null): CommandChoice[] {
  return goals.slice(0, MAX_CHOICES).map((goal, index) => ({
    index: index + 1,
    id: goal.id,
    label: goal.title,
    hint: hint(goal),
  }))
}

/** The same, for notes. */
export function noteChoices(notes: Note[], hint: (note: Note) => string | null): CommandChoice[] {
  return notes.slice(0, MAX_CHOICES).map((note, index) => ({
    index: index + 1,
    id: note.id,
    label: note.title,
    hint: hint(note),
  }))
}

/** The same, for projects. Named separately because the label field differs. */
export function projectChoices(
  projects: Project[],
  hint: (project: Project) => string | null,
): CommandChoice[] {
  return projects.slice(0, MAX_CHOICES).map((project, index) => ({
    index: index + 1,
    id: project.id,
    label: project.name,
    hint: hint(project),
  }))
}

/** "Which task did you mean?" plus a numbered list, as one string. */
export function describeChoices(prompt: string, choices: CommandChoice[]): string {
  const lines = choices.map((choice) => `${choice.index}. ${choice.label}`)
  return [prompt, ...lines].join('\n')
}

/** Looks a choice's id up in the candidate list a resolution produced. */
export function pickChoice<T extends { id: Id }>(candidates: T[], id: Id): T | undefined {
  return candidates.find((candidate) => candidate.id === id)
}
