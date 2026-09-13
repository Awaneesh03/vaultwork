import { addDays } from '@/lib/date'
import { platform } from '@/platform'
import { habitEntryRepo, habitRepo, settingsRepo } from '@/repositories'
import type { DateStr, Habit, HabitEntry, Id } from '@/types/entities'
import {
  frequencyOf,
  habitStartDate,
  isHabitScheduledOn,
  type HabitFrequency,
} from './habits/habitSchedule'
import {
  buildHistory,
  calculateCompletionRate,
  calculateCurrentStreak,
  calculateLongestStreak,
  entriesByDate,
  isEntryComplete,
  type CompletionRate,
  type HabitDay,
} from './habits/habitStats'

/**
 * Every read the habit UI performs — and the one the Dashboard performs.
 *
 * Both screens call the *same* functions here, which is what stops them
 * disagreeing about which habits are due today or how many are done. There is
 * no dashboard-specific habit logic anywhere; `getTodayHabits` is the shared
 * answer and the Dashboard simply renders it.
 *
 * Reads are windowed. The list loads one date-range query of entries covering
 * every habit at once — not one query per habit — and streaks are computed over
 * that window rather than over a habit's entire history.
 */

/** How much history the list and the stats look at. */
export const HISTORY_DAYS = 30
export const STREAK_WINDOW_DAYS = 180

export interface HabitListItem {
  habit: Habit
  frequency: HabitFrequency
  /** True when the habit is expected today. Weekly habits always are. */
  scheduledToday: boolean
  completedToday: boolean
  /** Today's logged amount, for quantity habits. `null` when nothing is logged. */
  todayValue: number | null
  currentStreak: number
  longestStreak: number
  /** Over the last `HISTORY_DAYS` days. */
  rate: CompletionRate
  /** Oldest first, `HISTORY_DAYS` long. */
  history: HabitDay[]
}

export interface HabitsViewData {
  today: DateStr
  weekStartsOn: 0 | 1
  active: HabitListItem[]
  archived: HabitListItem[]
  activeTotal: number
  archivedTotal: number
  /** Today's figures, shared verbatim with the Dashboard. */
  summary: TodayHabitSummary
  historyFrom: DateStr
  historyTo: DateStr
}

export interface HabitsViewOptions {
  /** Which habits to show. Mirrors the project screen's state filter. */
  state?: 'active' | 'archived' | 'all' | undefined
  /** Narrows to habits completed or still outstanding today. */
  todayState?: 'any' | 'done' | 'todo' | undefined
  frequency?: HabitFrequency | 'any' | undefined
  search?: string | undefined
}

/** Name-and-nothing-else search: the model carries no description field. */
function matchesSearch(habit: Habit, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = habit.name.toLowerCase()
  return terms.every((term) => text.includes(term))
}

/** Builds one habit's view model from entries already in memory. */
function toItem(
  habit: Habit,
  entries: HabitEntry[],
  today: DateStr,
  weekStartsOn: 0 | 1,
  historyFrom: DateStr,
  streakFrom: DateStr,
): HabitListItem {
  const byDate = entriesByDate(entries)
  const todayEntry = byDate.get(today)

  /*
   * How far back this habit can be judged.
   *
   * A habit cannot be *missed* before it existed, so the floor starts at the
   * day it was created — otherwise every new habit would open with a month of
   * phantom failures. But a recorded entry is evidence the thing happened, so a
   * back-dated day pulls the floor earlier: a user who fills in last week's
   * runs should see last week's streak, not have it silently ignored.
   *
   * Clamped to the loaded window either way, because nothing older than that
   * has been read and a streak must never be computed from absent data.
   */
  const created = habitStartDate(habit)
  const earliest = entries.reduce<DateStr | null>(
    (min, entry) => (min === null || entry.date < min ? entry.date : min),
    null,
  )
  const evidence = earliest !== null && earliest < created ? earliest : created
  const since = evidence > streakFrom ? evidence : streakFrom

  return {
    habit,
    frequency: frequencyOf(habit),
    scheduledToday: isHabitScheduledOn(habit, today),
    completedToday: isEntryComplete(habit, todayEntry),
    todayValue: todayEntry ? todayEntry.value : null,
    currentStreak: calculateCurrentStreak(habit, entries, today, { since, weekStartsOn }),
    longestStreak: calculateLongestStreak(habit, entries, since, today, weekStartsOn),
    rate: calculateCompletionRate(
      habit,
      entries,
      historyFrom > since ? historyFrom : since,
      today,
      weekStartsOn,
    ),
    history: buildHistory(habit, entries, historyFrom, today, today),
  }
}

export async function getHabitsView(
  options: HabitsViewOptions = {},
): Promise<HabitsViewData> {
  const today = platform.clock.today()
  const settings = await settingsRepo.get()
  const weekStartsOn = settings.weekStartsOn

  const historyFrom = addDays(today, -(HISTORY_DAYS - 1))
  const streakFrom = addDays(today, -STREAK_WINDOW_DAYS)

  // One range query for every habit's entries, rather than one per habit.
  const [habits, entries] = await Promise.all([
    habitRepo.listLive(),
    habitEntryRepo.inRange(streakFrom, today),
  ])

  const grouped = new Map<Id, HabitEntry[]>()
  for (const entry of entries) {
    const bucket = grouped.get(entry.habitId)
    if (bucket) bucket.push(entry)
    else grouped.set(entry.habitId, [entry])
  }

  const build = (habit: Habit) =>
    toItem(habit, grouped.get(habit.id) ?? [], today, weekStartsOn, historyFrom, streakFrom)

  const allActive = habits.filter((habit) => habit.archivedAt === null).map(build)
  const allArchived = habits.filter((habit) => habit.archivedAt !== null).map(build)

  const search = options.search?.trim() ?? ''
  const frequency = options.frequency ?? 'any'
  const todayState = options.todayState ?? 'any'

  const keep = (item: HabitListItem) => {
    if (search.length > 0 && !matchesSearch(item.habit, search)) return false
    if (frequency !== 'any' && item.frequency !== frequency) return false
    if (todayState === 'done' && !item.completedToday) return false
    if (todayState === 'todo' && (item.completedToday || !item.scheduledToday)) return false
    return true
  }

  const state = options.state ?? 'active'

  return {
    today,
    weekStartsOn,
    active: state === 'archived' ? [] : allActive.filter(keep),
    archived: state === 'active' ? [] : allArchived.filter(keep),
    activeTotal: allActive.length,
    archivedTotal: allArchived.length,
    summary: summarise(allActive, today),
    historyFrom,
    historyTo: today,
  }
}

// ------------------------------------------------------------------- today

export interface TodayHabitEntry {
  habitId: Id
  name: string
  color: string
  completed: boolean
}

export interface TodayHabitSummary {
  date: DateStr
  /** Active habits expected today. Archived ones never appear. */
  scheduled: number
  completed: number
  remaining: number
  /** Whole percent, 0–100. Nothing scheduled reads 0 rather than NaN. */
  percent: number
  habits: TodayHabitEntry[]
}

function summarise(items: HabitListItem[], today: DateStr): TodayHabitSummary {
  const due = items.filter((item) => item.scheduledToday)
  const completed = due.filter((item) => item.completedToday).length

  return {
    date: today,
    scheduled: due.length,
    completed,
    remaining: due.length - completed,
    percent: due.length === 0 ? 0 : Math.round((completed / due.length) * 100),
    habits: due.map((item) => ({
      habitId: item.habit.id,
      name: item.habit.name,
      color: item.habit.color,
      completed: item.completedToday,
    })),
  }
}

/**
 * Today's habits, on their own.
 *
 * This is what the Dashboard calls. It is the same computation the Habits
 * screen shows, reached through the same code — the Dashboard has no habit
 * rules of its own to drift out of step.
 */
export async function getTodayHabits(): Promise<TodayHabitSummary> {
  const view = await getHabitsView({ state: 'active' })
  return view.summary
}

// ------------------------------------------------------------------- detail

export interface HabitDetailData extends HabitListItem {
  today: DateStr
  weekStartsOn: 0 | 1
  historyFrom: DateStr
  /** Every live entry inside the streak window, oldest first. */
  entries: HabitEntry[]
  /** Live entries the habit holds in total, including outside the window. */
  totalEntries: number
}

export async function getHabitDetail(id: Id): Promise<HabitDetailData | undefined> {
  const habit = await habitRepo.get(id)
  if (!habit) return undefined

  const today = platform.clock.today()
  const settings = await settingsRepo.get()
  const weekStartsOn = settings.weekStartsOn

  const historyFrom = addDays(today, -(HISTORY_DAYS - 1))
  const streakFrom = addDays(today, -STREAK_WINDOW_DAYS)

  const [entries, totalEntries] = await Promise.all([
    habitEntryRepo.forHabitInRange(id, streakFrom, today),
    habitEntryRepo.countForHabit(id),
  ])

  return {
    ...toItem(habit, entries, today, weekStartsOn, historyFrom, streakFrom),
    today,
    weekStartsOn,
    historyFrom,
    entries,
    totalEntries,
  }
}
