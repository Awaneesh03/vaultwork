import { beforeEach, describe, expect, it } from 'vitest'
import { isMenuAction, MENU_ACTIONS, type MenuAction } from '../ports'
import { noMenu } from '../browser/noMenu'
import { createFakeTauriBridge, type FakeTauriBridge } from './fakeBridge'
import { createTauriMenu } from './tauriMenu'

let bridge: FakeTauriBridge

beforeEach(() => {
  bridge = createFakeTauriBridge()
})

describe('the native menu port', () => {
  it('delivers a known action to the subscriber', async () => {
    const seen: MenuAction[] = []
    await createTauriMenu(bridge).subscribe((action) => seen.push(action))

    bridge.emitMenu('new-note')
    expect(seen).toEqual(['new-note'])
  })

  it('delivers every action the native menu can emit', async () => {
    const seen: MenuAction[] = []
    await createTauriMenu(bridge).subscribe((action) => seen.push(action))

    for (const action of MENU_ACTIONS) bridge.emitMenu(action)
    expect(seen).toEqual([...MENU_ACTIONS])
  })

  it('ignores ids the web layer does not know', async () => {
    // Quit, Copy and Fullscreen are handled natively and never need to reach
    // React; an unknown id is dropped rather than guessed at.
    const seen: string[] = []
    await createTauriMenu(bridge).subscribe((action) => seen.push(action))

    bridge.emitMenu('quit')
    bridge.emitMenu('something-invented')
    expect(seen).toEqual([])
  })

  it('stops delivering after unsubscribe', async () => {
    const seen: string[] = []
    const off = await createTauriMenu(bridge).subscribe((action) => seen.push(action))

    off()
    bridge.emitMenu('new-note')
    expect(seen).toEqual([])
  })

  it('recognises exactly the closed set of actions', () => {
    expect(isMenuAction('new-note')).toBe(true)
    expect(isMenuAction('go-notes')).toBe(true)
    expect(isMenuAction('delete-everything')).toBe(false)
    expect(isMenuAction('')).toBe(false)
  })
})

describe('the browser has no menu bar', () => {
  it('reports itself unsupported', () => {
    expect(noMenu.isSupported).toBe(false)
  })

  it('subscribes without firing and unsubscribes cleanly', async () => {
    const seen: string[] = []
    const off = await noMenu.subscribe((action) => seen.push(action))

    expect(seen).toEqual([])
    expect(() => off()).not.toThrow()
  })
})
