import { beforeEach, describe, expect, it } from 'vitest'
import { buildAiContext, serializeAiContext } from '@/ai/context/aiContextBuilder'
import { createNote } from '../noteService'
import { createProject } from '../projectService'
import { createTask } from '../taskService'
import { resetDatabase, freezeClock } from '../../../tests/helpers'
import { readAiSource } from './aiReadModel'

/**
 * The adapter between the application and the AI context layer.
 *
 * Driven against the real database and the real query services, because that is
 * the half the pure builder tests cannot cover: the builder proves that a note
 * body *cannot* be projected, and this proves that a real note body does not
 * arrive at the projection in the first place.
 *
 * The clock is frozen, so "today" is a fact rather than the day the suite runs.
 */

const NOW = new Date(2026, 8, 5, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('the snapshot', () => {
  it('reads the date from the clock port rather than the wall clock', async () => {
    const source = await readAiSource('tasks')

    expect(source.today).toBe('2026-09-05')
    expect(source.now).toBe(NOW.getTime())
  })

  it('is empty and valid for a fresh installation', async () => {
    const source = await readAiSource('planning')

    expect(source.rankedOpenTasks).toEqual([])
    expect(source.counts.openTasks).toBe(0)
    expect(buildAiContext(source, 'planning').truncated).toEqual([])
  })

  it('carries open tasks with their project resolved by name', async () => {
    const project = await createProject('DSA Mastery')
    await createTask({ title: 'Revise Java collections', projectId: project.id, priority: 'high' })

    const context = buildAiContext(await readAiSource('tasks'), 'tasks')

    expect(context.tasks.map((task) => task.title)).toContain('Revise Java collections')
    expect(context.tasks[0]?.project).toBe('DSA Mastery')
  })

  it('lists each task once, even when it appears in two dashboard sections', async () => {
    await createTask({ title: 'Overdue thing', dueDate: '2026-09-01' })
    await createTask({ title: 'Today thing', dueDate: '2026-09-05' })

    const context = buildAiContext(await readAiSource('tasks'), 'tasks')
    const titles = context.tasks.map((task) => task.title)

    expect(new Set(titles).size).toBe(titles.length)
  })

  it('uses the application’s Next Action order, not one of its own', async () => {
    // Overdue outranks today, which outranks a later date — M5's rule, applied
    // here without being reimplemented.
    await createTask({ title: 'Later', dueDate: '2026-09-20' })
    await createTask({ title: 'Overdue', dueDate: '2026-09-01' })
    await createTask({ title: 'Today', dueDate: '2026-09-05' })

    const context = buildAiContext(await readAiSource('tasks'), 'tasks')

    expect(context.tasks.map((task) => task.title)).toEqual(['Overdue', 'Today', 'Later'])
  })

  it('never carries a real note’s body or excerpt', async () => {
    // The end-to-end version of the note policy: a real note, with real private
    // text in it, through the real query service.
    await createNote({
      title: 'Binary trees',
      body: 'PRIVATE-BODY-TEXT that must never reach a provider.',
    })

    const source = await readAiSource('planning')
    const json = serializeAiContext(buildAiContext(source, 'planning'))

    expect(json).toContain('Binary trees')
    expect(json).not.toContain('PRIVATE-BODY-TEXT')
    expect(JSON.stringify(source.notes)).not.toContain('PRIVATE-BODY-TEXT')
  })

  it('never carries a task’s vault path from a real row', async () => {
    await createTask({ title: 'Revise Java collections' })

    const json = serializeAiContext(buildAiContext(await readAiSource('planning'), 'planning'))

    expect(json).not.toContain('vaultPath')
    expect(json).not.toContain('.md')
  })

  it('never carries a database id from a real row', async () => {
    const project = await createProject('DSA Mastery')
    const created = await createTask({ title: 'Revise Java collections', projectId: project.id })

    const json = serializeAiContext(buildAiContext(await readAiSource('planning'), 'planning'))

    expect(json).not.toContain(created.id)
    expect(json).not.toContain(project.id)
  })

  it('reads without mutating: two reads see the same application', async () => {
    await createTask({ title: 'Revise Java collections' })

    const first = buildAiContext(await readAiSource('planning'), 'planning')
    const second = buildAiContext(await readAiSource('planning'), 'planning')

    // `now` is excluded deliberately: the test clock advances a millisecond per
    // call, so two reads *should* differ there. Everything describing the
    // application must not — reading context changes nothing.
    expect(serializeAiContext({ ...second, now: first.now })).toBe(serializeAiContext(first))
    expect(second.now).toBeGreaterThanOrEqual(first.now)
  })

  it('writes no event — reading context is not a mutation', async () => {
    const { eventRepo } = await import('@/repositories')
    await createTask({ title: 'Revise Java collections' })

    const before = (await eventRepo.list()).length
    await readAiSource('planning')
    await readAiSource('tasks')

    expect((await eventRepo.list()).length).toBe(before)
  })
})
