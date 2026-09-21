/**
 * Every enum is a string union backed by a frozen array of its members.
 *
 * The array is what makes runtime validation possible (JSON import, and later
 * a Telegram message or a model response), and the union is derived from it so
 * the two can never drift apart.
 */

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const TASK_STATUSES = ['todo', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const GOAL_HORIZONS = ['short', 'long'] as const
export type GoalHorizon = (typeof GOAL_HORIZONS)[number]

export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'dropped'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

export const HABIT_CADENCES = ['daily', 'weekly'] as const
export type HabitCadence = (typeof HABIT_CADENCES)[number]

export const HABIT_KINDS = ['binary', 'quantity'] as const
export type HabitKind = (typeof HABIT_KINDS)[number]

export const FOCUS_KINDS = ['work', 'short_break', 'long_break'] as const
export type FocusKind = (typeof FOCUS_KINDS)[number]

export const FOCUS_OUTCOMES = ['completed', 'aborted'] as const
export type FocusOutcome = (typeof FOCUS_OUTCOMES)[number]

/** What a Note (or a VaultLink) can be attached to. */
export const REF_TYPES = ['task', 'project', 'goal', 'habit', 'none'] as const
export type RefType = (typeof REF_TYPES)[number]

/**
 * What kind of durable knowledge a note is (M18.2).
 *
 * A note with no kind is an ordinary note, and most notes are. A kind marks an
 * *explicit* knowledge artifact — something the user chose to keep as a brief,
 * a decision or a review — which is what makes it worth giving a structure and
 * a provenance. Vaultwork never manufactures one per task.
 */
export const KNOWLEDGE_KINDS = [
  'brief',
  'decision',
  'meeting',
  'research',
  'learning',
  'review',
  'synthesis',
] as const
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

/**
 * Where a knowledge artifact's information came from.
 *
 * Not who saved it — every note is saved by the user — but what the content is
 * *of*: something Vaultwork already knew, something the user wrote, something
 * read from an email or a web page, something Claude or NotebookLM produced.
 * Answering "where did this come from?" is the whole job.
 */
export const PROVENANCE_SOURCES = [
  'user',
  'vaultwork',
  'email',
  'calendar',
  'web',
  'claude',
  'notebooklm',
  /** M18.3: captured in the Universal Inbox; `sourceId` is the capture's id. */
  'inbox',
] as const
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number]

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number]

/**
 * Where a change came from. This lives on the Event, never on the entity —
 * a task is a task regardless of how it was captured.
 */
/**
 * Who asked for a mutation.
 *
 * `telegram` joins the list in M14. M1 had reserved the generic `message` for
 * an inbound channel, but a personal event log is more useful when it says
 * which channel: "this task came from Telegram" is an answer, "this task came
 * from a message" is a follow-up question. `message` stays for any future
 * channel that is not Telegram. Widening a string union changes no stored row,
 * so this costs no migration.
 */
export const EVENT_SOURCES = [
  'ui',
  'quickadd',
  'palette',
  'message',
  'telegram',
  'ai',
  'obsidian',
  /** M18.3: resolved from a Universal Inbox capture. */
  'inbox',
] as const
export type EventSource = (typeof EVENT_SOURCES)[number]

export const SYNC_DIRECTIONS = ['push', 'pull', 'both'] as const
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number]

/**
 * Where an inbound message came from.
 *
 * `inbox` (M18.3) is a capture typed into Vaultwork itself. It shares the table
 * with Telegram because it is the same thing — raw text awaiting a decision —
 * and the unique `[source+externalId]` index keeps the two apart.
 */
export const MESSAGE_SOURCES = ['telegram', 'inbox'] as const
export type MessageSource = (typeof MESSAGE_SOURCES)[number]

export const MESSAGE_STATUSES = ['pending', 'done', 'failed'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = (typeof DENSITIES)[number]

/** Type guard factory: `isMember(PRIORITIES)('high')` narrows to Priority. */
export function isMember<T extends readonly string[]>(
  members: T,
): (value: unknown) => value is T[number] {
  return (value): value is T[number] =>
    typeof value === 'string' && (members as readonly string[]).includes(value)
}

/**
 * What a Universal Inbox capture can become (M18.3).
 *
 * Every one maps to an existing creation command; an "event" is a task with a
 * date and a time, which is what the Calendar already shows. There is no type
 * here for anything the application cannot already create.
 */
export const INBOX_TYPES = [
  'task',
  'event',
  'note',
  'knowledge',
  'project',
  'goal',
  'habit',
] as const
export type InboxType = (typeof INBOX_TYPES)[number]
