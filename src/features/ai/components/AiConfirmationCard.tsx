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
 * It is deliberately *not* violet. Everything the assistant says wears the
 * Assistant's colour; this is Vaultwork saying what it is about to do to your
 * own data, and the model is not the thing that acts. Reading "the assistant
 * understood me" and authorising "Vaultwork is about to change my data" must
 * not look like the same event, so one is a violet rule beside some prose and
 * the other is the loudest surface in the application, in Vaultwork's emerald,
 * with an amber reminder that it has not happened yet.
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
      <div className="flex flex-wrap items-center gap-2">
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
        <span className="flex-1" />
        {/*
          The state, as a word. "Nothing has changed yet" was already written
          down at the bottom of the card in grey; a pending mutation deserves to
          say so where the eye lands, and in the colour the rest of the
          application uses for "an exception you should notice".
        */}
        <span className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-micro font-medium text-warn">
          Not applied yet
        </span>
      </div>

      {/*
        Whose words these are. The lines below are written by Vaultwork from the
        resolved command; the model's own description is one disclosure further
        down, and never the thing you are agreeing to.
      */}
      <p className="text-meta text-ink-3">
        Written by Vaultwork from the resolved command — not by the assistant.
      </p>

      {/*
        Every line here is written by the confirmation service from the resolved
        command — never by the model. The numbering is what lets someone check
        "three changes" against three lines before pressing anything.
      */}
      <ol className="flex flex-col gap-px overflow-hidden rounded-md border border-line">
        {confirmation.summary.map((line, index) => (
          <li
            key={`${confirmation.id}-${index}`}
            className="flex gap-2.5 bg-surface px-3 py-2.5 text-strong text-ink"
          >
            <span
              className="tabular grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-micro text-accent"
              aria-hidden
            >
              {index + 1}
            </span>
            <span className="min-w-0 break-words">{line}</span>
          </li>
        ))}
      </ol>

      {confirmation.aiDescriptions.length > 0 ? (
        <details className="text-body text-ink-3">
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
      </div>

      <p className="text-meta text-ink-3">
        Nothing has changed yet. This proposal expires in a few minutes; press Escape to dismiss it.
      </p>
    </div>
  )
}
