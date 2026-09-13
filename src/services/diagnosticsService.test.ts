import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platform } from '@/platform'
import { resetDatabase } from '../../tests/helpers'
import { createNote } from './noteService'
import { getDiagnostics, sendTestNotification } from './diagnosticsService'

/**
 * The diagnostics panel and the one notification M13 sends.
 *
 * Both exist to answer questions honestly rather than optimistically, so the
 * tests are mostly about the honest-but-unhappy paths: a refused permission
 * must be reported as refused, not swallowed.
 */

beforeEach(async () => {
  await resetDatabase()
})

describe('diagnostics', () => {
  it('reports the runtime this build is actually in', async () => {
    const report = await getDiagnostics()

    // The test process is not a Tauri WebView, and the report says so rather
    // than reading a build-time flag.
    expect(report.runtime).toBe('browser')
  })

  it('names the vault adapter in use', async () => {
    const report = await getDiagnostics()
    expect(report.vaultAdapter).toBe(platform.vault.id)
  })

  it('names the database and its schema version', async () => {
    const report = await getDiagnostics()

    expect(report.database.name).toBeTruthy()
    expect(report.database.schemaVersion).toBeGreaterThan(0)
  })

  it('counts what is actually stored', async () => {
    const before = await getDiagnostics()
    await createNote({ title: 'Counted', body: 'x' })
    const after = await getDiagnostics()

    expect(after.database.records).toBeGreaterThan(before.database.records)
  })

  it('reports storage persistence without throwing where it is unsupported', async () => {
    const report = await getDiagnostics()

    expect(typeof report.storage.persistence.persisted).toBe('boolean')
  })
})

describe('the test notification', () => {
  it('refuses honestly when the build cannot show notifications', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(false)

    const result = await sendTestNotification()
    expect(result).toEqual({ ok: false, text: 'This build cannot show notifications.' })
  })

  it('says so when the user has blocked notifications, rather than pretending to send', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('denied')
    const notify = vi.spyOn(platform.notifications, 'notify')

    const result = await sendTestNotification()

    expect(result.ok).toBe(false)
    expect(result.text).toContain('blocked')
    expect(notify).not.toHaveBeenCalled()
  })

  it('asks for permission when it has not been granted yet', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('default')
    const ask = vi.spyOn(platform.notifications, 'requestPermission').mockResolvedValue('granted')
    const notify = vi.spyOn(platform.notifications, 'notify').mockResolvedValue()

    const result = await sendTestNotification()

    expect(ask).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(notify).toHaveBeenCalled()
  })

  it('sends nothing when permission is refused at the prompt', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('default')
    vi.spyOn(platform.notifications, 'requestPermission').mockResolvedValue('denied')
    const notify = vi.spyOn(platform.notifications, 'notify')

    const result = await sendTestNotification()

    expect(result.ok).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('sends exactly the message the milestone specifies', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('granted')
    const notify = vi.spyOn(platform.notifications, 'notify').mockResolvedValue()

    const result = await sendTestNotification()

    expect(notify).toHaveBeenCalledWith('Vaultwork', 'Desktop notifications are working.')
    expect(result.ok).toBe(true)
  })

  it('tells a browser user the notification only lasts while the tab is open', async () => {
    vi.spyOn(platform.notifications, 'isSupported', 'get').mockReturnValue(true)
    vi.spyOn(platform.notifications, 'permission').mockReturnValue('granted')
    vi.spyOn(platform.notifications, 'notify').mockResolvedValue()

    const result = await sendTestNotification()

    // A browser build must not claim the desktop guarantee.
    expect(result.text).toContain('browser tab')
  })
})
