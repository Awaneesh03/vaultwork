import type { DateStr, Id, TimeStr } from '@/types/entities'
import type { Priority } from '@/types/enums'

/**
 * The composer's own shape.
 *
 * Every field is a string, because that is what a form input holds. A
 * half-typed number is `"4"`, not `NaN`, and an empty date is `""`, not
 * `undefined` — which is what lets the native inputs stay controlled.
 * `toTaskFields` is the single place those strings become the model's types.
 */
export interface ComposerValue {
  title: string
  description: string
  dueDate: string
  dueTime: string
  priority: Priority
  projectId: Id | null
  tagIds: Id[]
  estimate: string
  /** Create mode only; edit mode uses the real subtask rows. */
  draftSubtasks: string[]
}

export function emptyComposerValue(): ComposerValue {
  return {
    title: '',
    description: '',
    dueDate: '',
    dueTime: '',
    priority: 'none',
    projectId: null,
    tagIds: [],
    estimate: '',
    draftSubtasks: [],
  }
}

export interface TaskFieldValues {
  title: string
  description: string | null
  dueDate: DateStr | null
  dueTime: TimeStr | null
  priority: Priority
  projectId: Id | null
  tagIds: Id[]
  estimateMin: number | null
}

/** Turns the form's strings back into the model's nullable fields. */
export function toTaskFields(value: ComposerValue): TaskFieldValues {
  const estimate = Number.parseInt(value.estimate, 10)
  return {
    title: value.title.trim(),
    description: value.description.trim().length > 0 ? value.description.trim() : null,
    dueDate: value.dueDate.length > 0 ? value.dueDate : null,
    // A time with no date has nothing to attach to.
    dueTime: value.dueDate.length > 0 && value.dueTime.length > 0 ? value.dueTime : null,
    priority: value.priority,
    projectId: value.projectId,
    tagIds: value.tagIds,
    estimateMin: Number.isFinite(estimate) && estimate > 0 ? estimate : null,
  }
}
