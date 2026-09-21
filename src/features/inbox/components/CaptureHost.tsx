import { useEffect, useId, useRef, useState } from 'react'
import { Inbox, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useProjectsView } from '@/features/projects/hooks/useProjectsView'
import type { InboxItem } from '@/services'
import { useUiStore } from '@/store/uiStore'
import { useInboxActions } from '../hooks/useInbox'
import { ProposalEditor } from './ProposalEditor'

/**
 * Capture anything, from anywhere (M18.3). Mounted once, at the shell.
 *
 * Two steps, and the first one is the whole promise: type, press Enter, and the
 * text is kept. Only then does Vaultwork say what it thinks the text is, and
 * the user may accept that, correct it, dismiss it — or simply close the
 * dialog, in which case the capture waits in the Inbox, undecided and safe.
 */
export function CaptureHost() {
  const open = useUiStore((s) => s.captureOpen)
  if (!open) return null
  return <CaptureDialog />
}

function CaptureDialog() {
  const setOpen = useUiStore((s) => s.setCaptureOpen)
  const { busy, capture, resolve, dismiss } = useInboxActions()
  const projects = useProjectsView()?.projects ?? []

  const [text, setText] = useState('')
  const [item, setItem] = useState<InboxItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const capturedRef = useRef<HTMLParagraphElement>(null)
  const titleId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Once captured, focus follows the conversation to the proposal.
  useEffect(() => {
    if (item !== null) capturedRef.current?.focus()
  }, [item])

  const close = () => setOpen(false)

  const submit = async () => {
    if (text.trim().length === 0) {
      setError('Type something to capture.')
      return
    }
    setError(null)
    try {
      setItem(await capture(text))
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'That could not be captured.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <div className="flex items-start gap-2">
          <Inbox size={15} className="mt-[3px] shrink-0 text-accent" aria-hidden />
          <h2 id={titleId} className="flex-1 text-strong font-semibold tracking-tight text-ink">
            Capture
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {item === null ? (
          <>
            <input
              ref={inputRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder="Anything — a task, a thought, a meeting, something to research…"
              aria-label="Capture anything"
              aria-invalid={error !== null}
              aria-describedby={error !== null ? `${titleId}-error` : undefined}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-strong text-ink placeholder:text-ink-3 focus:border-accent-line"
            />
            {error !== null ? (
              <p id={`${titleId}-error`} role="alert" className="text-body text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2 text-meta text-ink-3">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
                Capture
              </Button>
              <span className="flex-1" />
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Kbd>↵</Kbd> to capture · <Kbd>esc</Kbd> to close
              </span>
            </div>
          </>
        ) : (
          <>
            <p
              ref={capturedRef}
              tabIndex={-1}
              role="status"
              className="text-body text-ink-2 outline-none"
            >
              Captured “{item.text}” — it is safe in your Inbox.
            </p>
            <ProposalEditor
              item={item}
              projects={projects}
              busy={busy}
              editing
              onAccept={async (proposal) => {
                const result = await resolve(item.id, proposal)
                if (result.status === 'ok') {
                  close()
                  return null
                }
                return result.message
              }}
              onDismiss={() => {
                void dismiss(item.id).then(close)
              }}
            />
            <Button variant="ghost" size="sm" className="self-start" onClick={close}>
              Keep in Inbox
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
