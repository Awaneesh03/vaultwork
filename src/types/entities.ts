import type {
  Density,
  EventSource,
  FocusKind,
  FocusOutcome,
  GoalHorizon,
  GoalStatus,
  HabitCadence,
  HabitKind,
  KnowledgeKind,
  MessageSource,
  MessageStatus,
  Priority,
  ProjectStatus,
  ProvenanceSource,
  RecurrenceFreq,
  RefType,
  SyncDirection,
  TaskStatus,
  ThemePreference,
} from './enums'

/** A UUID from crypto.randomUUID(). */
export type Id = string

/** Epoch milliseconds. Used for *instants*: createdAt, a session start. */
export type Timestamp = number

/** A local calendar day, "YYYY-MM-DD". Used for *dates*: a due date, a habit day. */
export type DateStr = string

/** A local wall-clock time, "HH:mm". */
export type TimeStr = string

/**
 * Fields every stored row carries.
 *
 * Optional values are `T | null` rather than `T | undefined`: a row always has
 * the key, clearing a field is an explicit `null`, and there is no ambiguity
 * between "absent" and "not set" when a record round-trips through JSON.
 */
export interface BaseRecord {
  id: Id
  createdAt: Timestamp
  updatedAt: Timestamp
  /** Soft delete. `null` while live; a timestamp once deleted. */
  deletedAt: Timestamp | null
}

export interface RecurrenceRule {
  freq: RecurrenceFreq
  /** Every N units. */
  interval: number
  /** 0 = Sunday. Used by weekly rules. */
  byWeekday: number[] | null
  byMonthDay: number[] | null
  /**
   * Whether the next occurrence counts from the due date or from the moment the
   * previous one was actually completed. "Water the plants every 3 days" is the
   * first; "clean the desk every 3 days" is the second.
   */
  anchor: 'dueDate' | 'completionDate'
  endsOn: DateStr | null
  endsAfter: number | null
}

export interface Task extends BaseRecord {
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  dueDate: DateStr | null
  dueTime: TimeStr | null
  startDate: DateStr | null
  estimateMin: number | null
  projectId: Id | null
  milestoneId: Id | null
  tagIds: Id[]
  recurrence: RecurrenceRule | null
  /** Points at the template task of a recurring series. */
  seriesId: Id | null
  /** True for the invisible template that owns the recurrence rule. */
  isTemplate: boolean
  sortOrder: number
  completedAt: Timestamp | null
  reminderAt: Timestamp | null
  /** Vault-relative path once exported to Obsidian. */
  vaultPath: string | null
}

export interface Subtask extends BaseRecord {
  taskId: Id
  title: string
  done: boolean
  sortOrder: number
}

export interface Project extends BaseRecord {
  name: string
  description: string | null
  color: string
  icon: string
  status: ProjectStatus
  deadline: DateStr | null
  goalId: Id | null
  tagIds: Id[]
  sortOrder: number
  vaultPath: string | null
}

export interface Goal extends BaseRecord {
  title: string
  why: string | null
  horizon: GoalHorizon
  status: GoalStatus
  targetDate: DateStr | null
  sortOrder: number
  vaultPath: string | null
}

export interface Milestone extends BaseRecord {
  goalId: Id
  title: string
  targetDate: DateStr | null
  done: boolean
  sortOrder: number
}

export interface Habit extends BaseRecord {
  name: string
  color: string
  cadence: HabitCadence
  /** Which days count, 0 = Sunday. Empty means every day. */
  daysOfWeek: number[]
  targetPerWeek: number | null
  kind: HabitKind
  unit: string | null
  target: number | null
  sortOrder: number
  archivedAt: Timestamp | null
}

export interface HabitEntry extends BaseRecord {
  habitId: Id
  date: DateStr
  value: number
  note: string | null
}

export interface FocusSession extends BaseRecord {
  taskId: Id | null
  projectId: Id | null
  kind: FocusKind
  startedAt: Timestamp
  endedAt: Timestamp | null
  plannedMin: number
  actualMin: number
  outcome: FocusOutcome
}

export interface Note extends BaseRecord {
  title: string
  body: string
  tagIds: Id[]
  /**
   * Where this note will live in an Obsidian vault.
   *
   * Reserved at creation even though M9 writes no files, so that gaining sync
   * later is a feature rather than a migration. Never null for a note created
   * by M9 onwards; nullable only because M1 rows predate the guarantee.
   */
  vaultPath: string | null
  /**
   * M18.2: the kind of knowledge artifact this is, or `null` for an ordinary
   * note. Not indexed — nothing queries by it, so it costs no schema change.
   */
  kind: KnowledgeKind | null
  /** M18.2: where the information came from. `null` when nobody recorded it. */
  provenance: Provenance | null
}

/**
 * Where a knowledge artifact's information came from (M18.2).
 *
 * Minimal on purpose. It names the source and, where one exists, the thing
 * within it — never the credential used to reach it. A URL is kept only after
 * `sanitizeProvenance` has refused userinfo and stripped secret-shaped query
 * parameters, because provenance is written into a Markdown file anyone with
 * the vault can read.
 */
export interface Provenance {
  source: ProvenanceSource
  /** The entity or message within the source, e.g. a project id. */
  sourceId: string | null
  sourceUrl: string | null
  /** When the information was captured from its source. */
  capturedAt: Timestamp | null
}

/**
 * One note referencing one entity.
 *
 * A join table rather than arrays on the note: it keeps a single description of
 * the relationship, indexes it from both directions (`noteId` for a note's
 * links, `[refType+refId]` for an entity's backlinks), and costs nothing when a
 * fifth kind of thing becomes linkable.
 */
export interface NoteLink extends BaseRecord {
  noteId: Id
  refType: RefType
  refId: Id
}

export interface Tag extends BaseRecord {
  name: string
  color: string | null
}

/**
 * Append-only. Never updated, never deleted — enforced by a Dexie hook in
 * db/schema.ts, not by convention.
 */
export interface AppEvent {
  id: Id
  type: string
  at: Timestamp
  entityType: string
  entityId: Id | null
  source: EventSource
  payload: Record<string, unknown> | null
}

/**
 * What can map to a file in a vault.
 *
 * Deliberately not `RefType`. That union answers "what can a note be *about*"
 * and so contains `none` but not `note`; this one answers "what can become a
 * file", which is the opposite on both counts. Sharing them would let a vault
 * link point at nothing, and would leak `note` into `noteLinks`, where a
 * note-to-note relationship is a schema decision for a later milestone.
 */
export type VaultEntityType = 'note' | 'task' | 'project' | 'goal' | 'habit' | 'document'

/**
 * A PDF in the vault, as Vaultwork can read it.
 *
 * Deliberately *not* a Note. A Note is authored content — Vaultwork owns its
 * body, writes it back to the vault, resolves its wikilinks and lets the user
 * edit it. None of that is true of a PDF: the file is the source, Vaultwork
 * only ever reads it, and the text below is a derived index rather than the
 * document. Folding the two together would mean either giving Notes a
 * "read-only, don't export, can't edit" mode that every note-handling path has
 * to remember, or letting the assistant offer to rewrite a PDF it cannot write.
 *
 * What *is* shared is the machinery around it: the same scan, the same
 * plan → review → apply pipeline, the same `vaultLinks` baselines, and the same
 * conflict policy. This is a second document kind, not a second integration.
 */
export interface VaultDocument extends BaseRecord {
  /** Display name, from the file name. There is no title inside a PDF to trust. */
  title: string
  /** Vault-relative path, forward slashes, exactly as the scan found it. */
  vaultPath: string
  /** The only document kind today; named so a second one is additive. */
  kind: 'pdf'
  /** Extracted text, bounded by the adapter. Empty for a scan with no text layer. */
  text: string
  /**
   * Why there is no text, when there is none.
   *
   * `null` when extraction produced something. A scanned page is the ordinary
   * case and says so, because "empty" and "we did not try" must not look alike.
   */
  extraction: 'ok' | 'empty' | 'truncated'
  /** Characters stored, so the UI can say how much was indexed. */
  chars: number
  /** File size on disk when it was imported. Part of change detection. */
  bytes: number
  /** Hash of the extracted text, in the same scheme notes use. */
  hash: string
  /** When Vaultwork last read the file. */
  importedAt: Timestamp
}

export interface VaultLink extends BaseRecord {
  entityType: VaultEntityType
  entityId: Id
  path: string
  lastHashApp: string | null
  lastHashFile: string | null
  syncedAt: Timestamp | null
  direction: SyncDirection
}

/**
 * One row per inbound message. The unique [source+externalId] index is what
 * makes message handling idempotent: a redelivered Telegram update is rejected
 * by the database rather than by remembering to check for it.
 */
export interface MessageLog extends BaseRecord {
  source: MessageSource
  externalId: string
  receivedAt: Timestamp
  text: string
  status: MessageStatus
  resultEntityType: string | null
  resultEntityId: Id | null
  error: string | null
}

export interface PomodoroSettings {
  workMin: number
  shortBreakMin: number
  longBreakMin: number
  cyclesBeforeLongBreak: number
}

export interface VaultConfig {
  /** Folder inside the vault the app is allowed to write to. */
  rootFolder: string
  /** Opt-in per task; a vault of 4,000 one-line files is worse than none. */
  autoExportTasks: boolean
}

export interface Settings extends BaseRecord {
  /** Always the literal "singleton". */
  id: Id
  theme: ThemePreference
  density: Density
  pomodoro: PomodoroSettings
  dailyTaskGoal: number
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1
  vault: VaultConfig | null
  schemaVersion: number
}

/** Every persisted entity, keyed by its store name. */
export interface EntityMap {
  tasks: Task
  subtasks: Subtask
  projects: Project
  goals: Goal
  milestones: Milestone
  habits: Habit
  habitEntries: HabitEntry
  focusSessions: FocusSession
  notes: Note
  noteLinks: NoteLink
  tags: Tag
  events: AppEvent
  vaultLinks: VaultLink
  vaultDocuments: VaultDocument
  messageLog: MessageLog
  settings: Settings
}

export type StoreName = keyof EntityMap
