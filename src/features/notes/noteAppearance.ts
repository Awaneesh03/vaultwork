import {
  CircleAlert,
  FolderKanban,
  ListChecks,
  Repeat,
  Target,
  type LucideIcon,
} from 'lucide-react'
import type { RefType } from '@/types/enums'

/**
 * How each kind of linked entity is drawn.
 *
 * Its own module rather than a constant beside a component, so the picker, the
 * note detail and the backlink panels all use one mapping — and so the
 * component files export components only.
 */
export const LINK_ICONS: Record<RefType, LucideIcon> = {
  task: ListChecks,
  project: FolderKanban,
  goal: Target,
  habit: Repeat,
  none: CircleAlert,
}

export const LINK_KIND_LABELS: Record<RefType, string> = {
  task: 'Task',
  project: 'Project',
  goal: 'Goal',
  habit: 'Habit',
  none: 'Unlinked',
}
