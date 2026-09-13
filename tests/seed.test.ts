import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, maintenanceRepo, projectRepo, taskRepo } from '@/repositories'
import { resetDatabase } from './helpers'

beforeEach(resetDatabase)

describe('seeding', () => {
  it('fills an empty database with usable data', async () => {
    const result = await maintenanceRepo.seedIfEmpty(new Date(2026, 8, 3))

    expect(result.seeded).toBe(true)
    expect(await taskRepo.count()).toBeGreaterThan(5)
    expect(await projectRepo.count()).toBe(3)

    const overdue = await taskRepo.overdue('2026-09-03')
    const today = await taskRepo.dueOn('2026-09-03')
    expect(overdue.length).toBeGreaterThan(0)
    expect(today.length).toBeGreaterThan(0)
  })

  it('refuses to touch a database that already has data', async () => {
    await maintenanceRepo.seedIfEmpty(new Date(2026, 8, 3))
    const before = await maintenanceRepo.counts()

    const second = await maintenanceRepo.seedIfEmpty(new Date(2026, 8, 3))

    expect(second.seeded).toBe(false)
    expect(await maintenanceRepo.counts()).toEqual(before)
  })

  it('writes one marker event rather than fabricating history', async () => {
    await maintenanceRepo.seedIfEmpty(new Date(2026, 8, 3))
    const events = await eventRepo.list()

    // Seeded rows must not look like a busy first day in the analytics.
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('app.seeded')
  })
})
