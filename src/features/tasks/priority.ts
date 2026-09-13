import type { Priority } from '@/types/enums'

/** Human wording for each level, used by the row, the composer and the toolbar. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/** The 1–4 keys, urgent first — the order they read in the composer. */
export const PRIORITY_KEYS: Record<Exclude<Priority, 'none'>, string> = {
  urgent: '1',
  high: '2',
  medium: '3',
  low: '4',
}
