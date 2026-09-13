import {
  AlertCircle,
  AlertTriangle,
  Check,
  CloudOff,
  Copy,
  EyeOff,
  FilePlus,
  FileQuestion,
  FolderTree,
  PencilLine,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeTone } from '@/components/ui/Badge'
import type { ConnectionState, SyncStatus } from '@/services'

/**
 * How vault state is put into words, icons and colour — in that order.
 *
 * Presentation lives here rather than in the domain for the reason the goal
 * labels do: a component may hold a *type* from the service layer but not a
 * value, and a label is a UI concern anyway. The domain owns whether two
 * documents conflict; this module owns what that is called on screen.
 *
 * Every state has a word. Conflict in particular must never be red and nothing
 * else — it is the one state that asks the user to decide, and they cannot
 * decide if they cannot tell it from "changed".
 */

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  clean: 'Synced',
  'local-change': 'Local changes',
  'external-change': 'Changed in Obsidian',
  conflict: 'Conflict',
  'not-exported': 'Not exported',
  missing: 'File missing',
  untracked: 'New in vault',
  moved: 'Moved in vault',
  'moved-change': 'Moved and changed',
  'duplicate-id': 'Duplicate id',
  'path-collision': 'Path collision',
  'deleted-local': 'Deleted here',
  ignored: 'Ignored',
  error: 'Error',
}

export const SYNC_STATUS_DESCRIPTIONS: Record<SyncStatus, string> = {
  clean: 'This note and its vault file match.',
  'local-change': 'This note has changed since it was last exported.',
  'external-change': 'The vault file has changed since it was last synced.',
  conflict:
    'Both this note and its vault file changed. Vaultwork will not choose for you — export to keep this version, or import to keep the vault version.',
  'not-exported': 'This note has never been written to the vault.',
  missing: 'The vault file was exported before but is no longer there.',
  untracked: 'This vault file has no note behind it yet.',
  moved: 'The file moved in the vault. Its content is unchanged.',
  'moved-change':
    'The file moved in the vault and its content changed. Accepting the move and importing the change are two separate decisions.',
  'duplicate-id':
    'Two vault files claim the same note. Vaultwork cannot tell which one is the note, so it will not touch either.',
  'path-collision':
    'Another note already owns this vault path. Rename one of them before exporting.',
  'deleted-local':
    'This note was deleted in Vaultwork, but its vault file is still there. Deleting a note is not the same as deleting your file.',
  ignored: 'Skipped by the ignore rules.',
  error: 'This file could not be read or understood. Nothing was changed.',
}

/**
 * Which badge tone each state wears.
 *
 * Named tones rather than raw classes, so every state mark in the application
 * is drawn by one component. `confirm` — the mint accent — is reserved for the
 * states that mean *settled*: synced, and connected. Everything that needs a
 * decision is a warning or a danger, and everything else stays neutral, because
 * a list where every row is coloured is a list with no signal in it.
 */
export const SYNC_STATUS_TONES: Record<SyncStatus, BadgeTone> = {
  clean: 'confirm',
  'local-change': 'neutral',
  'external-change': 'warn',
  conflict: 'danger',
  'not-exported': 'neutral',
  missing: 'danger',
  untracked: 'info',
  moved: 'neutral',
  'moved-change': 'warn',
  'duplicate-id': 'danger',
  'path-collision': 'danger',
  'deleted-local': 'warn',
  ignored: 'neutral',
  error: 'danger',
}

export const SYNC_STATUS_ICONS: Record<SyncStatus, LucideIcon> = {
  clean: Check,
  'local-change': PencilLine,
  'external-change': PencilLine,
  conflict: AlertTriangle,
  'not-exported': CloudOff,
  missing: FileQuestion,
  untracked: FilePlus,
  moved: FolderTree,
  'moved-change': FolderTree,
  'duplicate-id': Copy,
  'path-collision': AlertTriangle,
  'deleted-local': Trash2,
  ignored: EyeOff,
  error: AlertCircle,
}

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  'permission-required': 'Permission required',
  'permission-denied': 'Permission denied',
  'not-connected': 'Not connected',
  unsupported: 'Not supported',
}

export const CONNECTION_TONES: Record<ConnectionState, BadgeTone> = {
  connected: 'confirm',
  'permission-required': 'warn',
  'permission-denied': 'danger',
  'not-connected': 'neutral',
  unsupported: 'neutral',
}
