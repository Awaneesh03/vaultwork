import { Badge } from '@/components/ui/Badge'
import type { SyncStatus } from '@/services'
import {
  SYNC_STATUS_DESCRIPTIONS,
  SYNC_STATUS_ICONS,
  SYNC_STATUS_LABELS,
  SYNC_STATUS_TONES,
} from '../obsidianAppearance'

/**
 * What a note's file is doing.
 *
 * Every state is a word plus an icon plus a colour, in that order of
 * importance. Conflict in particular must never be communicated by red alone —
 * it is the one state that asks the user to make a decision, and they cannot
 * make it if they cannot tell it apart from "changed".
 */

export function SyncStatusBadge({ status, className }: { status: SyncStatus; className?: string }) {
  const Icon = SYNC_STATUS_ICONS[status]
  return (
    <Badge
      tone={SYNC_STATUS_TONES[status]}
      icon={<Icon size={10} />}
      title={SYNC_STATUS_DESCRIPTIONS[status]}
      className={className}
    >
      {SYNC_STATUS_LABELS[status]}
    </Badge>
  )
}
