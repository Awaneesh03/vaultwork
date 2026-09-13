import { orderAfterLast, orderForMove } from '@/lib/sortOrder'
import { platform } from '@/platform'
import { habitEntryRepo, habitRepo } from '@/repositories'
import type { DateStr, Habit, HabitEntry, Id } from '@/types/entities'
import type { EventSource, HabitCadence, HabitKind } from '@/types/enums'
import { eventBus } from './eventBus'
import { isHabitScheduledOn } from './habits/habitSchedule'

/**
 * Everything that writes a habit or a habit entry.
 *
 * The rules the task and project services established hold here too — one
 * mutation, one event; provenance on the event, never on the row — plus two
 * that are specific to habits and are the whole point of the feature:
 *
 *  1. **Nothing is ever materialised ahead of time.** Creating a daily habit
 *     writes exactly one row. There is no code path in this file that produces
 *     an entry for a day that has not happened, so a habit tracked for three
 *     years costs three years of *completions*, not three years of blank rows.
 *
 *  2. **History is not configuration.** Renaming a habit, recolouring it,
 *     changing its schedule, archiving it or deleting it never touches a single
 *     `HabitEntry`. The habit says what is intended now; the entries say what
 *     happened. Rewriting the second when the first changes would destroy the
 *     only record of what you actually did.
 */

export interface HabitWriteOptions {
  source?: EventSource
}

export interface HabitInput {
  name: string
  color?: string | undefined
  cadence?: HabitCadence | undefined
  /** 0 = Sunday. Empty means every day. */
  daysOfWeek?: number[] | undefined
  targetPerWeek?: number | null | undefined
  kind?: HabitKind | undefined
  unit?: string | null | undefined
  target?: number | null | undefined
  sortOrder?: number | undefined
}

export type HabitPatch = Partial<
  Pick<
    Habit,
    'name' | 'color' | 'cadence' | 'daysOfWeek' | 'targetPerWeek' | 'kind' | 'unit' | 'target'
  >
>

export const DEFAULT_HABIT_COLOR = 'teal'

export class EmptyHabitNameError extends Error {
  constructor() {
    super('A habit needs a name')
    this.name = 'EmptyHabitNameError'
  }
}

export class HabitNotScheduledError extends Error {
  readonly date: DateStr

  constructor(name: string, date: DateStr) {
    super(`“${name}” is not scheduled on ${date}`)
    this.name = 'HabitNotScheduledError'
    this.date = date
  }
}

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')

/** Duplicate names are allowed, matching tags and tasks. Only blanks are not. */
function assertName(name: string): string {
  const cleaned = clean(name)
  if (cleaned.length === 0) throw new EmptyHabitNameError()
  return cleaned
}

// --------------------------------------------------------------------- reads

export function listHabits(): Promise<Habit[]> {
  return habitRepo.listLive()
}

export function listActiveHabits(): Promise<Habit[]> {
  return habitRepo.listActive()
}

export function listArchivedHabits(): Promise<Habit[]> {
  return habitRepo.listArchived()
}

export function getHabit(id: Id): Promise<Habit | undefined> {
  return habitRepo.get(id)
}

// -------------------------------------------------------------------- create

export async function createHabit(
  name: string,
  options: Omit<HabitInput, 'name'> = {},
  source: EventSource = 'ui',
): Promise<Habit> {
  const cleaned = assertName(name)
  const cadence: HabitCadence = options.cadence ?? 'daily'

  return habitRepo.create(
    {
      name: cleaned,
      color: options.color ?? DEFAULT_HABIT_COLOR,
      cadence,
      // A weekly habit is not tied to particular days; storing some anyway
      // would leave two contradictory schedules on one row.
      daysOfWeek: cadence === 'weekly' ? [] : [...(options.daysOfWeek ?? [])].sort(),
      targetPerWeek: cadence === 'weekly' ? Math.max(1, options.targetPerWeek ?? 1) : null,
      kind: options.kind ?? 'binary',
      unit: options.unit ?? null,
      target: options.target ?? null,
      sortOrder: options.sortOrder ?? orderAfterLast(await habitRepo.lastOrder()),
      archivedAt: null,
    },
    { source },
  )
}

// -------------------------------------------------------------------- update

/**
 * Applies a patch. The id is fixed by the signature, so an edit can never
 * produce a second habit — and **no entry is touched**, so changing a Monday
 * habit to weekdays leaves last month's Mondays exactly as they were.
 *
 * A patch that changes nothing writes nothing.
 */
export async function updateHabit(
  id: Id,
  patch: HabitPatch,
  options: HabitWriteOptions = {},
): Promise<Habit> {
  const source: EventSource = options.source ?? 'ui'
  const current = await habitRepo.getOrThrow(id)

  const next: HabitPatch = { ...patch }
  if (typeof next.name === 'string') next.name = assertName(next.name)

  // Keep the two schedule shapes from contradicting each other.
  const cadence = next.cadence ?? current.cadence
  if (cadence === 'weekly') {
    next.daysOfWeek = []
    next.targetPerWeek = Math.max(1, next.targetPerWeek ?? current.targetPerWeek ?? 1)
  } else {
    if (next.daysOfWeek) next.daysOfWeek = [...next.daysOfWeek].sort()
    next.targetPerWeek = null
  }

  const changed = (Object.keys(next) as (keyof HabitPatch)[]).filter((field) => {
    const before = current[field]
    const after = next[field]
    if (Array.isArray(before) && Array.isArray(after)) {
      return before.length !== after.length || before.some((value, i) => value !== after[i])
    }
    return before !== after
  })

  if (changed.length === 0) return current

  return habitRepo.update(id, next, { source })
}

// ---------------------------------------------------------- archive/restore

/**
 * Stops tracking a habit without losing a day of its history.
 *
 * `archivedAt` is a separate field from `deletedAt` in the M1 model, which is
 * what lets an archived habit keep every entry and come back intact.
 */
export async function archiveHabit(id: Id, options: HabitWriteOptions = {}): Promise<Habit> {
  const source: EventSource = options.source ?? 'ui'
  const current = await habitRepo.getOrThrow(id)
  if (current.archivedAt !== null) return current

  const entries = await habitEntryRepo.countForHabit(id)
  const updated = await habitRepo.update(
    id,
    { archivedAt: platform.clock.now() },
    { source, emit: false },
  )

  await eventBus.emit({
    type: 'habit.archived',
    entityType: 'habit',
    entityId: id,
    source,
    payload: { name: updated.name, entryCount: entries },
  })

  return updated
}

export async function unarchiveHabit(id: Id, options: HabitWriteOptions = {}): Promise<Habit> {
  const source: EventSource = options.source ?? 'ui'
  const current = await habitRepo.getOrThrow(id)
  if (current.archivedAt === null) return current

  const updated = await habitRepo.update(id, { archivedAt: null }, { source, emit: false })

  await eventBus.emit({
    type: 'habit.restored',
    entityType: 'habit',
    entityId: id,
    source,
    payload: { name: updated.name, from: 'archived' },
  })

  return updated
}

// ------------------------------------------------------------ delete/restore

export interface HabitDeletion {
  habit: Habit
  /** Entries left in place. Deleting a habit never destroys its history. */
  retainedEntryCount: number
}

/**
 * Soft delete. The habit row is stamped and **its entries are left alone**.
 *
 * That is deliberate and it is what makes restore exactly reversible: the
 * entries still point at the habit id, so bringing the habit back brings its
 * whole history with it. A cascade would turn an undoable action into a
 * permanent loss of the only record of what you did.
 */
export async function deleteHabit(
  id: Id,
  options: HabitWriteOptions = {},
): Promise<HabitDeletion> {
  const source: EventSource = options.source ?? 'ui'
  const habit = await habitRepo.getOrThrow(id)
  const retained = await habitEntryRepo.countForHabit(id)

  await habitRepo.softDelete(id, { source })

  return {
    habit: { ...habit, deletedAt: platform.clock.now() },
    retainedEntryCount: retained,
  }
}

export function restoreHabit(id: Id, options: HabitWriteOptions = {}): Promise<Habit> {
  return habitRepo.restore(id, { source: options.source ?? 'ui' })
}

// ---------------------------------------------------------------- completion

export interface HabitLogResult {
  entry: HabitEntry
  /** False when the day was already recorded exactly this way. */
  changed: boolean
}

/**
 * Records a habit on a date — the one write that says "I did this".
 *
 * Idempotent twice over. The repository does its read and its write inside one
 * transaction against a **unique `[habitId+date]` index**, so a double click
 * cannot produce two rows; and this function only emits `habit.completed` when
 * something actually changed, so a double click cannot produce two events
 * either. The database enforces the first guarantee, not the UI.
 *
 * The date defaults to the clock port's *local* day, so a habit ticked at 23:59
 * lands on today and one ticked at 00:01 lands on the new day.
 */
export async function completeHabit(
  id: Id,
  options: HabitWriteOptions & { date?: DateStr; value?: number; note?: string | null } = {},
): Promise<HabitLogResult> {
  const source: EventSource = options.source ?? 'ui'
  const habit = await habitRepo.getOrThrow(id)
  const date = options.date ?? platform.clock.today()

  if (!isHabitScheduledOn(habit, date)) {
    throw new HabitNotScheduledError(habit.name, date)
  }

  // A binary habit records 1; a quantity habit records its target unless the
  // caller logged a specific amount.
  const value =
    options.value ?? (habit.kind === 'quantity' ? Math.max(1, habit.target ?? 1) : 1)

  const result = await habitEntryRepo.logOnce(
    id,
    date,
    value,
    options.note ?? null,
    platform.clock.now(),
  )

  if (result.changed) {
    await eventBus.emit({
      type: 'habit.completed',
      entityType: 'habit',
      entityId: id,
      source,
      payload: { name: habit.name, date, value },
    })
  }

  return { entry: result.entry, changed: result.changed }
}

/**
 * Removes a day's record.
 *
 * "I did not do this after all" is the *absence* of an entry — the same way
 * every other incomplete day is represented — so the row is removed rather than
 * tombstoned. A soft-deleted row would also sit on the unique index and stop
 * the day ever being recorded again.
 */
export async function uncompleteHabit(
  id: Id,
  options: HabitWriteOptions & { date?: DateStr } = {},
): Promise<boolean> {
  const source: EventSource = options.source ?? 'ui'
  const habit = await habitRepo.getOrThrow(id)
  const date = options.date ?? platform.clock.today()

  const removed = await habitEntryRepo.clear(id, date)
  if (!removed) return false

  await eventBus.emit({
    type: 'habit.uncompleted',
    entityType: 'habit',
    entityId: id,
    source,
    payload: { name: habit.name, date },
  })

  return true
}

/** Completes or clears a date, whichever the current state calls for. */
export async function toggleHabit(
  id: Id,
  options: HabitWriteOptions & { date?: DateStr } = {},
): Promise<boolean> {
  const habit = await habitRepo.getOrThrow(id)
  const date = options.date ?? platform.clock.today()
  const existing = await habitEntryRepo.forHabitOnDate(id, date)

  const required = habit.kind === 'quantity' ? Math.max(1, habit.target ?? 1) : 1
  if (existing && existing.value >= required) {
    await uncompleteHabit(id, { ...options, date })
    return false
  }

  await completeHabit(id, { ...options, date })
  return true
}

// ------------------------------------------------------------------ ordering

/**
 * Moves a habit within an ordered list of ids. One row is written: the moved
 * habit's `sortOrder` becomes the midpoint of its new neighbours — the same
 * strategy tasks and projects use, so there is one ordering mechanism in the
 * application rather than three.
 */
export async function moveHabit(
  orderedIds: Id[],
  fromIndex: number,
  toIndex: number,
  options: HabitWriteOptions = {},
): Promise<Habit | undefined> {
  const id = orderedIds[fromIndex]
  if (!id || fromIndex === toIndex) return undefined

  const source: EventSource = options.source ?? 'ui'
  const rows = await Promise.all(orderedIds.map((habitId) => habitRepo.get(habitId)))
  const present = rows.filter((row): row is Habit => row !== undefined)
  if (present.length !== orderedIds.length) await respace(present)

  const orders = present.map((habit) => habit.sortOrder)
  const sortOrder = orderForMove(orders, fromIndex, toIndex)

  if (!Number.isFinite(sortOrder) || hasCollision(orders, sortOrder, fromIndex)) {
    const respaced = await respace(present)
    return applyOrder(
      id,
      orderForMove(respaced.map((habit) => habit.sortOrder), fromIndex, toIndex),
      source,
    )
  }

  return applyOrder(id, sortOrder, source)
}

function hasCollision(orders: number[], candidate: number, skipIndex: number): boolean {
  return orders.some((order, index) => index !== skipIndex && order === candidate)
}

async function applyOrder(id: Id, sortOrder: number, source: EventSource): Promise<Habit> {
  const updated = await habitRepo.update(id, { sortOrder }, { source, emit: false })
  await eventBus.emit({
    type: 'habit.reordered',
    entityType: 'habit',
    entityId: id,
    source,
    payload: { sortOrder },
  })
  return updated
}

async function respace(habits: Habit[]): Promise<Habit[]> {
  const orders = habits.map((habit, index) => ({ id: habit.id, sortOrder: (index + 1) * 1000 }))
  await habitRepo.respaceOrders(orders)
  return habits.map((habit, index) => ({
    ...habit,
    sortOrder: orders[index]?.sortOrder ?? habit.sortOrder,
  }))
}
