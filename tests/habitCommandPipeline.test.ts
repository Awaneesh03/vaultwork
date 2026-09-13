import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { eventRepo, habitEntryRepo, habitRepo } from '@/repositories'
import {
  completeHabit,
  createHabit,
  execute,
  executeText,
  getTodayHabits,
  parseCommand,
  resolveChoice,
  type CommandIntent,
} from '@/services'

/**
 * The habit half of the command pipeline, end to end, with no React.
 *
 *   text → CommandIntent → CommandExecutor → HabitService → HabitRepository → Dexie
 *
 * Same proof as the task and project suites: habits are a *domain*, not a
 * screen, so a future Telegram `/habit reading` is a new producer rather than a
 * second implementation.
 */

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const TODAY = '2026-09-03'
const context = { source: 'ui' as const, now: NOW }

beforeEach(async () => {
  const { resetDatabase, freezeClock } = await import('./helpers')
  await resetDatabase()
  freezeClock(NOW)
})

const eventTypes = async () => (await eventRepo.list()).reverse().map((event) => event.type)

describe('parsing', () => {
  it('routes /habits to the habits screen', () => {
    const intent = parseCommand('/habits', context)
    expect(intent.kind).toBe('app.navigate')
    if (intent.kind !== 'app.navigate') return
    expect(intent.path).toBe('/habits')
  })

  it('routes /habit <name> to opening one by text', () => {
    const intent = parseCommand('/habit reading', context)
    expect(intent.kind).toBe('habit.open')
    if (intent.kind !== 'habit.open') return
    expect(intent.ref).toEqual({ by: 'text', query: 'reading' })
  })

  it('treats a bare /habit as "show me the list"', () => {
    expect(parseCommand('/habit', context).kind).toBe('app.navigate')
  })

  it('routes /add habit <name> to creating a habit', () => {
    const intent = parseCommand('/add habit Read 20 pages', context)
    expect(intent.kind).toBe('habit.add')
    if (intent.kind !== 'habit.add') return
    expect(intent.name).toBe('Read 20 pages')
  })

  it('leaves ordinary quick add making tasks, never habits', () => {
    // This is the dangerous case the milestone calls out: "Read 20 pages daily"
    // is far more often a task than a commitment, so it stays a task.
    const bare = parseCommand('Read 20 pages daily', context)
    expect(bare.kind).toBe('task.add')

    // And `/done <task>` is untouched: it never resolves against habits.
    expect(parseCommand('/done Read 20 pages', context).kind).toBe('task.complete')
  })
})

describe('creating through the pipeline', () => {
  it('writes one habit row and no entries', async () => {
    const result = await executeText('/add habit Read 20 pages', context)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.kind !== 'habit') throw new Error('expected a habit')
    expect(result.habit.name).toBe('Read 20 pages')

    expect(await db.habits.count()).toBe(1)
    expect(await db.habitEntries.count()).toBe(0)
    expect(await eventTypes()).toEqual(['habit.created'])
  })

  it('comes back with an undo that deletes what it made', async () => {
    const result = await executeText('/add habit Read', context)
    if (result.status !== 'ok' || result.kind !== 'habit') throw new Error('expected a habit')

    await execute(result.undo as CommandIntent)
    expect(await habitRepo.listLive()).toEqual([])
  })

  it('refuses a blank name at the service boundary', async () => {
    const result = await execute({
      kind: 'habit.add',
      source: 'ui',
      raw: '',
      name: '   ',
      color: null,
    })
    expect(result.status).toBe('error')
    expect(await db.habits.count()).toBe(0)
  })

  it('treats a bare "/add habit" as a task called "habit"', async () => {
    // The qualifier needs something after it, exactly as `/add project` does.
    const result = await executeText('/add habit', context)
    if (result.status !== 'ok' || result.kind !== 'task') throw new Error('expected a task')
    expect(result.task.title).toBe('habit')
    expect(await db.habits.count()).toBe(0)
  })
})

describe('opening through the pipeline', () => {
  it('navigates to the habit it resolved', async () => {
    const habit = await createHabit('Reading')
    const result = await executeText('/habit reading', context)

    if (result.status !== 'ok' || result.kind !== 'navigate') throw new Error('expected navigate')
    expect(result.path).toBe(`/habits?habit=${habit.id}`)
  })

  it('asks rather than guessing when the name is ambiguous', async () => {
    await createHabit('Morning run')
    const evening = await createHabit('Evening run')

    const result = await executeText('/habit run', context)
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') return

    const resolved = await resolveChoice(result.intent, evening.id)
    if (resolved.status !== 'ok' || resolved.kind !== 'navigate') throw new Error('expected nav')
    expect(resolved.path).toContain(evening.id)
  })

  it('says so when nothing matches', async () => {
    await createHabit('Reading')
    expect((await executeText('/habit swimming', context)).status).toBe('not_found')
  })
})

describe('completion through the pipeline', () => {
  it('toggles today on and off, one event each way', async () => {
    const habit = await createHabit('Read')

    const on = await execute({ kind: 'habit.toggle', source: 'ui', raw: '', habitId: habit.id })
    expect(on.status).toBe('ok')
    expect(await db.habitEntries.count()).toBe(1)
    expect((await habitEntryRepo.forHabitOnDate(habit.id, TODAY))?.date).toBe(TODAY)

    await execute({ kind: 'habit.toggle', source: 'ui', raw: '', habitId: habit.id })
    expect(await db.habitEntries.count()).toBe(0)

    expect(await eventTypes()).toEqual([
      'habit.created',
      'habit.completed',
      'habit.uncompleted',
    ])
  })

  it('produces no second event when completed twice', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)
    await completeHabit(habit.id)

    const events = await eventRepo.list({ type: 'habit.completed' })
    expect(events).toHaveLength(1)
  })

  it('reports a habit that no longer exists rather than throwing', async () => {
    const result = await execute({
      kind: 'habit.toggle',
      source: 'ui',
      raw: '',
      habitId: 'nope',
    })
    expect(result.status).toBe('not_found')
  })
})

describe('archiving and deleting through the pipeline', () => {
  it('archives, keeps history, and undoes back', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    const archived = await execute({
      kind: 'habit.archive',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: habit.id },
    })
    if (archived.status !== 'ok' || archived.kind !== 'habit') throw new Error('expected ok')
    expect(archived.message).toContain('history kept')
    expect(await db.habitEntries.count()).toBe(1)

    const back = await execute(archived.undo as CommandIntent)
    if (back.status !== 'ok' || back.kind !== 'habit') throw new Error('expected ok')
    expect(back.habit.archivedAt).toBeNull()
  })

  it('deletes without destroying history, and restores it', async () => {
    const habit = await createHabit('Read')
    await completeHabit(habit.id)

    const deleted = await execute({
      kind: 'habit.delete',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: habit.id },
    })
    if (deleted.status !== 'ok' || deleted.kind !== 'habit') throw new Error('expected ok')
    expect(deleted.message).toContain('1 recorded day kept')
    expect(await db.habitEntries.count()).toBe(1)

    await execute(deleted.undo as CommandIntent)
    expect(await habitRepo.listLive()).toHaveLength(1)
    expect(await habitEntryRepo.countForHabit(habit.id)).toBe(1)
  })
})

describe('reading writes nothing', () => {
  it('leaves the log untouched when the summary is read', async () => {
    await createHabit('Read')
    const before = await eventRepo.count()

    await getTodayHabits()
    await getTodayHabits()

    expect(await eventRepo.count()).toBe(before)
  })
})

describe('the pipeline has no React in it', () => {
  const ROOT = resolve(__dirname, '..')
  const FILES = [
    'src/services/habitService.ts',
    'src/services/habitQueryService.ts',
    'src/services/habits/habitSchedule.ts',
    'src/services/habits/habitStats.ts',
    'src/repositories/habitRepo.ts',
  ]

  it('imports no UI framework anywhere in the habit domain', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const banned of ['react', 'react-dom', 'zustand', '@dnd-kit', 'lucide-react']) {
        if (new RegExp(`from '${banned}`).test(source)) offenders.push(`${file} imports ${banned}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps Dexie out of the habit services', () => {
    for (const file of ['src/services/habitService.ts', 'src/services/habitQueryService.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(/from 'dexie'/.test(source)).toBe(false)
      expect(/from '@\/db/.test(source)).toBe(false)
    }
  })
})
