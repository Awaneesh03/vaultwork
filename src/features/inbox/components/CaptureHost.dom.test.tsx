import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { useGlobalShortcuts } from '@/app/shortcuts/useGlobalShortcuts'
import { listInbox } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useToastStore } from '@/store/toastStore'
import { useUiStore } from '@/store/uiStore'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { CaptureHost } from './CaptureHost'

/**
 * Capture from the keyboard alone (M18.3): I opens it, Enter keeps the text,
 * Escape closes it, and nothing is created until Accept.
 */

function Harness() {
  useGlobalShortcuts()
  return (
    <>
      <div>some other screen</div>
      <CaptureHost />
    </>
  )
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/analytics']}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(async () => {
  await resetDatabase()
  freezeClock(new Date(2026, 8, 21, 10, 0, 0))
  useUiStore.setState({ captureOpen: false })
  useTaskUiStore.setState({ quickAddOpen: false })
  useToastStore.setState({ toasts: [], undoStack: [] })
})

async function openAndType(text: string) {
  fireEvent.keyDown(window, { key: 'i' })
  const input = await screen.findByRole('textbox', { name: 'Capture anything' })
  fireEvent.change(input, { target: { value: text } })
  return input
}

describe('the capture dialog', () => {
  it('opens on I with the input focused', async () => {
    mount()
    fireEvent.keyDown(window, { key: 'i' })
    const input = await screen.findByRole('textbox', { name: 'Capture anything' })
    expect(screen.getByRole('dialog', { name: 'Capture' })).toBeTruthy()
    expect(document.activeElement).toBe(input)
  })

  it('keeps the text on Enter and shows what it thinks it is', async () => {
    mount()
    const input = await openAndType('Submit DBMS assignment Friday')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText(/safe in your Inbox/)).toBeTruthy()
    // The proposal, editable in place: its type is preselected, not chosen by the user.
    expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('task')

    // Captured — persisted — and still nothing created.
    expect((await listInbox()).map((item) => item.text)).toEqual(['Submit DBMS assignment Friday'])
    expect(await db.tasks.count()).toBe(0)
  })

  it('refuses an empty capture, saying why, and stores nothing', async () => {
    mount()
    const input = await openAndType('   ')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect((await screen.findByRole('alert')).textContent).toMatch(/Type something/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(await db.messageLog.count()).toBe(0)
  })

  it('closes on Escape, and a capture already made stays in the Inbox', async () => {
    mount()
    const input = await openAndType('Buy a laptop stand')
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('status')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await listInbox()).map((item) => item.text)).toEqual(['Buy a laptop stand'])
  })

  it('creates the task only when Accept is pressed, then closes', async () => {
    mount()
    const input = await openAndType('Buy a laptop stand')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await db.tasks.count()).toBe(1)
    expect(await listInbox()).toEqual([])
  })

  it('holds Accept until an open question is answered', async () => {
    mount()
    const input = await openAndType('Meeting with E-Cell tomorrow at 4')
    fireEvent.keyDown(input, { key: 'Enter' })

    const question = await screen.findByRole('group', { name: 'Needs a detail' })
    const accept = screen.getByRole('button', { name: 'Accept' })
    expect(accept.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /4:00 PM/ }))
    expect(question.isConnected).toBe(false)
    expect(accept.hasAttribute('disabled')).toBe(false)

    fireEvent.click(accept)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const [task] = await db.tasks.toArray()
    expect(task).toMatchObject({ dueDate: '2026-09-22', dueTime: '16:00' })
  })
})
