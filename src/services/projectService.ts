import { orderAfterLast, orderForMove } from '@/lib/sortOrder'
import { platform } from '@/platform'
import { eventRepo, projectRepo, taskRepo } from '@/repositories'
import type { DateStr, Id, Project, Task } from '@/types/entities'
import { PROJECT_STATUSES, isMember, type EventSource, type ProjectStatus } from '@/types/enums'
import { eventBus } from './eventBus'

/**
 * Everything that writes a project.
 *
 * The same two rules the task service is built around hold here:
 *
 *  1. **One mutation, one event.** The base repository emits
 *     `project.created`, `project.updated`, `project.deleted` and
 *     `project.restored` inside the same transaction as the write. Where a
 *     domain event is more accurate — archiving, unarchiving, reordering — the
 *     generic event is suppressed with `emit: false` and the specific one is
 *     emitted instead. Archiving a project therefore records exactly
 *     `project.archived`, never a `project.updated` alongside it.
 *
 *  2. **Source lives on the event, never on the project.** A project created
 *     from the composer and one created by `/add project College` are the same
 *     row; only their history differs.
 *
 * And one rule of its own:
 *
 *  3. **Neither archiving nor deleting touches a single task.** A project is a
 *     label on work, not a container that owns it. `deleteProject` stamps
 *     `deletedAt` on one row and leaves every `task.projectId` pointing at it,
 *     which is what makes restore exactly reversible — the same decision the
 *     tag service makes for the same reason. Tasks whose project is gone are
 *     still reachable in All Tasks, and a project's task count is reported
 *     before it is deleted so the UI can say what it is about to orphan.
 */

export interface ProjectWriteOptions {
  source?: EventSource
}

export interface ProjectInput {
  name: string
  description?: string | null | undefined
  color?: string | undefined
  icon?: string | undefined
  status?: ProjectStatus | undefined
  deadline?: DateStr | null | undefined
  sortOrder?: number | undefined
}

export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'description' | 'color' | 'icon' | 'status' | 'deadline' | 'tagIds'>
>

export const DEFAULT_PROJECT_COLOR = 'teal'
export const DEFAULT_PROJECT_ICON = 'folder'

/** The status a project returns to when nothing better is known. */
export const DEFAULT_RESTORED_STATUS: ProjectStatus = 'active'

export class EmptyProjectNameError extends Error {
  constructor() {
    super('A project needs a name')
    this.name = 'EmptyProjectNameError'
  }
}

export class ProjectNameTakenError extends Error {
  readonly existing: Project

  constructor(existing: Project) {
    super(
      existing.status === 'archived'
        ? `“${existing.name}” already exists in the archive. Restore it instead.`
        : `A project called “${existing.name}” already exists`,
    )
    this.name = 'ProjectNameTakenError'
    this.existing = existing
  }
}

const clean = (name: string) => name.trim().replace(/\s+/g, ' ')

/**
 * Rejects a duplicate name, comparing case- and whitespace-insensitively.
 *
 * Deleted projects are ignored on purpose: a name should not be held hostage by
 * something the user has already thrown away. Archived ones are *not* ignored —
 * creating a second "College" while the first sits in the archive is how you
 * end up with two of them and no idea which is which.
 */
async function assertNameFree(name: string, exceptId?: Id): Promise<void> {
  const existing = await projectRepo.findByName(name)
  if (existing && existing.id !== exceptId) throw new ProjectNameTakenError(existing)
}

// --------------------------------------------------------------------- reads

/** Every live project, archived ones included, in manual order. */
export function listProjects(): Promise<Project[]> {
  return projectRepo.listLive()
}

export function listActiveProjects(): Promise<Project[]> {
  return projectRepo.listActive()
}

export function listArchivedProjects(): Promise<Project[]> {
  return projectRepo.listArchived()
}

export function listDeletedProjects(): Promise<Project[]> {
  return projectRepo.listDeleted()
}

export function getProject(id: Id): Promise<Project | undefined> {
  return projectRepo.get(id)
}

export function findProjectByName(name: string): Promise<Project | undefined> {
  return projectRepo.findByName(name)
}

// -------------------------------------------------------------------- create

/**
 * Creates a project.
 *
 * The signature keeps `name` positional because that is the only required
 * field, and everything else genuinely is optional — a project named and
 * nothing more is a valid, useful project.
 */
export async function createProject(
  name: string,
  options: Omit<ProjectInput, 'name'> = {},
  source: EventSource = 'ui',
): Promise<Project> {
  const title = clean(name)
  if (title.length === 0) throw new EmptyProjectNameError()
  await assertNameFree(title)

  const description = options.description ?? null

  return projectRepo.create(
    {
      name: title,
      description: description === null ? null : clean(description) || null,
      color: options.color ?? DEFAULT_PROJECT_COLOR,
      icon: options.icon ?? DEFAULT_PROJECT_ICON,
      status: options.status ?? 'active',
      deadline: options.deadline ?? null,
      goalId: null,
      tagIds: [],
      sortOrder: options.sortOrder ?? orderAfterLast(await projectRepo.lastOrder()),
      vaultPath: null,
    },
    { source },
  )
}

// -------------------------------------------------------------------- update

/**
 * Applies a patch and emits the one event that describes it. Editing never
 * creates a row: the id is fixed by the signature, so there is no code path
 * that could produce a second project from a save.
 *
 * A patch that changes nothing writes nothing — re-saving a form you did not
 * edit should not add a row to the log analytics is computed from.
 */
export async function updateProject(
  id: Id,
  patch: ProjectPatch,
  options: ProjectWriteOptions = {},
): Promise<Project> {
  const source: EventSource = options.source ?? 'ui'
  const current = await projectRepo.getOrThrow(id)

  const next: ProjectPatch = { ...patch }

  if (typeof next.name === 'string') {
    const name = clean(next.name)
    if (name.length === 0) throw new EmptyProjectNameError()
    if (name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(name, id)
    next.name = name
  }

  if (typeof next.description === 'string') {
    next.description = clean(next.description) || null
  }

  const changed = (Object.keys(next) as (keyof ProjectPatch)[]).filter((field) => {
    const before = current[field]
    const after = next[field]
    if (Array.isArray(before) && Array.isArray(after)) {
      return before.length !== after.length || before.some((value, i) => value !== after[i])
    }
    return before !== after
  })

  if (changed.length === 0) return current

  return projectRepo.update(id, next, { source })
}

export function setProjectStatus(
  id: Id,
  status: ProjectStatus,
  options: ProjectWriteOptions = {},
): Promise<Project> {
  return status === 'archived'
    ? archiveProject(id, options)
    : updateProject(id, { status }, options)
}

// ---------------------------------------------------------- archive/unarchive

/**
 * The status a project was in before it was archived, recovered from the log.
 *
 * `eventRepo.list` returns newest first, so the first match is the most recent
 * archival. A project archived before this ran, or whose log has been replaced
 * by a backup restore, falls back to `active` — a project that comes back as
 * active is a small annoyance; one that comes back unusable is a bug.
 */
async function statusBeforeArchive(id: Id): Promise<ProjectStatus> {
  const events = await eventRepo.list({ type: 'project.archived' })
  const from = events.find((event) => event.entityId === id)?.payload?.['from']
  if (isMember(PROJECT_STATUSES)(from) && from !== 'archived') return from
  return DEFAULT_RESTORED_STATUS
}

/**
 * Archives a project without touching its tasks.
 *
 * The previous status rides along on the event, which is what makes
 * `unarchiveProject` able to put the project back where it was rather than
 * flattening every archived project to "active" on the way out.
 */
export async function archiveProject(id: Id, options: ProjectWriteOptions = {}): Promise<Project> {
  const source: EventSource = options.source ?? 'ui'
  const current = await projectRepo.getOrThrow(id)
  if (current.status === 'archived') return current

  const counts = await projectRepo.taskCounts(id)
  const updated = await projectRepo.update(id, { status: 'archived' }, { source, emit: false })

  await eventBus.emit({
    type: 'project.archived',
    entityType: 'project',
    entityId: id,
    source,
    payload: { name: updated.name, from: current.status, taskCount: counts.total },
  })

  return updated
}

/** Brings an archived project back to the status it had before. */
export async function unarchiveProject(
  id: Id,
  options: ProjectWriteOptions = {},
): Promise<Project> {
  const source: EventSource = options.source ?? 'ui'
  const current = await projectRepo.getOrThrow(id)
  if (current.status !== 'archived') return current

  const status = await statusBeforeArchive(id)
  const updated = await projectRepo.update(id, { status }, { source, emit: false })

  await eventBus.emit({
    type: 'project.restored',
    entityType: 'project',
    entityId: id,
    source,
    payload: { name: updated.name, from: 'archived', to: status },
  })

  return updated
}

// ------------------------------------------------------------ delete/restore

export interface ProjectDeletion {
  project: Project
  /** Live tasks left pointing at the deleted project. None of them moved. */
  orphanedTaskCount: number
}

/**
 * Soft delete. The row stays, `deletedAt` is stamped, and **not one task is
 * touched** — the count of what is now unfiled comes back so the caller can say
 * so, and so an undo needs no bookkeeping to be exact.
 */
export async function deleteProject(
  id: Id,
  options: ProjectWriteOptions = {},
): Promise<ProjectDeletion> {
  const source: EventSource = options.source ?? 'ui'
  const project = await projectRepo.getOrThrow(id)
  const counts = await projectRepo.taskCounts(id)

  await projectRepo.softDelete(id, { source })

  return {
    project: { ...project, deletedAt: platform.clock.now() },
    orphanedTaskCount: counts.total,
  }
}

/** Undoes a soft delete. Every task that still names the project works again. */
export function restoreProject(id: Id, options: ProjectWriteOptions = {}): Promise<Project> {
  return projectRepo.restore(id, { source: options.source ?? 'ui' })
}

// ------------------------------------------------------------------ ordering

/**
 * Moves a project within an ordered list of ids.
 *
 * One row is written: the moved project's `sortOrder` becomes the midpoint of
 * its new neighbours. The list is only respaced when midpoints have run out of
 * precision — the same single-write strategy tasks use, for the same reasons.
 */
export async function moveProject(
  orderedIds: Id[],
  fromIndex: number,
  toIndex: number,
  options: ProjectWriteOptions = {},
): Promise<Project | undefined> {
  const id = orderedIds[fromIndex]
  if (!id || fromIndex === toIndex) return undefined

  const source: EventSource = options.source ?? 'ui'
  const rows = await Promise.all(orderedIds.map((projectId) => projectRepo.get(projectId)))
  const present = rows.filter((row): row is Project => row !== undefined)
  if (present.length !== orderedIds.length) {
    // The list moved under us; a respace is the honest recovery.
    await respaceProjects(present)
  }

  const orders = present.map((project) => project.sortOrder)
  const sortOrder = orderForMove(orders, fromIndex, toIndex)

  if (!Number.isFinite(sortOrder) || hasCollision(orders, sortOrder, fromIndex)) {
    const respaced = await respaceProjects(present)
    const nextOrder = orderForMove(
      respaced.map((project) => project.sortOrder),
      fromIndex,
      toIndex,
    )
    return applyOrder(id, nextOrder, source)
  }

  return applyOrder(id, sortOrder, source)
}

function hasCollision(orders: number[], candidate: number, skipIndex: number): boolean {
  return orders.some((order, index) => index !== skipIndex && order === candidate)
}

async function applyOrder(id: Id, sortOrder: number, source: EventSource): Promise<Project> {
  const updated = await projectRepo.update(id, { sortOrder }, { source, emit: false })
  await eventBus.emit({
    type: 'project.reordered',
    entityType: 'project',
    entityId: id,
    source,
    payload: { sortOrder },
  })
  return updated
}

/** Respaces a list to 1,000-apart orders without emitting an event per row. */
async function respaceProjects(projects: Project[]): Promise<Project[]> {
  const orders = projects.map((project, index) => ({
    id: project.id,
    sortOrder: (index + 1) * 1000,
  }))
  await projectRepo.respaceOrders(orders)
  return projects.map((project, index) => ({
    ...project,
    sortOrder: orders[index]?.sortOrder ?? project.sortOrder,
  }))
}

// ---------------------------------------------------- the task relationship

/** Live tasks filed under a project, open and done, in manual order. */
export function tasksForProject(projectId: Id): Promise<Task[]> {
  return taskRepo.byProject(projectId)
}

/** How many live tasks a project holds. Used before an archive or a delete. */
export function projectTaskCounts(
  projectId: Id,
): Promise<{ total: number; open: number; done: number }> {
  return projectRepo.taskCounts(projectId)
}
