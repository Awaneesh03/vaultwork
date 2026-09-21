import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useState } from 'react'
import {
  captureText,
  dismissCapture,
  listInbox,
  resolveCapture,
  type CommandResult,
  type InboxItem,
} from '@/services'
import { useToastStore } from '@/store/toastStore'
import type { Id } from '@/types/entities'

/**
 * The Universal Inbox, for components (M18.3).
 *
 * Captures are live: `listInbox` reads `messageLog` and projects, so a capture
 * made in the dialog appears in the Inbox queue — and a resolved one leaves it —
 * with no refresh and no second copy of the list in a store.
 */
export function useInboxItems(): InboxItem[] | undefined {
  return useLiveQuery(() => listInbox(), [])
}

export interface InboxActions {
  busy: boolean
  capture: (text: string) => Promise<InboxItem>
  /** `proposal` is whatever the form holds; the service validates it. */
  resolve: (id: Id, proposal: unknown) => Promise<CommandResult>
  dismiss: (id: Id) => Promise<void>
}

export function useInboxActions(): InboxActions {
  const push = useToastStore((s) => s.push)
  const [busy, setBusy] = useState(false)

  const capture = useCallback(async (text: string) => {
    setBusy(true)
    try {
      return await captureText(text)
    } finally {
      setBusy(false)
    }
  }, [])

  const resolve = useCallback(
    async (id: Id, proposal: unknown) => {
      setBusy(true)
      try {
        const result = await resolveCapture(id, proposal)
        if (result.status === 'ok') push({ message: result.message, tone: 'success' })
        return result
      } finally {
        setBusy(false)
      }
    },
    [push],
  )

  const dismiss = useCallback(async (id: Id) => {
    setBusy(true)
    try {
      await dismissCapture(id)
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, capture, resolve, dismiss }
}
