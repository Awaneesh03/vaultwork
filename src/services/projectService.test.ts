import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, projectRepo, taskRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ICON,
  EmptyProjectNameError,
  ProjectNameTakenError,
  archiveProject,
  createProject,
  deleteProject,
  findProjectByName,
  getProject,
  listActiveProjects,
  listArchivedProjects,
  listDeletedProjects,
  listProjects,
  moveProject,
  projectTaskCounts,
  restoreProject,
  setProjectStatus,
  tasksForProject,
  unarchiveProject,
  updateProject,
} from './projectService'
import { createTask } from './taskService'

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

/** Every event type recorded, oldest first. */
async function eventTypes(): Promise<string[]> {
  const events = await eventRepo.list()
  return events.reverse().map((event) => event.type)
}

describe('create', () => {
  it('applies the documented defaults', async () => {
    const project = await createProject('College')

    expect(project).toMatchObject({
      name: 'College',
      description: null,
      color: DEFAULT_PROJECT_COLOR,
      icon: DEFAULT_PROJECT_ICON,
      status: 'active',
      deadline: null,
    })
  })

  it('takes the fields the composer offers', async () => {
    const project = await createProject('DSA', {
      description: 'Structured practice',
      color: 'violet',
      icon: 'binary',
      status: 'planning',
      deadline: '2026-12-31',
    })

    expect(project).toMatchObject({
      description: 'Structured practice',
      color: 'violet',
      icon: 'binary',
      status: 'planning',
      deadline: '2026-12-31',
    })
  })

  it('appends after the last project', async () => {
    const first = await createProject('A')
    const second = await createProject('B')
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('emits exactly one project.created', async () => {
    await createProject('College')
    expect(await eventTypes()).toEqual(['project.created'])
  })

  it('records where the creation came from, on the event', async () => {
    await createProject('College', {}, 'palette')
    const [event] = await eventRepo.list()
    expect(event?.source).toBe('palette')
  })
})

describe('validation', () => {
  it('refuses an empty name', async () => {
    await expect(createProject('   ')).rejects.toThrow(EmptyProjectNameError)
  })

  it('trims and collapses whitespace rather than storing it', async () => {
    const project = await createProject('  Semester   5  ')
    expect(project.name).toBe('Semester 5')
  })

  it('refuses a duplicate name, ignoring case', async () => {
    await createProject('College')
    await expect(createProject('college')).rejects.toThrow(ProjectNameTakenError)
    expect(await listProjects()).toHaveLength(1)
  })

  it('refuses a duplicate of an archived project, and says to restore it', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)

    // An archive you cannot see is exactly how you end up with two projects
    // of the same name and no idea which holds your tasks.
    await expect(createProject('College')).rejects.toThrow(/restore it/i)
  })

  it('frees the name of a deleted project for reuse', async () => {
    const project = await createProject('College')
    await deleteProject(project.id)

    const replacement = await createProject('College')
    expect(replacement.id).not.toBe(project.id)
  })

  it('refuses to rename onto another project', async () => {
    await createProject('College')
    const other = await createProject('Portfolio')
    await expect(updateProject(other.id, { name: 'College' })).rejects.toThrow(
      ProjectNameTakenError,
    )
  })

  it('lets a project keep its own name while changing case', async () => {
    const project = await createProject('college')
    const renamed = await updateProject(project.id, { name: 'College' })
    expect(renamed.name).toBe('College')
    expect(renamed.id).toBe(project.id)
  })

  it('refuses to blank an existing name', async () => {
    const project = await createProject('College')
    await expect(updateProject(project.id, { name: '  ' })).rejects.toThrow(
      EmptyProjectNameError,
    )
  })
})

describe('update', () => {
  it('keeps the id — editing never creates a project', async () => {
    const project = await createProject('College')
    const updated = await updateProject(project.id, { name: 'Semester 5', color: 'rose' })

    expect(updated.id).toBe(project.id)
    expect(await listProjects()).toHaveLength(1)
    expect(await getProject(project.id)).toMatchObject({ name: 'Semester 5', color: 'rose' })
  })

  it('emits one project.updated naming the fields that changed', async () => {
    const project = await createProject('College')
    await updateProject(project.id, { color: 'blue' })

    const [event] = await eventRepo.list({ type: 'project.updated' })
    expect(event?.payload).toEqual({ fields: ['color'] })
    expect(await eventTypes()).toEqual(['project.created', 'project.updated'])
  })

  it('writes nothing when the patch changes nothing', async () => {
    const project = await createProject('College', { color: 'teal' })
    const same = await updateProject(project.id, { name: 'College', color: 'teal' })

    expect(same.updatedAt).toBe(project.updatedAt)
    expect(await eventTypes()).toEqual(['project.created'])
  })

  it('turns a whitespace-only description into null', async () => {
    const project = await createProject('College', { description: 'something' })
    const updated = await updateProject(project.id, { description: '   ' })
    expect(updated.description).toBeNull()
  })

  it('routes a status change to archive when the status is archived', async () => {
    const project = await createProject('College')
    await setProjectStatus(project.id, 'archived')

    // The specific event, not a generic update — see the archive tests below.
    expect(await eventTypes()).toEqual(['project.created', 'project.archived'])
  })

  it('treats any other status as an ordinary edit', async () => {
    const project = await createProject('College')
    await setProjectStatus(project.id, 'on_hold')
    expect(await eventTypes()).toEqual(['project.created', 'project.updated'])
  })
})

describe('archive', () => {
  it('sets the status and emits exactly one project.archived', async () => {
    const project = await createProject('College')
    const archived = await archiveProject(project.id)

    expect(archived.status).toBe('archived')
    expect(await eventTypes()).toEqual(['project.created', 'project.archived'])
  })

  it('records the status it came from, and how many tasks it kept', async () => {
    const project = await createProject('College', { status: 'planning' })
    await createTask({ title: 'a', projectId: project.id })
    await createTask({ title: 'b', projectId: project.id })
    await archiveProject(project.id)

    const [event] = await eventRepo.list({ type: 'project.archived' })
    expect(event?.payload).toMatchObject({ from: 'planning', taskCount: 2 })
  })

  it('leaves every task exactly where it was', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study', projectId: project.id })
    await archiveProject(project.id)

    const after = await taskRepo.get(task.id)
    expect(after?.projectId).toBe(project.id)
    expect(after?.deletedAt).toBeNull()
    expect(await tasksForProject(project.id)).toHaveLength(1)
  })

  it('drops out of the active list but stays live', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)

    expect(await listActiveProjects()).toEqual([])
    expect((await listArchivedProjects()).map((row) => row.name)).toEqual(['College'])
    expect(await listProjects()).toHaveLength(1)
  })

  it('is idempotent — archiving twice records one event', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)
    await archiveProject(project.id)
    expect(await eventTypes()).toEqual(['project.created', 'project.archived'])
  })
})

describe('unarchive', () => {
  it('returns the project to the status it had, not to a default', async () => {
    const project = await createProject('College', { status: 'on_hold' })
    await archiveProject(project.id)
    const restored = await unarchiveProject(project.id)

    expect(restored.status).toBe('on_hold')
  })

  it('emits one project.restored describing the move', async () => {
    const project = await createProject('College', { status: 'planning' })
    await archiveProject(project.id)
    await unarchiveProject(project.id)

    expect(await eventTypes()).toEqual([
      'project.created',
      'project.archived',
      'project.restored',
    ])
    const [event] = await eventRepo.list({ type: 'project.restored' })
    expect(event?.payload).toMatchObject({ from: 'archived', to: 'planning' })
  })

  it('uses the most recent archival when a project has been round-tripped', async () => {
    const project = await createProject('College', { status: 'planning' })
    await archiveProject(project.id)
    await unarchiveProject(project.id)
    await updateProject(project.id, { status: 'completed' })
    await archiveProject(project.id)

    expect((await unarchiveProject(project.id)).status).toBe('completed')
  })

  it('falls back to active when the log knows nothing about it', async () => {
    // A project archived directly in the store — a restored backup, say — has
    // no archival event to read. Coming back as "active" beats not coming back.
    const project = await projectRepo.create({
      name: 'Imported',
      description: null,
      color: 'teal',
      icon: 'folder',
      status: 'archived',
      deadline: null,
      goalId: null,
      tagIds: [],
      sortOrder: 1000,
      vaultPath: null,
    })

    expect((await unarchiveProject(project.id)).status).toBe('active')
  })

  it('does nothing to a project that is not archived', async () => {
    const project = await createProject('College')
    const same = await unarchiveProject(project.id)
    expect(same.status).toBe('active')
    expect(await eventTypes()).toEqual(['project.created'])
  })

  it('is what archive undoes to — the pair is exactly reversible', async () => {
    const project = await createProject('College', { status: 'planning', color: 'rose' })
    await archiveProject(project.id)
    const back = await unarchiveProject(project.id)

    expect(back).toMatchObject({ id: project.id, status: 'planning', color: 'rose' })
  })
})

describe('delete', () => {
  it('soft-deletes and emits exactly one project.deleted', async () => {
    const project = await createProject('College')
    const deletion = await deleteProject(project.id)

    expect(deletion.project.id).toBe(project.id)
    expect(await getProject(project.id)).toBeUndefined()
    expect(await eventTypes()).toEqual(['project.created', 'project.deleted'])
  })

  it('does NOT delete the tasks filed under it', async () => {
    const project = await createProject('College')
    const first = await createTask({ title: 'Study', projectId: project.id })
    const second = await createTask({ title: 'Read', projectId: project.id })

    await deleteProject(project.id)

    for (const task of [first, second]) {
      const after = await taskRepo.get(task.id)
      expect(after).toBeDefined()
      expect(after?.deletedAt).toBeNull()
      // The reference is left in place on purpose: that is what makes restore
      // exactly reversible.
      expect(after?.projectId).toBe(project.id)
    }
  })

  it('reports how many tasks are now unfiled, without moving any', async () => {
    const project = await createProject('College')
    await createTask({ title: 'a', projectId: project.id })
    await createTask({ title: 'b', projectId: project.id })
    await createTask({ title: 'elsewhere' })

    const deletion = await deleteProject(project.id)
    expect(deletion.orphanedTaskCount).toBe(2)
  })

  it('restores the project and every assignment with it', async () => {
    const project = await createProject('College')
    const task = await createTask({ title: 'Study', projectId: project.id })

    await deleteProject(project.id)
    const restored = await restoreProject(project.id)

    expect(restored.deletedAt).toBeNull()
    expect(restored.name).toBe('College')
    expect((await taskRepo.get(task.id))?.projectId).toBe(project.id)
    expect(await tasksForProject(project.id)).toHaveLength(1)
  })

  it('emits project.restored when a deleted project comes back', async () => {
    const project = await createProject('College')
    await deleteProject(project.id)
    await restoreProject(project.id)

    expect(await eventTypes()).toEqual([
      'project.created',
      'project.deleted',
      'project.restored',
    ])
  })

  it('keeps a deleted project out of every live list but in listDeleted', async () => {
    const project = await createProject('College')
    await deleteProject(project.id)

    expect(await listProjects()).toEqual([])
    expect(await listActiveProjects()).toEqual([])
    expect(await listArchivedProjects()).toEqual([])
    expect((await listDeletedProjects()).map((row) => row.name)).toEqual(['College'])
  })

  it('deletes an archived project without resurrecting it', async () => {
    const project = await createProject('College')
    await archiveProject(project.id)
    await deleteProject(project.id)
    const restored = await restoreProject(project.id)

    expect(restored.status).toBe('archived')
  })
})

describe('reordering', () => {
  it('writes one row and emits one project.reordered', async () => {
    const a = await createProject('A')
    const b = await createProject('B')
    const c = await createProject('C')

    const moved = await moveProject([a.id, b.id, c.id], 2, 0)

    expect(moved?.id).toBe(c.id)
    expect((await listProjects()).map((row) => row.name)).toEqual(['C', 'A', 'B'])
    expect(await eventTypes()).toEqual([
      'project.created',
      'project.created',
      'project.created',
      'project.reordered',
    ])
  })

  it('persists the new order — a reload reads the same list', async () => {
    const a = await createProject('A')
    const b = await createProject('B')
    await moveProject([a.id, b.id], 1, 0)

    // Straight from the table, bypassing anything held in memory.
    const rows = await projectRepo.listLive()
    expect(rows.map((row) => row.name)).toEqual(['B', 'A'])
  })

  it('moves to the end as well as to the front', async () => {
    const a = await createProject('A')
    const b = await createProject('B')
    const c = await createProject('C')

    await moveProject([a.id, b.id, c.id], 0, 2)
    expect((await listProjects()).map((row) => row.name)).toEqual(['B', 'C', 'A'])
  })

  it('does nothing, and says so, when the indices match', async () => {
    const a = await createProject('A')
    const b = await createProject('B')

    expect(await moveProject([a.id, b.id], 1, 1)).toBeUndefined()
    expect(await eventTypes()).toEqual(['project.created', 'project.created'])
  })

  it('respaces rather than colliding when midpoints run out', async () => {
    const a = await createProject('A', { sortOrder: 1000 })
    const b = await createProject('B', { sortOrder: 1000.0000001 })
    const c = await createProject('C', { sortOrder: 1000.0000002 })

    await moveProject([a.id, b.id, c.id], 2, 1)

    const rows = await listProjects()
    const orders = rows.map((row) => row.sortOrder)
    expect(new Set(orders).size).toBe(3)
    expect(rows.map((row) => row.name)).toEqual(['A', 'C', 'B'])
  })
})

describe('reads', () => {
  it('finds by name, case-insensitively', async () => {
    await createProject('DSA Mastery')
    expect((await findProjectByName('dsa mastery'))?.name).toBe('DSA Mastery')
  })

  it('counts the tasks filed under a project, by status', async () => {
    const project = await createProject('College')
    await createTask({ title: 'a', projectId: project.id })
    const done = await createTask({ title: 'b', projectId: project.id })
    await taskRepo.update(done.id, { status: 'done' })

    expect(await projectTaskCounts(project.id)).toEqual({ total: 2, open: 1, done: 1 })
  })
})
