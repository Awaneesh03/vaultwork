import { beforeEach, describe, expect, it } from 'vitest'
import { eventToCombo, isDragHandleTarget, isEditableTarget } from './useHotkey'

/**
 * The two guards every keyboard layer in the application sits behind.
 *
 * They are the reason a keyboard-driven app stays usable: one keeps typing from
 * triggering navigation, the other keeps a drag from triggering the list it is
 * reordering. Both are worth pinning, because a regression in either shows up
 * as "the app randomly did something else" rather than as an error.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

const make = (html: string): HTMLElement => {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

describe('isEditableTarget', () => {
  it('is true for the fields a person types into', () => {
    for (const html of ['<input />', '<textarea></textarea>', '<select></select>']) {
      expect(isEditableTarget(make(html))).toBe(true)
    }
  })

  it('is true inside a contenteditable region, not just on it', () => {
    const root = make('<div contenteditable="true"><span>text</span></div>')
    expect(isEditableTarget(root)).toBe(true)
    expect(isEditableTarget(root.querySelector('span'))).toBe(true)
  })

  it('is false for a button, a div and a null target', () => {
    expect(isEditableTarget(make('<button></button>'))).toBe(false)
    expect(isEditableTarget(make('<div></div>'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('isDragHandleTarget', () => {
  it('is true for either activator dnd-kit owns', () => {
    // "sortable" for a reorderable list, "draggable" for a free drag such as
    // the calendar's task chips. Both are drags; both own their keys.
    for (const role of ['sortable', 'draggable']) {
      const handle = make(`<button aria-roledescription="${role}">grip</button>`)
      expect(isDragHandleTarget(handle)).toBe(true)
    }
  })

  it('is true for anything inside one, since the icon receives the event', () => {
    const handle = make('<button aria-roledescription="sortable"><svg></svg></button>')
    expect(isDragHandleTarget(handle.querySelector('svg'))).toBe(true)
  })

  it('is false for every other control in a row', () => {
    const row = make(
      '<div><button aria-label="Edit">e</button><input /><span>text</span></div>',
    )
    for (const node of row.children) {
      expect(isDragHandleTarget(node as HTMLElement)).toBe(false)
    }
    expect(isDragHandleTarget(null)).toBe(false)
  })

  it('does not confuse a different roledescription for a drag handle', () => {
    expect(isDragHandleTarget(make('<button aria-roledescription="button">x</button>'))).toBe(
      false,
    )
  })
})

describe('eventToCombo', () => {
  it('normalises a plain key, a modified key and a named key', () => {
    const combo = (init: KeyboardEventInit) => eventToCombo(new KeyboardEvent('keydown', init))
    expect(combo({ key: 'K' })).toBe('k')
    expect(combo({ key: 'k', metaKey: true })).toBe('mod+k')
    expect(combo({ key: 'k', ctrlKey: true })).toBe('mod+k')
    expect(combo({ key: 'Escape' })).toBe('escape')
    expect(combo({ key: 'ArrowDown', shiftKey: true })).toBe('shift+arrowdown')
  })
})
