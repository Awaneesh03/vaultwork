import Dexie, { type Table } from 'dexie'
import type {
  AppEvent,
  FocusSession,
  Goal,
  Habit,
  HabitEntry,
  Id,
  MessageLog,
  Milestone,
  Note,
  NoteLink,
  Project,
  Settings,
  Subtask,
  Tag,
  Task,
  VaultDocument,
  VaultLink,
} from '@/types/entities'
import { applyMigrations, type MigrationDefinition } from './migrations'

export const DATABASE_NAME = 'vaultwork'

/**
 * The only class in the application that knows IndexedDB exists.
 *
 * Table properties use `declare` rather than `!`: with
 * `useDefineForClassFields` a real field would shadow Dexie's own accessor and
 * every table would be undefined at runtime.
 */
export class VaultworkDatabase extends Dexie {
  declare tasks: Table<Task, Id>
  declare subtasks: Table<Subtask, Id>
  declare projects: Table<Project, Id>
  declare goals: Table<Goal, Id>
  declare milestones: Table<Milestone, Id>
  declare habits: Table<Habit, Id>
  declare habitEntries: Table<HabitEntry, Id>
  declare focusSessions: Table<FocusSession, Id>
  declare notes: Table<Note, Id>
  declare noteLinks: Table<NoteLink, Id>
  declare tags: Table<Tag, Id>
  declare events: Table<AppEvent, Id>
  declare vaultLinks: Table<VaultLink, Id>
  declare vaultDocuments: Table<VaultDocument, Id>
  declare messageLog: Table<MessageLog, Id>
  declare settings: Table<Settings, Id>

  constructor(name: string = DATABASE_NAME, migrations?: MigrationDefinition[]) {
    super(name)
    applyMigrations(this, migrations)
    installEventImmutability(this)
  }
}

/**
 * The event log is append-only, and that is enforced here rather than by
 * convention. Analytics is only trustworthy if history cannot be rewritten, and
 * "we agreed not to update events" is not an enforcement mechanism.
 *
 * A hook that throws aborts the surrounding transaction, so a write that tries
 * to alter history takes nothing else with it.
 */
function blockEventUpdate(): never {
  throw new Error('The event log is append-only: events cannot be updated')
}

function blockEventDelete(): never {
  throw new Error('The event log is append-only: events cannot be deleted')
}

export function installEventImmutability(db: VaultworkDatabase): void {
  db.events.hook('updating', blockEventUpdate)
  db.events.hook('deleting', blockEventDelete)
}

/**
 * Restoring a backup and wiping the database legitimately replace history, so
 * the guard has to come off for those two operations — and only those two.
 * Keeping the unlock explicit (rather than never installing the guard) means
 * every place history can be rewritten is greppable in one search.
 */
export async function withEventLogUnlocked<T>(
  db: VaultworkDatabase,
  fn: () => Promise<T>,
): Promise<T> {
  db.events.hook('updating').unsubscribe(blockEventUpdate)
  db.events.hook('deleting').unsubscribe(blockEventDelete)
  try {
    return await fn()
  } finally {
    installEventImmutability(db)
  }
}

/** Store names in dependency-free order, used by export and import. */
export const STORE_NAMES = [
  'tasks',
  'subtasks',
  'projects',
  'goals',
  'milestones',
  'habits',
  'habitEntries',
  'focusSessions',
  'notes',
  'noteLinks',
  'tags',
  'events',
  'vaultLinks',
  'vaultDocuments',
  'messageLog',
  'settings',
] as const
