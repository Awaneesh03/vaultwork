import { beforeEach, describe, expect, it } from 'vitest'
import { ConstraintError } from '@/lib/errors'
import { messageLogRepo } from '@/repositories'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

/**
 * This is the guarantee the future Telegram channel depends on. Telegram
 * redelivers any update whose cursor was not advanced — which happens every
 * time the app dies between reading a message and committing it. Exactly-once
 * effects come from the unique [source+externalId] index, not from a
 * check-then-insert, which would still race itself.
 */
describe('idempotency', () => {
  it('records a message once', async () => {
    const first = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '9001',
      text: 'Study Java tomorrow at 7pm #college !high ~45m',
    })

    expect(first.created).toBe(true)
    expect(first.record.status).toBe('pending')
    expect(await messageLogRepo.count()).toBe(1)
  })

  it('returns the original row when the same update is redelivered', async () => {
    const first = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '9001',
      text: 'Study Java tomorrow',
    })
    const replay = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '9001',
      text: 'Study Java tomorrow',
    })

    expect(replay.created).toBe(false)
    expect(replay.record.id).toBe(first.record.id)
    expect(await messageLogRepo.count()).toBe(1)
  })

  it('is not fooled by different text under the same external id', async () => {
    await messageLogRepo.appendIfNew({ source: 'telegram', externalId: '42', text: 'original' })
    const replay = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '42',
      text: 'edited by an attacker',
    })

    expect(replay.created).toBe(false)
    expect(replay.record.text).toBe('original')
    expect(await messageLogRepo.count()).toBe(1)
  })

  it('keeps distinct external ids apart', async () => {
    await messageLogRepo.appendIfNew({ source: 'telegram', externalId: '1', text: 'one' })
    await messageLogRepo.appendIfNew({ source: 'telegram', externalId: '2', text: 'two' })
    expect(await messageLogRepo.count()).toBe(2)
  })

  it('survives a concurrent double delivery', async () => {
    const results = await Promise.all([
      messageLogRepo.appendIfNew({ source: 'telegram', externalId: '77', text: 'race' }),
      messageLogRepo.appendIfNew({ source: 'telegram', externalId: '77', text: 'race' }),
    ])

    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(await messageLogRepo.count()).toBe(1)
  })

  it('rejects a duplicate outright through the strict variant', async () => {
    await messageLogRepo.append({ source: 'telegram', externalId: '5', text: 'first' })
    await expect(
      messageLogRepo.append({ source: 'telegram', externalId: '5', text: 'second' }),
    ).rejects.toBeInstanceOf(ConstraintError)
  })
})

describe('processing state', () => {
  it('moves a message to done and records what it produced', async () => {
    const { record } = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '11',
      text: '/add Study Java',
    })
    const taskId = crypto.randomUUID()

    const done = await messageLogRepo.markProcessed(record.id, { entityType: 'task', entityId: taskId })

    expect(done.status).toBe('done')
    expect(done.resultEntityId).toBe(taskId)
    expect(await messageLogRepo.listByStatus('pending')).toHaveLength(0)
  })

  it('keeps a failure visible with its reason', async () => {
    const { record } = await messageLogRepo.appendIfNew({
      source: 'telegram',
      externalId: '12',
      text: '/nonsense',
    })

    const failed = await messageLogRepo.markFailed(record.id, 'Unrecognised command')

    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('Unrecognised command')
    expect((await messageLogRepo.listByStatus('failed')).map((m) => m.id)).toEqual([record.id])
  })
})
