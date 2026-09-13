import { useEffect, useRef } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AiConfirmation } from '@/services'

/**
 * The last thing between a proposal and a mutation.
 *
 * Every line it shows comes from `confirmation.summary`, which M15.5 wrote from
 * the resolved command — never from the model's own description of what it was
 * doing. The model's wording is shown underneath, clearly marked as its
 * reasoning rather than as the action, because a reply that says "tidy up a few
 * old things" while proposing something else is the ordinary failure mode here.
 *
 * Confirming is a deliberate click. There is no default-focused Confirm, no
 * Enter-to-confirm and no auto-apply for a single unambiguous step: the whole
 * point of the gate is that the user has read what will happen.
 */
export function AiConfirmationCard({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: AiConfirmation
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const region = useRef<HTMLDivElement>(null)

  /*
   * Escape cancels, matching the application's existing dismiss-what-is-open
   * behaviour. Bound on the card rather than globally so it cannot swallow the
   * shell's own Escape when no proposal is showing.
   */
  useEffect(() => {
    const node = region.current
    if (node === null) return

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div
      ref={region}
      role="group"
      aria-label="Confirm proposed changes"
      className="relative flex flex-col gap-3.5 overflow-hidden rounded-lg border-2 border-accent bg-elevated p-4 shadow-[var(--shadow-lg)]"
    >
      {/*
        Deliberately the loudest surface in the application: a two-pixel accent
        border and the elevated rung. Reading an answer and authorising a change
        to your own data should not look alike, and this is the only component
        that gets to shout.
      */}
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent text-accent-ink"
          aria-hidden
        >
          <ShieldCheck size={14} />
        </span>
        <h3 className="t-section text-ink">
          {confirmation.summary.length === 1
            ? 'Confirm this change'
            : `Confirm ${confirmation.summary.length} changes`}
        </h3>
      </div>

      {/*
        Every line here is written by the confirmation service from the resolved
        command — never by the model. The numbering is what lets someone check
        "three changes" against three lines before pressing anything.
      */}
      <ol className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {confirmation.summary.map((line, index) => (
          <li
            key={`${confirmation.id}-${index}`}
            className="flex gap-2.5 bg-surface px-3 py-2.5 text-[13px] text-ink"
          >
            <span
              className="tabular grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10.5px] text-accent"
              aria-hidden
            >
              {index + 1}
            </span>
            <span className="min-w-0 break-words">{line}</span>
          </li>
        ))}
      </ol>

      {confirmation.aiDescriptions.length > 0 ? (
        <details className="text-[12px] text-ink-3">
          <summary className="cursor-pointer">Why the assistant suggested this</summary>
          <ul className="mt-1.5 flex flex-col gap-1 pl-3.5">
            {confirmation.aiDescriptions.map((line, index) => (
              <li key={`${confirmation.id}-why-${index}`} className="list-disc break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/*
        Two explicit buttons, both plainly labelled and neither of them focused
        on mount. There is no Enter-to-confirm anywhere in this component: the
        gate is only worth having if pressing through it takes a decision.
        Cancel is a full secondary rather than a ghost — backing out must never
        be the harder of the two to find.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Applying…' : 'Confirm'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <span className="flex-1" />
        <p className="text-[11.5px] text-ink-3">Nothing has changed yet.</p>
      </div>

      <p className="text-[11.5px] text-ink-3">
        This proposal expires in a few minutes. Press Escape to dismiss it.
      </p>
    </div>
  )
}
