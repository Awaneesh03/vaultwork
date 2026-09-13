import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { eventRepo, projectRepo, subtaskRepo, tagRepo, taskRepo } from '@/repositories'
import {
  execute,
  executeText,
  parseCommand,
  resolveChoice,
  type CommandResult,
} from '@/services/commands'
import { projectInput } from './factories'
import { freezeClock, resetDatabase } from './helpers'

/**
 * The M3 acceptance test.
 *
 * This is the one that matters most, and it deliberately involves **no React at
 * all**. It drives the whole stack the way a future Telegram message will:
 *
 *   text → parseCommand → CommandIntent → CommandExecutor
 *        → TaskService → TaskRepository → Dexie
 *
 * and then inspects the row Dexie actually stored. If this passes, the command
 * layer is genuinely source-agnostic; if it needed a component to work, the
 * whole design of M14 would already be broken.
 *
 * `db.tasks` is read directly here on purpose. Everywhere else in the codebase
 * that would be a layering violation — here it is the point, because the claim
 * being tested is about what reached the database, not about what a repository
 * says reached the database.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

const asTask = (result: CommandResult) => {
  if (result.status !== 'ok' || result.kind !== 'task') {
    throw new Error(`expected an ok task result, got ${result.status}: ${result.message}`)
  }
  return result.task
}

describe('parseCommand("/add Study Java tomorrow 7pm") end to end', () => {
  it('reaches Dexie with the expected structured fields', async () => {
    const intent = parseCommand('/add Study Java tomorrow 7pm', {
      source: 'quickadd',
      now: NOW,
    })

    expect(intent.kind).toBe('task.add')

    const result = await execute(intent)
    const task = asTask(result)

    // Read the row straight out of IndexedDB, past every abstraction.
    const stored = await db.tasks.get(task.id)

    expect(stored).toMatchObject({
      title: 'Study Java',
      status: 'todo',
      priority: 'none',
      dueDate: '2026-09-04',
      dueTime: '19:00',
      description: null,
      estimateMin: null,
      projectId: null,
      tagIds: [],
      isTemplate: false,
      completedAt: null,
      deletedAt: null,
    })
  })

  it('records one task.created event carrying the producer', async () => {
    await executeText('/add Study Java tomorrow 7pm', { source: 'quickadd', now: NOW })

    const events = await eventRepo.list()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'task.created',
      entityType: 'task',
      source: 'quickadd',
    })
  })

  it('gives the producer a message and an undo token', async () => {
    const result = await executeText('/add Study Java tomorrow 7pm', {
      source: 'quickadd',
      now: NOW,
    })

    expect(result.status).toBe('ok')
    expect(result.message).toContain('Study Java')
    if (result.status === 'ok' && result.kind === 'task') {
      expect(result.undo).toMatchObject({ kind: 'task.delete' })
    }
  })

  it('produces the same row from bare text as from the explicit command', async () => {
    const viaCommand = asTask(
      await executeText('/add Study Java tomorrow 7pm', { source: 'quickadd', now: NOW }),
    )
    const viaBareText = asTask(
      await executeText('Study Java tomorrow 7pm', { source: 'quickadd', now: NOW }),
    )

    const a = await db.tasks.get(viaCommand.id)
    const b = await db.tasks.get(viaBareText.id)

    expect({ ...a, id: null, createdAt: 0, updatedAt: 0, sortOrder: 0 }).toEqual({
      ...b,
      id: null,
      createdAt: 0,
      updatedAt: 0,
      sortOrder: 0,
    })
  })
})

describe('the full worked example through the command layer', () => {
  it('resolves tags, project and estimate on the way to Dexie', async () => {
    const project = await projectRepo.create(projectInput({ name: 'DSA Mastery' }), {
      emit: false,
    })

    const task = asTask(
      await executeText('Study Java tomorrow at 7pm #college #java !high @DSA ~45m', {
        source: 'quickadd',
        now: NOW,
      }),
    )

    const stored = await db.tasks.get(task.id)
    expect(stored).toMatchObject({
      title: 'Study Java',
      dueDate: '2026-09-04',
      dueTime: '19:00',
      priority: 'high',
      estimateMin: 45,
      projectId: project.id,
    })

    // The two tags were created on the way through, because Quick Add is a
    // capture surface: being made to define the tag first defeats the point.
    const tags = await tagRepo.list()
    expect(tags.map((tag) => tag.name).sort()).toEqual(['college', 'java'])
    expect(stored?.tagIds.sort()).toEqual(
      tags
        .map((tag) => tag.id)
        .slice()
        .sort(),
    )
  })

  it('still captures the task when the project does not exist', async () => {
    const result = await executeText('Study Java @Nonexistent', { source: 'quickadd', now: NOW })
    const task = asTask(result)

    expect((await db.tasks.get(task.id))?.projectId).toBeNull()
    expect(result.message).toContain('no project')
  })

  it('creates the subtasks a draft carries', async () => {
    const intent = parseCommand('Ship the parser', { source: 'ui', now: NOW })
    if (intent.kind !== 'task.add') throw new Error('expected task.add')

    const task = asTask(
      await execute({ ...intent, draft: { ...intent.draft, subtasks: ['Tokenise', 'Grammar'] } }),
    )

    expect((await subtaskRepo.byTask(task.id)).map((s) => s.title)).toEqual(['Tokenise', 'Grammar'])
  })

  it('refuses to store a task with no title', async () => {
    const result = await executeText('/add   ', { source: 'palette', now: NOW })
    expect(result.status).toBe('error')
    expect(await db.tasks.count()).toBe(0)
  })
})

describe('/done <task> through the same layer', () => {
  beforeEach(async () => {
    await executeText('Study Binary Trees', { source: 'ui', now: NOW })
  })

  it('completes the task and stamps the row', async () => {
    const result = await executeText('/done binary trees', { source: 'palette', now: NOW })
    const task = asTask(result)

    const stored = await db.tasks.get(task.id)
    expect(stored?.status).toBe('done')
    expect(stored?.completedAt).toBeGreaterThanOrEqual(NOW.getTime())
  })

  it('records task.completed with the palette as its source', async () => {
    await executeText('/done binary trees', { source: 'palette', now: NOW })

    const [completed] = await eventRepo.list({ type: 'task.completed' })
    expect(completed?.source).toBe('palette')

    // And nothing else: no fabricated task.updated alongside it.
    const types = (await eventRepo.list()).map((event) => event.type).sort()
    expect(types).toEqual(['task.completed', 'task.created'])
  })

  it('offers an undo that reopens the task', async () => {
    const result = await executeText('/done binary trees', { source: 'palette', now: NOW })
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task result')

    const undone = asTask(await execute(result.undo!))
    expect((await db.tasks.get(undone.id))?.status).toBe('todo')
  })

  it('says so when nothing matches, rather than acting', async () => {
    const result = await executeText('/done quantum mechanics', { source: 'palette', now: NOW })
    expect(result.status).toBe('not_found')

    const stored = await taskRepo.byStatus('todo')
    expect(stored).toHaveLength(1)
  })

  it('will not complete an already completed task twice', async () => {
    await executeText('/done binary trees', { source: 'palette', now: NOW })
    const second = await executeText('/done binary trees', { source: 'palette', now: NOW })

    // The task is no longer in the open pool, so the reference finds nothing.
    expect(second.status).toBe('not_found')
    expect(await eventRepo.list({ type: 'task.completed' })).toHaveLength(1)
  })
})

describe('/delete <task> through the same layer', () => {
  it('soft-deletes the row rather than removing it', async () => {
    const created = asTask(await executeText('Book dentist', { source: 'ui', now: NOW }))
    const result = await executeText('/delete book dentist', { source: 'palette', now: NOW })

    expect(result.message).toBe('Task deleted')

    const stored = await db.tasks.get(created.id)
    expect(stored).toBeDefined()
    expect(stored?.deletedAt).toBeGreaterThanOrEqual(NOW.getTime())
    expect(await taskRepo.get(created.id)).toBeUndefined()
  })

  it('offers an undo that restores the row', async () => {
    const created = asTask(await executeText('Book dentist', { source: 'ui', now: NOW }))
    const result = await executeText('/delete book dentist', { source: 'palette', now: NOW })
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task result')

    expect(result.undo).toMatchObject({ kind: 'task.restore', taskId: created.id })

    await execute(result.undo!)
    expect(await taskRepo.get(created.id)).toMatchObject({ title: 'Book dentist' })
  })

  it('logs deleted then restored, in that order', async () => {
    await executeText('Book dentist', { source: 'ui', now: NOW })
    const result = await executeText('/delete book dentist', { source: 'palette', now: NOW })
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task result')
    await execute(result.undo!)

    const types = (await eventRepo.list()).sort((a, b) => a.at - b.at).map((e) => e.type)
    expect(types).toEqual(['task.created', 'task.deleted', 'task.restored'])
  })
})

describe('ambiguity is never resolved by guessing', () => {
  beforeEach(async () => {
    for (const title of ['Study Binary Trees', 'Revise Binary Trees', 'Practice Binary Trees']) {
      await executeText(title, { source: 'ui', now: NOW })
    }
  })

  it('returns numbered choices instead of completing one', async () => {
    const result = await executeText('/done binary trees', { source: 'palette', now: NOW })

    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return

    expect(result.message).toBe('Which task did you mean?')
    expect(result.choices.map((choice) => [choice.index, choice.label])).toEqual([
      [1, 'Study Binary Trees'],
      [2, 'Revise Binary Trees'],
      [3, 'Practice Binary Trees'],
    ])

    // Nothing was completed while the question was outstanding.
    expect(await taskRepo.byStatus('done')).toHaveLength(0)
  })

  it('completes exactly the task the caller then picks', async () => {
    const asked = await executeText('/done binary trees', { source: 'palette', now: NOW })
    if (asked.status !== 'ambiguous') throw new Error('expected an ambiguity')

    const chosen = asked.choices[1]!
    const result = await resolveChoice(asked.intent, chosen.id)
    const task = asTask(result)

    expect(task.title).toBe('Revise Binary Trees')

    const done = await taskRepo.byStatus('done')
    expect(done.map((t) => t.title)).toEqual(['Revise Binary Trees'])
  })

  it('asks the same question for a delete, and deletes only the choice', async () => {
    const asked = await executeText('/delete binary trees', { source: 'palette', now: NOW })
    if (asked.status !== 'ambiguous') throw new Error('expected an ambiguity')
    expect(asked.message).toBe('Which task did you want to delete?')

    await resolveChoice(asked.intent, asked.choices[0]!.id)

    const live = await taskRepo.listLive()
    expect(live.map((t) => t.title)).toEqual(['Revise Binary Trees', 'Practice Binary Trees'])
  })

  it('resolves without asking once one title is unique enough', async () => {
    const result = await executeText('/done practice binary', { source: 'palette', now: NOW })
    expect(asTask(result).title).toBe('Practice Binary Trees')
  })
})

describe('view commands are answers, not navigation side effects', () => {
  it('returns the tasks a view holds plus the path a UI would open', async () => {
    await executeText('Ship the report today', { source: 'ui', now: NOW })
    await executeText('Renew the pass next week', { source: 'ui', now: NOW })

    const result = await executeText('/today', { source: 'palette', now: NOW })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.kind !== 'view') throw new Error('expected a view result')

    expect(result.view).toBe('today')
    expect(result.path).toBe('/today')
    expect(result.tasks.map((task) => task.title)).toEqual(['Ship the report'])
    expect(result.message).toBe('Today · 1 open')
  })
})

describe('errors are data, not exceptions', () => {
  it('reports an unknown command without capturing it as a task', async () => {
    const result = await executeText('/dlete something', { source: 'palette', now: NOW })

    expect(result.status).toBe('error')
    expect(result.message).toContain('/dlete')
    expect(await db.tasks.count()).toBe(0)
  })

  it('turns a thrown repository error into a failed result', async () => {
    const result = await execute({
      kind: 'task.restore',
      source: 'ui',
      raw: '',
      taskId: '00000000-0000-4000-8000-000000000000',
    })

    expect(result.status).toBe('error')
    expect(result.message).toContain('00000000-0000-4000-8000-000000000000')
  })
})
