import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform, type MenuAction, type MenuPort } from '@/platform'
import { taskRepo } from '@/repositories'
import { useCommands } from '@/hooks/useCommands'
import { useGlobalShortcuts } from '@/app/shortcuts/useGlobalShortcuts'
import { useToastStore } from '@/store/toastStore'
import { taskInput } from '../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../tests/helpers'
import { useNativeMenu } from './useNativeMenu'

/**
 * Cmd+Z on the desktop.
 *
 * The bug these cover: M13's Edit menu used the *predefined* macOS Undo item,
 * which carries the Cmd+Z key equivalent. AppKit resolves a menu's key
 * equivalents before the event reaches the WebView, so the web layer's own
 * Cmd+Z handler — and with it the application's undo stack — became
 * unreachable from the keyboard on desktop while continuing to work in a
 * browser. The item is now custom and forwards to the renderer.
 *
 * What matters is that there is still exactly **one** undo stack. The toast,
 * the keyboard and the menu are three doors into the same room, and these
 * tests keep them that way.
 */

const NOW = new Date(2026, 8, 7, 10, 0, 0)

/** The menu port a desktop build resolves, with a handle to fire items. */
function installFakeMenu(): { emit: (action: MenuAction) => void; subscribers: number } {
  const handlers = new Set<(action: MenuAction) => void>()
  const fake: MenuPort = {
    isSupported: true,
    async subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  Object.defineProperty(platform, 'menu', { value: fake, configurable: true, writable: true })
  return {
    emit: (action) => handlers.forEach((handler) => handler(action)),
    get subscribers() {
      return handlers.size
    },
  }
}

const browserMenu = platform.menu

afterEach(() => {
  Object.defineProperty(platform, 'menu', {
    value: browserMenu,
    configurable: true,
    writable: true,
  })
})

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useToastStore.setState({ toasts: [], undoStack: [] })
})

/**
 * A screen with the real shortcut and menu wiring on it.
 *
 * The buttons dispatch through `useCommands`, exactly as a real view does, so
 * nothing here reaches around the command layer to set up its own state.
 */
function Harness() {
  useGlobalShortcuts()
  useNativeMenu()
  const { dispatch } = useCommands()

  return (
    <div>
      <button
        onClick={() =>
          void dispatch({
            kind: 'task.delete',
            source: 'ui',
            raw: '',
            ref: { by: 'text', query: 'Study Binary Trees' },
          })
        }
      >
        Delete task
      </button>
      <button
        onClick={() =>
          void dispatch({
            kind: 'task.complete',
            source: 'ui',
            raw: '',
            ref: { by: 'text', query: 'Study Binary Trees' },
          })
        }
      >
        Complete task
      </button>
      <button
        onClick={() =>
          void dispatch({
            kind: 'task.complete',
            source: 'palette',
            raw: '/done Study Binary Trees',
            ref: { by: 'text', query: 'Study Binary Trees' },
          })
        }
      >
        Complete from palette
      </button>
      <input aria-label="a field" />
      <textarea aria-label="a note body" />
      <div aria-label="a rich editor" contentEditable suppressContentEditableWarning />
    </div>
  )
}

const mount = () =>
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )

const pressUndo = (target: Element | Document = document.body) =>
  fireEvent.keyDown(target, { key: 'z', metaKey: true })

const seedTask = () => taskRepo.create(taskInput())

const titleOf = async () => (await taskRepo.listLive()).map((task) => task.title)

// --------------------------------------------------------------- A. browser

describe('A. the browser is unchanged', () => {
  it('subscribes to no menu, because a tab has no menu bar', async () => {
    const subscribe = vi.spyOn(platform.menu, 'subscribe')
    mount()

    await waitFor(() => expect(screen.getByText('Delete task')).toBeTruthy())
    expect(platform.menu.isSupported).toBe(false)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('undoes a destructive action with Cmd+Z, through the existing stack', async () => {
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))
    expect(await titleOf()).toEqual([])

    pressUndo()

    await waitFor(async () => expect(await titleOf()).toEqual(['Study Binary Trees']))
    // Popped, not copied: one press, one undo.
    expect(useToastStore.getState().undoStack).toHaveLength(0)
  })

  it('keeps a completion off the Cmd+Z stack, which is M3 behaviour and not M13 business', async () => {
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Complete task'))
    await waitFor(async () => {
      const tasks = await taskRepo.listLive()
      expect(tasks[0]?.status).toBe('done')
    })

    // Completing a task is deliberately *not* on the Cmd+Z stack:
    // `DESTRUCTIVE` in useCommands lists deletes and archives only. Cmd+Z has
    // therefore never undone a completion, in either runtime, and M13 does not
    // change that — reversing it is the toast's job.
    expect(useToastStore.getState().undoStack).toHaveLength(0)

    pressUndo()
    await waitFor(async () => {
      const tasks = await taskRepo.listLive()
      expect(tasks[0]?.status).toBe('done')
    })
  })

  it('offers Undo on the toast when a completion has no visible row to speak for it', async () => {
    await seedTask()
    mount()

    // A completion clicked in a list stays quiet because the row changes under
    // the cursor; one typed into the palette announces itself, and that toast
    // carries the reversal.
    fireEvent.click(screen.getByText('Complete from palette'))
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))

    expect(useToastStore.getState().toasts[0]?.action).toMatchObject({
      label: 'Undo',
      intent: { kind: 'task.uncomplete' },
    })
  })
})

// ----------------------------------------------------------------- B. tauri

describe('B. the desktop routes Cmd+Z to the same undo', () => {
  it('undoes through the menu when the caret is not in a field', async () => {
    const menu = installFakeMenu()
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))
    await waitFor(() => expect(menu.subscribers).toBe(1))

    // Exactly what Cmd+Z and Edit ▸ Undo both deliver on macOS.
    menu.emit('undo')

    await waitFor(async () => expect(await titleOf()).toEqual(['Study Binary Trees']))
    expect(useToastStore.getState().undoStack).toHaveLength(0)
  })

  it('drives the same stack the toast does, not a second one', async () => {
    const menu = installFakeMenu()
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))
    await waitFor(() => expect(menu.subscribers).toBe(1))

    menu.emit('undo')
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(0))

    // A second press has nothing left to undo, which is the proof that the
    // menu popped the shared stack rather than keeping its own.
    menu.emit('undo')
    await waitFor(async () => expect(await titleOf()).toEqual(['Study Binary Trees']))
  })

  it('still lets the existing Undo toast do its job', async () => {
    installFakeMenu()
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))

    // The toast is untouched by this fix: same label, same intent, still the
    // reversal the command layer produced.
    expect(useToastStore.getState().toasts[0]?.action).toMatchObject({
      label: 'Undo',
      intent: { kind: 'task.restore' },
    })
  })

  it('unsubscribes on unmount, so a remount does not undo twice', async () => {
    const menu = installFakeMenu()
    const view = mount()

    await waitFor(() => expect(menu.subscribers).toBe(1))
    view.unmount()
    expect(menu.subscribers).toBe(0)
  })
})

// --------------------------------------------------------- C. editing text

describe('C. typing keeps its own undo', () => {
  const FIELDS = ['a field', 'a note body', 'a rich editor'] as const

  it.each(FIELDS)('leaves Cmd+Z alone inside %s, in the browser', async (label) => {
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))

    const field = screen.getByLabelText(label)
    field.focus()
    pressUndo(field)

    // Untouched: the keystroke belonged to the text, so the task stays deleted
    // and the reversal stays on the stack for later.
    expect(useToastStore.getState().undoStack).toHaveLength(1)
    expect(await titleOf()).toEqual([])
  })

  it.each(FIELDS)('leaves the application stack alone inside %s, on desktop', async (label) => {
    const menu = installFakeMenu()
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))
    await waitFor(() => expect(menu.subscribers).toBe(1))

    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    const field = screen.getByLabelText(label)
    field.focus()
    menu.emit('undo')

    // The caret is in a field, so the undo went to WebKit's editing stack.
    expect(execCommand).toHaveBeenCalledWith('undo')
    expect(useToastStore.getState().undoStack).toHaveLength(1)
    expect(await titleOf()).toEqual([])
  })

  it('undoes the application once the caret leaves the field', async () => {
    const menu = installFakeMenu()
    await seedTask()
    mount()

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => expect(useToastStore.getState().undoStack).toHaveLength(1))
    await waitFor(() => expect(menu.subscribers).toBe(1))

    const field = screen.getByLabelText('a note body')
    field.focus()
    field.blur()
    menu.emit('undo')

    await waitFor(async () => expect(await titleOf()).toEqual(['Study Binary Trees']))
  })
})
