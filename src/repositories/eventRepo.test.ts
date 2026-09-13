import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { eventRepo, taskRepo } from '@/repositories'
import { taskInput } from '../../tests/factories'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

describe('append', () => {
  it('stores an event with an id, an instant and a source', async () => {
    const event = await eventRepo.append({
      type: 'focus.completed',
      entityType: 'focusSession',
      entityId: null,
      source: 'ui',
      payload: { minutes: 25 },
    })

    expect(event.at).toBeTypeOf('number')
    expect(await eventRepo.count()).toBe(1)
    expect((await eventRepo.list())[0]).toMatchObject({
      type: 'focus.completed',
      source: 'ui',
      payload: { minutes: 25 },
    })
  })

  it('filters by time window and by type, newest first', async () => {
    await eventRepo.append({ type: 'task.created', entityType: 'task', source: 'ui', at: 1_000 })
    await eventRepo.append({ type: 'task.completed', entityType: 'task', source: 'ui', at: 2_000 })
    await eventRepo.append({ type: 'task.created', entityType: 'task', source: 'ai', at: 3_000 })

    expect((await eventRepo.list()).map((e) => e.at)).toEqual([3_000, 2_000, 1_000])
    expect(await eventRepo.list({ since: 2_000 })).toHaveLength(2)
    expect(await eventRepo.list({ type: 'task.created' })).toHaveLength(2)
    expect(await eventRepo.list({ limit: 1 })).toHaveLength(1)
  })
})

describe('immutability', () => {
  /**
   * Analytics is only trustworthy if history cannot be rewritten. The guard is
   * a Dexie hook rather than a convention, so these tests go straight at the
   * table — the strongest form of the assertion available.
   */
  it('rejects an update to a stored event', async () => {
    const event = await eventRepo.append({ type: 'task.created', entityType: 'task', source: 'ui' })

    await expect(db.events.update(event.id, { type: 'task.deleted' })).rejects.toThrow(
      /append-only/,
    )
    expect((await eventRepo.list())[0]?.type).toBe('task.created')
  })

  it('rejects a put over an existing event', async () => {
    const event = await eventRepo.append({ type: 'habit.checked', entityType: 'habit', source: 'ui' })

    await expect(db.events.put({ ...event, source: 'ai' })).rejects.toThrow(/append-only/)
    expect((await eventRepo.list())[0]?.source).toBe('ui')
  })

  it('rejects a delete', async () => {
    const event = await eventRepo.append({ type: 'task.created', entityType: 'task', source: 'ui' })

    await expect(db.events.delete(event.id)).rejects.toThrow(/append-only/)
    expect(await eventRepo.count()).toBe(1)
  })

  it('exposes no way to mutate history through the repository', () => {
    expect('update' in eventRepo).toBe(false)
    expect('delete' in eventRepo).toBe(false)
    expect('softDelete' in eventRepo).toBe(false)
  })
})

describe('transactional emission', () => {
  it('never leaves an event behind when the write it describes fails', async () => {
    const task = await taskRepo.create(taskInput())
    const eventsBefore = await eventRepo.count()

    await expect(taskRepo.create({ ...taskInput(), id: task.id })).rejects.toThrow()

    // The duplicate insert aborted the transaction, taking its event with it.
    expect(await eventRepo.count()).toBe(eventsBefore)
  })
})
