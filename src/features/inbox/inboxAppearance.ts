import type { InboxType } from '@/types/enums'

/** What each kind of capture is called on screen. */
export const INBOX_TYPE_LABELS: Record<InboxType, string> = {
  task: 'Task',
  event: 'Event',
  note: 'Note',
  knowledge: 'Knowledge',
  project: 'Project',
  goal: 'Goal',
  habit: 'Habit',
}

/** The Assistant's own words for an open question, reused so the two agree. */
export const QUESTION_LABELS = {
  detail: 'Needs a detail',
  choice: 'Needs a choice',
} as const
