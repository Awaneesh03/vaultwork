import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, projectRepo, taskRepo } from '@/repositories'
import {
  createProject,
  execute,
  executeText,
  getProjectDetail,
  getTaskCounts,
  parseCommand,
  resolveChoice,
  type CommandIntent,
} from '@/services'

/**
 * The project half of the command pipeline, end to end, with no React anywhere.
 *
 *   text → CommandIntent → CommandExecutor → ProjectService → ProjectRepository → Dexie
 *
 * This suite is the proof that the project system is a *domain* rather than a
 * screen: every assertion below runs in the `node` environment with no DOM, no
 * component and no hook, which is what makes a future Telegram `/project
 * college` a new producer rather than a second implementation.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const context = { source: 'ui' as const, now: NOW }

beforeEach(async () => {
  const { resetDatabase, freezeClock } = await import('./helpers')
  await resetDatabase()
  freezeClock(NOW)
})

async function eventTypes(): Promise<string[]> {
  return (await eventRepo.list()).reverse().map((event) => event.type)
}

describe('parsing', () => {
  it('routes /projects to the projects screen', () => {
    const intent = parseCommand('/projects', context)
    expect(intent.kind).toBe('app.navigate')
    if (intent.kind !== 'app.navigate') return
    expect(intent.path).toBe('/projects')
  })

  it('routes /project <name> to opening one by text', () => {
    const intent = parseCommand('/project college', context)
    expect(intent.kind).toBe('project.open')
    if (intent.kind !== 'project.open') return
    expect(intent.ref).toEqual({ by: 'text', query: 'college' })
  })

  it('treats a bare /project as "show me the list" rather than an error', () => {
    expect(parseCommand('/project', context).kind).toBe('app.navigate')
  })

  it('accepts /proj and /p as the same command', () => {
    for (const alias of ['/proj college', '/p college']) {
      expect(parseCommand(alias, context).kind).toBe('project.open')
    }
  })

  it('routes /add project <name> to creating a project', () => {
    const intent = parseCommand('/add project College', context)
    expect(intent.kind).toBe('project.add')
    if (intent.kind !== 'project.add') return
    expect(intent.name).toBe('College')
  })

  it('is case-insensitive about the "project" qualifier', () => {
    const intent = parseCommand('/add PROJECT College', context)
    expect(intent.kind).toBe('project.add')
  })

  it('still adds a task when "project" is part of the title', () => {
    // "/add project" with nothing after it is not a project command, and
    // "project plan" is a perfectly good task title.
    const intent = parseCommand('/add project', context)
    expect(intent.kind).toBe('task.add')

    const bare = parseCommand('project plan tomorrow', context)
    expect(bare.kind).toBe('task.add')
    if (bare.kind !== 'task.add') return
    expect(bare.draft.title).toBe('project plan')
  })

  it('carries a default project onto a bare capture', () => {
    const intent = parseCommand('Study Java', { ...context, defaultProjectId: 'p1' })
    expect(intent.kind).toBe('task.add')
    if (intent.kind !== 'task.add') return
    expect(intent.defaultProjectId).toBe('p1')
  })

  it('omits the default project entirely when there is not one', () => {
    const intent = parseCommand('Study Java', context)
    if (intent.kind !== 'task.add') throw new Error('expected task.add')
    expect(intent.defaultProjectId).toBeUndefined()
  })
})

describe('creating a project', () => {
  it('writes a row through the whole stack', async () => {
    const result = await executeText('/add project College', context)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.kind !== 'project') throw new Error('expected a project')
    expect(result.message).toContain('College')

    const rows = await projectRepo.listLive()
    expect(rows.map((row) => row.name)).toEqual(['College'])
    expect(await eventTypes()).toEqual(['project.created'])
  })

  it('refuses a duplicate rather than making a second one', async () => {
    await executeText('/add project College', context)
    const second = await executeText('/add project college', context)

    expect(second.status).toBe('error')
    expect(await projectRepo.listLive()).toHaveLength(1)
  })

  it('comes back with an undo that deletes what it created', async () => {
    const result = await executeText('/add project College', context)
    if (result.status !== 'ok' || result.kind !== 'project') throw new Error('expected a project')
    expect(result.undo).toMatchObject({ kind: 'project.delete' })

    await execute(result.undo as CommandIntent)
    expect(await projectRepo.listLive()).toEqual([])
  })
})

describe('opening a project', () => {
  it('navigates to the project it resolved', async () => {
    const project = await createProject('College')
    const result = await executeText('/project college', context)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.kind !== 'navigate') throw new Error('expected navigate')
    expect(result.path).toBe(`/projects/${project.id}`)
  })

  it('asks rather than guessing when the name is ambiguous', async () => {
    await createProject('College Semester 5')
    await createProject('College Semester 6')

    const result = await executeText('/project college semester', context)
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return
    expect(result.choices.map((choice) => choice.label).sort()).toEqual([
      'College Semester 5',
      'College Semester 6',
    ])
  })

  it('re-runs against the chosen project once a choice is made', async () => {
    await createProject('College Semester 5')
    const sixth = await createProject('College Semester 6')

    const ambiguous = await executeText('/project college semester', context)
    if (ambiguous.status !== 'ambiguous') throw new Error('expected ambiguity')

    const resolved = await resolveChoice(ambiguous.intent, sixth.id)
    if (resolved.status !== 'ok' || resolved.kind !== 'navigate') {
      throw new Error('expected navigate')
    }
    expect(resolved.path).toBe(`/projects/${sixth.id}`)
  })

  it('says so when nothing matches', async () => {
    await createProject('College')
    const result = await executeText('/project portfolio', context)
    expect(result.status).toBe('not_found')
  })
})

describe('archiving through the pipeline', () => {
  it('archives, keeps the tasks, and says how many it kept', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { ...context, defaultProjectId: project.id })

    const result = await execute({
      kind: 'project.archive',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    })

    if (result.status !== 'ok' || result.kind !== 'project') throw new Error('expected a project')
    expect(result.project.status).toBe('archived')
    expect(result.message).toContain('1 task kept')

    // The proof, not the promise: the task is still filed under it.
    expect(await taskRepo.byProject(project.id)).toHaveLength(1)
  })

  it('undoes an archive back to the exact status it came from', async () => {
    const project = await createProject('College', { status: 'planning' })

    const archived = await execute({
      kind: 'project.archive',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    })
    if (archived.status !== 'ok' || archived.kind !== 'project') throw new Error('expected ok')

    const undone = await execute(archived.undo as CommandIntent)
    if (undone.status !== 'ok' || undone.kind !== 'project') throw new Error('expected ok')
    expect(undone.project.status).toBe('planning')
  })

  it('says nothing happened when it is already archived', async () => {
    const project = await createProject('College')
    const intent: CommandIntent = {
      kind: 'project.archive',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    }
    await execute(intent)
    const again = await execute(intent)

    expect(again.status).toBe('ok')
    if (again.status !== 'ok') return
    expect(again.kind).toBe('none')
    expect(await eventTypes()).toEqual(['project.created', 'project.archived'])
  })
})

describe('deleting through the pipeline', () => {
  it('deletes the project and not one task', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { ...context, defaultProjectId: project.id })
    await executeText('Read chapter 4', { ...context, defaultProjectId: project.id })

    const result = await execute({
      kind: 'project.delete',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    })

    if (result.status !== 'ok' || result.kind !== 'project') throw new Error('expected a project')
    expect(result.message).toContain('2 tasks kept')

    const tasks = await taskRepo.listLive()
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => task.deletedAt === null)).toBe(true)
    expect(await projectRepo.get(project.id)).toBeUndefined()
  })

  it('offers an undo that restores the project and its assignments', async () => {
    const project = await createProject('College')
    await executeText('Study Java', { ...context, defaultProjectId: project.id })

    const deleted = await execute({
      kind: 'project.delete',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    })
    if (deleted.status !== 'ok' || deleted.kind !== 'project') throw new Error('expected ok')
    expect(deleted.undo).toMatchObject({ kind: 'project.restore' })

    await execute(deleted.undo as CommandIntent)

    const detail = await getProjectDetail(project.id)
    expect(detail?.project.name).toBe('College')
    expect(detail?.tasks.map((task) => task.title)).toEqual(['Study Java'])
  })
})

describe('reordering through the pipeline', () => {
  const order = async () => (await projectRepo.listLive()).map((row) => row.name)

  it('moves one project and persists the new order', async () => {
    const a = await createProject('A')
    const b = await createProject('B')
    const c = await createProject('C')

    const moved = await execute({
      kind: 'project.move',
      source: 'ui',
      raw: '',
      orderedIds: [a.id, b.id, c.id],
      fromIndex: 2,
      toIndex: 0,
    })

    if (moved.status !== 'ok' || moved.kind !== 'project') throw new Error('expected ok')
    expect(moved.project.id).toBe(c.id)
    expect(await order()).toEqual(['C', 'A', 'B'])
    expect(await eventTypes()).toContain('project.reordered')
  })

  it('reverses with the same intent against the order that is now on screen', async () => {
    const a = await createProject('A')
    const b = await createProject('B')
    const c = await createProject('C')

    await execute({
      kind: 'project.move',
      source: 'ui',
      raw: '',
      orderedIds: [a.id, b.id, c.id],
      fromIndex: 2,
      toIndex: 0,
    })

    // `orderedIds` is the list as displayed, so the reverse move takes the
    // *current* order — which is what the UI dispatches, since it re-reads the
    // list from the live query on every render.
    await execute({
      kind: 'project.move',
      source: 'ui',
      raw: '',
      orderedIds: [c.id, a.id, b.id],
      fromIndex: 0,
      toIndex: 2,
    })

    expect(await order()).toEqual(['A', 'B', 'C'])
  })

  it('mirrors the indices in its undo token, as task.move does', async () => {
    const a = await createProject('A')
    const b = await createProject('B')

    const moved = await execute({
      kind: 'project.move',
      source: 'ui',
      raw: '',
      orderedIds: [a.id, b.id],
      fromIndex: 1,
      toIndex: 0,
    })
    if (moved.status !== 'ok' || moved.kind !== 'project') throw new Error('expected ok')

    // The token swaps the indices but keeps the ids it was given, which is why
    // reordering is deliberately absent from the ⌘Z stack: replaying it against
    // a list that has already moved is not a reliable inverse.
    expect(moved.undo).toMatchObject({
      kind: 'project.move',
      orderedIds: [a.id, b.id],
      fromIndex: 0,
      toIndex: 1,
    })
  })
})

describe('capture inside a project', () => {
  it('files a quick-added task under the project it was captured in', async () => {
    const college = await createProject('College')

    const result = await executeText('Study Java tomorrow 7pm #java ~45m', {
      source: 'quickadd',
      now: NOW,
      defaultProjectId: college.id,
    })

    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task')

    // The example from the M4 specification, parsed by the M3 parser.
    expect(result.task).toMatchObject({
      title: 'Study Java',
      projectId: college.id,
      dueDate: '2026-09-04',
      dueTime: '19:00',
      estimateMin: 45,
    })
    expect(result.task.tagIds).toHaveLength(1)
  })

  it('lets an explicit @project in the text override the screen it came from', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')

    const result = await executeText('Solve arrays @DSA', {
      ...context,
      defaultProjectId: college.id,
    })
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task')
    expect(result.task.projectId).toBe(dsa.id)
  })

  it('falls back to the screen when an @project cannot be resolved', async () => {
    const college = await createProject('College')

    const result = await executeText('Solve arrays @Nonsense', {
      ...context,
      defaultProjectId: college.id,
    })
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task')

    // Captured, filed where the user was, and told why it did not land on the
    // project they aimed at. Never invents a project.
    expect(result.task.projectId).toBe(college.id)
    expect(result.message).toContain('Nonsense')
    expect(await projectRepo.listLive()).toHaveLength(1)
  })

  it('still lands in the Inbox when captured outside any project', async () => {
    const result = await executeText('Study Java', context)
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task')
    expect(result.task.projectId).toBeNull()
    expect((await getTaskCounts()).inbox).toBe(1)
  })
})

describe('assigning a task to a project', () => {
  it('files, refiles and unfiles a task through one intent', async () => {
    const college = await createProject('College')
    const dsa = await createProject('DSA')
    const created = await executeText('Study Java', context)
    if (created.status !== 'ok' || created.kind !== 'task') throw new Error('expected a task')
    const taskId = created.task.id

    const filed = await execute({
      kind: 'task.assignProject',
      source: 'ui',
      raw: '',
      taskId,
      projectId: college.id,
    })
    if (filed.status !== 'ok' || filed.kind !== 'task') throw new Error('expected a task')
    expect(filed.task.projectId).toBe(college.id)
    expect(filed.message).toContain('College')

    const refiled = await execute({
      kind: 'task.assignProject',
      source: 'ui',
      raw: '',
      taskId,
      projectId: dsa.id,
    })
    if (refiled.status !== 'ok' || refiled.kind !== 'task') throw new Error('expected a task')
    expect(refiled.task.projectId).toBe(dsa.id)

    const unfiled = await execute({
      kind: 'task.assignProject',
      source: 'ui',
      raw: '',
      taskId,
      projectId: null,
    })
    if (unfiled.status !== 'ok' || unfiled.kind !== 'task') throw new Error('expected a task')
    expect(unfiled.task.projectId).toBeNull()
    expect(unfiled.message).toContain('Inbox')

    // Unfiling is not deleting: the task is back in the Inbox, intact.
    expect((await taskRepo.get(taskId))?.deletedAt).toBeNull()
    expect((await getTaskCounts()).inbox).toBe(1)
  })

  it('undoes back to the project the task came from', async () => {
    const college = await createProject('College')
    const created = await executeText('Study Java', {
      ...context,
      defaultProjectId: college.id,
    })
    if (created.status !== 'ok' || created.kind !== 'task') throw new Error('expected a task')

    const unfiled = await execute({
      kind: 'task.assignProject',
      source: 'ui',
      raw: '',
      taskId: created.task.id,
      projectId: null,
    })
    if (unfiled.status !== 'ok' || unfiled.kind !== 'task') throw new Error('expected a task')

    const undone = await execute(unfiled.undo as CommandIntent)
    if (undone.status !== 'ok' || undone.kind !== 'task') throw new Error('expected a task')
    expect(undone.task.projectId).toBe(college.id)
  })

  it('reports a task that no longer exists rather than throwing', async () => {
    const result = await execute({
      kind: 'task.assignProject',
      source: 'ui',
      raw: '',
      taskId: 'nope',
      projectId: null,
    })
    expect(result.status).toBe('not_found')
  })
})

describe('one operation, one event', () => {
  it('records exactly the events the operations claim to', async () => {
    const project = await createProject('College')
    await execute({ kind: 'project.update', source: 'ui', raw: '', projectId: project.id, patch: { color: 'rose' } })
    await execute({ kind: 'project.archive', source: 'ui', raw: '', ref: { by: 'id', id: project.id } })
    await execute({ kind: 'project.unarchive', source: 'ui', raw: '', projectId: project.id })
    await execute({ kind: 'project.delete', source: 'ui', raw: '', ref: { by: 'id', id: project.id } })
    await execute({ kind: 'project.restore', source: 'ui', raw: '', projectId: project.id })

    expect(await eventTypes()).toEqual([
      'project.created',
      'project.updated',
      'project.archived',
      'project.restored',
      'project.deleted',
      'project.restored',
    ])
  })

  it('stamps the source on the event, never on the project', async () => {
    const result = await executeText('/add project College', { source: 'palette', now: NOW })
    if (result.status !== 'ok' || result.kind !== 'project') throw new Error('expected a project')

    const [event] = await eventRepo.list({ type: 'project.created' })
    expect(event?.source).toBe('palette')
    expect(Object.keys(result.project)).not.toContain('source')
  })
})

describe('the pipeline has no React in it', () => {
  const ROOT = resolve(__dirname, '..')

  const FILES = [
    'src/services/projectService.ts',
    'src/services/projectQueryService.ts',
    'src/services/projects/projectStats.ts',
    'src/repositories/projectRepo.ts',
    'src/services/commands/commandExecutor.ts',
    'src/services/commands/commandRouter.ts',
  ]

  it('imports no UI framework anywhere in the project domain', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const banned of ['react', 'react-dom', 'zustand', '@dnd-kit', 'lucide-react']) {
        if (new RegExp(`from '${banned}`).test(source)) offenders.push(`${file} imports ${banned}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps Dexie out of the project service and query service', () => {
    const offenders: string[] = []
    for (const file of ['src/services/projectService.ts', 'src/services/projectQueryService.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      if (/from 'dexie'/.test(source)) offenders.push(file)
      if (/from '@\/db/.test(source)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
