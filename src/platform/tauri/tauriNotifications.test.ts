import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeTauriBridge, type FakeTauriBridge } from './fakeBridge'
import { createTauriNotifications } from './tauriNotifications'

let bridge: FakeTauriBridge

beforeEach(() => {
  bridge = createFakeTauriBridge()
})

describe('desktop notifications', () => {
  it('is supported, unlike the web adapter with the window closed', () => {
    expect(createTauriNotifications(bridge).isSupported).toBe(true)
  })

  it('reports default before anything has asked, not denied', async () => {
    // Reporting a refusal the user never gave would hide the button that asks.
    expect(createTauriNotifications(bridge).permission()).toBe('default')
  })

  it('reports granted once the grant has been read', async () => {
    const notifications = createTauriNotifications(bridge)
    await notifications.prime()

    expect(notifications.permission()).toBe('granted')
  })

  it('reports denied when the OS has refused', async () => {
    bridge.setNotificationsGranted(false)
    const notifications = createTauriNotifications(bridge)
    await notifications.prime()

    expect(notifications.permission()).toBe('denied')
  })

  it('sends the notification', async () => {
    const notifications = createTauriNotifications(bridge)
    await notifications.notify('Vaultwork', 'Desktop notifications are working.')

    expect(bridge.sent).toEqual([
      { title: 'Vaultwork', body: 'Desktop notifications are working.' },
    ])
  })

  it('asks for permission on the first send rather than needing a separate step', async () => {
    const notifications = createTauriNotifications(bridge)
    await notifications.notify('Vaultwork', 'Hello')

    expect(bridge.calls).toContain('notificationPermission')
    expect(bridge.sent).toHaveLength(1)
  })

  it('sends nothing when permission is refused', async () => {
    bridge.setNotificationsGranted(false)
    const notifications = createTauriNotifications(bridge)

    await notifications.notify('Vaultwork', 'Hello')
    expect(bridge.sent).toEqual([])
  })

  it('records a refusal from requestPermission', async () => {
    bridge.setNotificationsGranted(false)
    const notifications = createTauriNotifications(bridge)

    expect(await notifications.requestPermission()).toBe('denied')
    expect(notifications.permission()).toBe('denied')
  })

  it('never throws when the bridge fails — a failed notification is not an error worth raising', async () => {
    const notifications = createTauriNotifications(bridge)
    await notifications.prime()
    bridge.failNext('notify', { kind: 'write-failed', message: 'x', path: null })

    await expect(notifications.notify('Vaultwork', 'Hello')).resolves.toBeUndefined()
  })

  it('treats a failing permission check as denied rather than crashing start-up', async () => {
    bridge.failNext('notificationPermission', { kind: 'read-failed', message: 'x', path: null })
    const notifications = createTauriNotifications(bridge)
    await notifications.prime()

    expect(notifications.permission()).toBe('denied')
  })
})
