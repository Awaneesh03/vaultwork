import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandIntent } from '@/services'
import { useToastStore } from '@/store/toastStore'
import { useToasts } from './useToasts'

beforeEach(() => {
  vi.useFakeTimers()
  useToastStore.setState({ toasts: [], undoStack: [] })
})
afterEach(() => vi.useRealTimers())

describe('toast expiry', () => {
  it('expires each toast on its own clock, however many arrive after it', () => {
    renderHook(() => useToasts())
    const push = useToastStore.getState().push

    act(() => void push({ message: 'first' }))
    // A new toast every two seconds must not keep the first one alive.
    for (let i = 0; i < 3; i += 1) {
      act(() => vi.advanceTimersByTime(2000))
      act(() => void push({ message: `later ${i}` }))
    }

    const messages = useToastStore.getState().toasts.map((toast) => toast.message)
    expect(messages).not.toContain('first')
  })
})

describe('the undo stack', () => {
  it('drops the reversal a toast ran, so ⌘Z does not replay it', () => {
    const older = { kind: 'task.restore', taskId: 'a' } as unknown as CommandIntent
    const newer = { kind: 'task.restore', taskId: 'b' } as unknown as CommandIntent
    const store = useToastStore.getState()
    store.pushUndo(older)
    store.pushUndo(newer)

    store.takeUndo(newer)

    expect(useToastStore.getState().popUndo()).toBe(older)
    expect(useToastStore.getState().popUndo()).toBeUndefined()
  })
})
