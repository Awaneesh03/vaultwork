import { liveQuery } from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { eventRepo, settingsRepo } from '@/repositories'
import { getSettings, resolveTheme, updateSettings } from './settingsService'
import { resetDatabase } from '../../tests/helpers'

beforeEach(resetDatabase)

describe('resolveTheme', () => {
  it('follows the OS only when the preference is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('settings', () => {
  it('creates the singleton on first read so nothing downstream sees null', async () => {
    const settings = await getSettings()

    expect(settings.id).toBe('singleton')
    expect(settings.theme).toBe('system')
    expect(settings.pomodoro).toEqual({
      workMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      cyclesBeforeLongBreak: 4,
    })
    expect(settings.schemaVersion).toBeGreaterThan(0)
  })

  it('returns the same row on a second read', async () => {
    const first = await getSettings()
    const second = await getSettings()
    expect(second.createdAt).toBe(first.createdAt)
  })

  it('records an event when settings change', async () => {
    await getSettings()
    const updated = await updateSettings({ dailyTaskGoal: 8 })

    expect(updated.dailyTaskGoal).toBe(8)
    const [event] = await eventRepo.list()
    expect(event).toMatchObject({
      type: 'settings.updated',
      entityType: 'settings',
      payload: { fields: ['dailyTaskGoal'] },
    })
  })
})

describe('reading settings inside a live query', () => {
  it('does not attempt a write, so a liveQuery can call it', async () => {
    // Dexie runs a querier in a read-only transaction: a getter that lazily
    // created its own row threw ReadOnlyError here and took the whole screen
    // down with it.
    const settings = await new Promise((resolve, reject) => {
      const subscription = liveQuery(() => getSettings()).subscribe({
        next: (value) => {
          subscription.unsubscribe()
          resolve(value)
        },
        error: (error) => {
          subscription.unsubscribe()
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      })
    })

    expect(settings).toMatchObject({ id: 'singleton', weekStartsOn: 1 })
  })

  it('writes nothing on a read, and ensure() is what creates the row', async () => {
    await getSettings()
    expect(await db.settings.count()).toBe(0)

    await settingsRepo.ensure()
    expect(await db.settings.count()).toBe(1)

    // And a second ensure is idempotent.
    await settingsRepo.ensure()
    expect(await db.settings.count()).toBe(1)
  })
})
