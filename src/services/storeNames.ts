/**
 * The store list, duplicated here on purpose.
 *
 * Services are not allowed to import from db/, and a backup's shape is part of
 * the *file format* rather than of the schema — an importer must be able to
 * reject a file that is missing a store even after the schema has moved on. The
 * architecture test asserts the two lists agree, so drift is caught by CI
 * rather than by a failed restore.
 */
export const STORE_NAMES_FOR_BACKUP = [
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

export type BackupStoreName = (typeof STORE_NAMES_FOR_BACKUP)[number]
