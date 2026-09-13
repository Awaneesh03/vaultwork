import { beforeEach, describe, expect, it } from 'vitest'
import { createMemorySnapshotStore } from '@/platform'
import { habitRepo, maintenanceRepo, messageLogRepo, projectRepo, taskRepo } from '@/repositories'
import {
  createSnapshot,
  exportBackup,
  importBackup,
  listSnapshots,
  parseBackup,
  pruneSnapshots,
  restoreSnapshot,
  serializeBackup,
} from './backupService'
import { projectInput, taskInput } from '../../tests/factories'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

async function populate() {
  const project = await projectRepo.create(projectInput())
  const task = await taskRepo.create(
    taskInput({ title: 'Study Binary Trees', projectId: project.id, dueDate: '2026-09-03' }),
  )
  await habitRepo.create({
    name: 'Study',
    color: 'teal',
    cadence: 'daily',
    daysOfWeek: [],
    targetPerWeek: null,
    kind: 'quantity',
    unit: 'minutes',
    target: 90,
    sortOrder: 1000,
    archivedAt: null,
  })
  await messageLogRepo.appendIfNew({ source: 'telegram', externalId: '1', text: 'hello' })
  return { project, task }
}

describe('export', () => {
  it('captures every store with a checksum over the data', async () => {
    await populate()
    const backup = await exportBackup()

    expect(backup.format).toBe('vaultwork.backup')
    expect(backup.formatVersion).toBe(1)
    expect(backup.data.tasks).toHaveLength(1)
    expect(backup.data.projects).toHaveLength(1)
    expect(backup.data.events.length).toBeGreaterThan(0)
    expect(backup.counts.tasks).toBe(1)
    expect(backup.checksum).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces JSON that parses back to an identical structure', async () => {
    await populate()
    const backup = await exportBackup()
    const text = serializeBackup(backup)

    expect(() => JSON.parse(text)).not.toThrow()
    expect(JSON.parse(text)).toEqual(backup)
  })
})

describe('round trip', () => {
  it('restores every row after the database has been wiped', async () => {
    const { task } = await populate()
    const before = await maintenanceRepo.counts()
    const text = serializeBackup(await exportBackup())

    await maintenanceRepo.clearAll()
    expect(await taskRepo.count()).toBe(0)

    const result = await importBackup(text, { snapshotFirst: false })
    expect(result.ok).toBe(true)

    expect(await maintenanceRepo.counts()).toEqual(before)
    const restored = await taskRepo.get(task.id)
    expect(restored).toMatchObject({
      title: 'Study Binary Trees',
      dueDate: '2026-09-03',
      createdAt: task.createdAt,
    })
  })

  it('restores history, including the event log', async () => {
    await populate()
    const text = serializeBackup(await exportBackup())
    const eventsBefore = (await maintenanceRepo.counts()).events

    await maintenanceRepo.clearAll()
    await importBackup(text, { snapshotFirst: false })

    expect((await maintenanceRepo.counts()).events).toBe(eventsBefore)
  })

  it('keeps the unique index working after an import', async () => {
    await populate()
    const text = serializeBackup(await exportBackup())
    await maintenanceRepo.clearAll()
    await importBackup(text, { snapshotFirst: false })

    const replay = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '1',
      text: 'hello',
    })
    expect(replay.created).toBe(false)
  })

  it('replaces rather than merges, leaving nothing from before', async () => {
    await populate()
    const text = serializeBackup(await exportBackup())

    const extra = await taskRepo.create(taskInput({ title: 'Added after the export' }))
    await importBackup(text, { snapshotFirst: false })

    expect(await taskRepo.get(extra.id)).toBeUndefined()
    expect(await taskRepo.count()).toBe(1)
  })
})

describe('validation', () => {
  it('rejects text that is not JSON', () => {
    const result = parseBackup('not json at all')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/not valid JSON/)
  })

  it('rejects JSON that is not a Vaultwork backup', () => {
    const result = parseBackup(JSON.stringify({ hello: 'world' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/not a Vaultwork backup/)
  })

  it('rejects a future format version', async () => {
    await populate()
    const backup = { ...(await exportBackup()), formatVersion: 2 }
    const result = parseBackup(JSON.stringify(backup))
    expect(result.ok).toBe(false)
  })

  it('rejects a file with a store missing', async () => {
    await populate()
    const backup = await exportBackup()
    const broken = JSON.parse(serializeBackup(backup)) as Record<string, Record<string, unknown>>
    delete broken.data?.habits
    const result = parseBackup(JSON.stringify(broken))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/missing the "habits" store/)
  })

  it('rejects a tampered file through the checksum', async () => {
    await populate()
    const backup = await exportBackup()
    backup.data.tasks[0]!.title = 'Quietly edited'
    const result = parseBackup(JSON.stringify(backup))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/checksum/)
  })

  it('leaves the database untouched when validation fails', async () => {
    const { task } = await populate()
    const result = await importBackup('{"format":"nope"}')

    expect(result.ok).toBe(false)
    expect(await taskRepo.get(task.id)).toBeDefined()
  })
})

describe('snapshots', () => {
  it('writes a snapshot that can be restored', async () => {
    const store = createMemorySnapshotStore()
    const { task } = await populate()

    const snapshot = await createSnapshot('test', new Date(), store)
    expect(snapshot.ok).toBe(true)

    await taskRepo.softDelete(task.id)
    await taskRepo.create(taskInput({ title: 'Noise' }))

    if (!snapshot.ok) throw snapshot.error
    const restored = await restoreSnapshot(snapshot.value.id, store)

    expect(restored.ok).toBe(true)
    expect(await taskRepo.get(task.id)).toBeDefined()
    expect(await taskRepo.count()).toBe(1)
  })

  it('keeps only the newest snapshots', async () => {
    const store = createMemorySnapshotStore()
    await populate()

    for (let i = 0; i < 5; i += 1) {
      await store.save(`2026-09-0${i + 1}-00-00-00-auto`, '{}')
    }
    const pruned = await pruneSnapshots(3, store)

    expect(pruned).toBe(2)
    expect(await listSnapshots(store)).toHaveLength(3)
  })
})
