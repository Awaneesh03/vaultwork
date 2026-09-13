import type { ProjectPatch } from '@/services'
import type { Project } from '@/types/entities'
import type { ProjectStatus } from '@/types/enums'
import { DEFAULT_PROJECT_COLOR, DEFAULT_PROJECT_ICON } from './projectAppearance'

/**
 * The project composer's own shape.
 *
 * Every field is a string, because that is what a form input holds: an empty
 * deadline is `""`, not `undefined`, which is what lets the native date input
 * stay controlled. `toProjectPatch` is the single place those strings become
 * the model's nullable types — the same split `composerValue.ts` makes for
 * tasks.
 */
export interface ProjectFormValue {
  name: string
  description: string
  color: string
  icon: string
  status: ProjectStatus
  deadline: string
}

export function emptyProjectForm(): ProjectFormValue {
  return {
    name: '',
    description: '',
    color: DEFAULT_PROJECT_COLOR,
    icon: DEFAULT_PROJECT_ICON,
    status: 'active',
    deadline: '',
  }
}

/** Loads an existing project into the form. Editing starts from the truth. */
export function projectForm(project: Project): ProjectFormValue {
  return {
    name: project.name,
    description: project.description ?? '',
    color: project.color,
    icon: project.icon,
    // An archived project edited in place keeps its archived status: the
    // composer must not be a back door out of the archive, which has its own
    // action and its own event.
    status: project.status,
    deadline: project.deadline ?? '',
  }
}

/** Whitespace-only is empty. The service enforces this too; this is the hint. */
export function projectFormError(value: ProjectFormValue): string | null {
  return value.name.trim().length === 0 ? 'A project needs a name' : null
}

/**
 * Only the fields that actually differ.
 *
 * The service already ignores a no-op patch, but sending one field instead of
 * six also keeps the `project.updated` event's `fields` payload truthful —
 * "you changed the name" rather than "you changed everything".
 */
export function toProjectPatch(value: ProjectFormValue, current: Project): ProjectPatch {
  const patch: ProjectPatch = {}

  const name = value.name.trim().replace(/\s+/g, ' ')
  if (name !== current.name) patch.name = name

  const description = value.description.trim().length > 0 ? value.description.trim() : null
  if (description !== current.description) patch.description = description

  if (value.color !== current.color) patch.color = value.color
  if (value.icon !== current.icon) patch.icon = value.icon
  if (value.status !== current.status) patch.status = value.status

  const deadline = value.deadline.length > 0 ? value.deadline : null
  if (deadline !== current.deadline) patch.deadline = deadline

  return patch
}
