import { useEffect, useRef, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'

/**
 * Quick capture for notes, reachable anywhere with Shift+N.
 *
 * Deliberately two fields and nothing else. The point of a capture box is to
 * get a thought out of your head without deciding where it goes — tags, links
 * and formatting all belong to the editor you land in afterwards, not to the
 * moment you had the idea.
 */
export function NoteComposer({
  busy = false,
  contextLabel = null,
  onSubmit,
  onCancel,
}: {
  busy?: boolean
  /** Named when the composer was opened from an entity, e.g. "Study Trees". */
  contextLabel?: string | null
  onSubmit: (value: { title: string; body: string; open: boolean }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // An empty note is legitimate — you may want somewhere to write — so there is
  // nothing to validate and the button is never disabled on content grounds.
  const submit = (open: boolean) => onSubmit({ title, body, open })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New note"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit(true)
          }
        }}
        className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <div className="flex items-start gap-2">
          <FileText size={15} className="mt-[3px] shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink">New note</h2>
            {contextLabel ? (
              <p className="truncate text-[11.5px] text-ink-3">Linked to {contextLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <input
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title (optional)"
          aria-label="Note title"
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent-line"
        />

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={6}
          placeholder="Markdown. Write now, organise later."
          aria-label="Note body"
          className={cn(
            'w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2',
            'font-mono text-[12.5px] leading-relaxed text-ink',
            'placeholder:text-ink-3 focus:border-accent-line',
          )}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => submit(true)}>
            Create and open
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => submit(false)}>
            Create
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <span className="flex-1" />
          <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:inline-flex">
            <Kbd>esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}
