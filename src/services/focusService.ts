import { platform } from '@/platform'
import { focusSessionRepo, settingsRepo } from '@/repositories'
import type { FocusSession, Id, Timestamp } from '@/types/entities'
import type { EventSource, FocusKind } from '@/types/enums'
import { eventBus } from './eventBus'

/**
 * A Pomodoro session, stored as timestamps rather than ticks.
 *
 * That is the whole design, and it is what makes the timer survive things a
 * counting timer cannot. The session records *when it began* and *how long it
 * was meant to last*; the remaining time is arithmetic done at render. So a
 * reload mid-session leaves the countdown correct, a backgrounded window does
 * not drift, and a machine that slept for an hour comes back with an honest
 * answer instead of an hour of imaginary focus.
 *
 * A session is "running" when it has no `endedAt`. There is deliberately no
 * `running` outcome: an outcome describes how a session *finished*, and a
 * session that has not finished does not have one yet.
 */

/** One running session at a time. Two clocks would both be wrong. */
export class FocusAlreadyRunningError extends Error {
  readonly session: FocusSession

  constructor(session: FocusSession) {
    super('A focus session is already running.')
    this.name = 'FocusAlreadyRunningError'
    this.session = session
  }
}

export interface StartFocusInput {
  kind?: FocusKind
  /** Minutes. Defaults to the user's Pomodoro settings for this kind. */
  plannedMin?: number
  taskId?: Id | null
  projectId?: Id | null
}

export interface FocusWriteOptions {
  source?: EventSource
}

/** Whole minutes elapsed, never negative and never fractional. */
export function elapsedMinutes(startedAt: Timestamp, endedAt: Timestamp): number {
  return Math.max(0, Math.round((endedAt - startedAt) / 60_000))
}

/**
 * How long this kind of session should run, from the user's own settings.
 *
 * Read rather than hardcoded so the durations in Settings are the durations the
 * timer uses — there is one definition of "a work session is 25 minutes".
 */
export async function plannedMinutesFor(kind: FocusKind): Promise<number> {
  const settings = await settingsRepo.get()
  const pomodoro = settings.pomodoro
  if (kind === 'short_break') return pomodoro.shortBreakMin
  if (kind === 'long_break') return pomodoro.longBreakMin
  return pomodoro.workMin
}

/** The session in progress, if there is one. */
export async function getActiveFocus(): Promise<FocusSession | null> {
  const sessions = await focusSessionRepo.list()
  return sessions.find((session) => session.endedAt === null) ?? null
}

/** Finished sessions, newest first. */
export async function listFocusHistory(limit = 20): Promise<FocusSession[]> {
  const sessions = await focusSessionRepo.list()
  return sessions
    .filter((session) => session.endedAt !== null)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, limit)
}

/**
 * Begins a session.
 *
 * Refuses when one is already running, and hands back the session that is,
 * rather than starting a second. A double-click, a second window and a stale
 * button all arrive here, and "start" has to mean the same thing for all three.
 */
export async function startFocus(
  input: StartFocusInput = {},
  options: FocusWriteOptions = {},
): Promise<FocusSession> {
  const running = await getActiveFocus()
  if (running !== null) throw new FocusAlreadyRunningError(running)

  const kind: FocusKind = input.kind ?? 'work'
  const plannedMin = input.plannedMin ?? (await plannedMinutesFor(kind))
  const source = options.source ?? 'ui'

  const session = await focusSessionRepo.create(
    {
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      kind,
      startedAt: platform.clock.now(),
      endedAt: null,
      plannedMin,
      actualMin: 0,
      // A session that has not ended has not been aborted either; this is the
      // resting value until `endedAt` decides.
      outcome: 'completed',
    },
    // The repository writes its own `focusSession.created` event. It carries
    // the same source as the domain event, so a session started from Telegram
    // does not leave a row in the log claiming someone clicked a button.
    { source },
  )

  await eventBus.emit({
    type: 'focus.started',
    entityType: 'focusSession',
    entityId: session.id,
    source,
    payload: { kind, plannedMin },
  })

  return session
}

/** Shared ending, so completing and abandoning cannot drift apart. */
async function endFocus(
  id: Id,
  outcome: 'completed' | 'aborted',
  eventType: string,
  source: EventSource,
): Promise<FocusSession> {
  const session = await focusSessionRepo.getOrThrow(id)
  // Ending a finished session is a no-op rather than an error: the timer and a
  // click can both arrive at the finish line, and only one may write.
  if (session.endedAt !== null) return session

  const endedAt = platform.clock.now()
  const ended = await focusSessionRepo.update(
    id,
    {
      endedAt,
      actualMin: elapsedMinutes(session.startedAt, endedAt),
      outcome,
    },
    { source },
  )

  await eventBus.emit({
    type: eventType,
    entityType: 'focusSession',
    entityId: id,
    source,
    payload: { kind: ended.kind, actualMin: ended.actualMin, plannedMin: ended.plannedMin },
  })

  return ended
}

/** Ends a session that ran its course. */
export function completeFocus(id: Id, options: FocusWriteOptions = {}): Promise<FocusSession> {
  return endFocus(id, 'completed', 'focus.completed', options.source ?? 'ui')
}

/**
 * Ends a session early.
 *
 * The time already spent is still recorded. Abandoning a session at minute
 * twenty should not erase twenty minutes of work from the history.
 */
export function cancelFocus(id: Id, options: FocusWriteOptions = {}): Promise<FocusSession> {
  return endFocus(id, 'aborted', 'focus.cancelled', options.source ?? 'ui')
}

/** When this session is due to finish. */
export const focusEndsAt = (session: FocusSession): Timestamp =>
  session.startedAt + session.plannedMin * 60_000

/** Milliseconds left, floored at zero. Derived, never stored. */
export function remainingMs(session: FocusSession, now: Timestamp): number {
  return Math.max(0, focusEndsAt(session) - now)
}

export const isFocusExpired = (session: FocusSession, now: Timestamp): boolean =>
  session.endedAt === null && remainingMs(session, now) === 0
