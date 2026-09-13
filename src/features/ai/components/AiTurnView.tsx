import { AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/markdown/Markdown'
import type { AiStepOutcome } from '@/ai/bridge/aiBridgeTypes'
import type { AiAskResult } from '@/services'
import type { Id } from '@/types/entities'

/**
 * One exchange, rendered by kind.
 *
 * The five outcomes look different on purpose. An answer is prose; a
 * clarification is a question; ambiguous references are a list of the user's own
 * rows to pick from; an unresolved plan is an explanation of why nothing can
 * happen. Flattening them into one bubble would hide the distinction that
 * matters most — whether anything is about to change.
 *
 * So each one is *named* rather than left to be inferred from its shape. The
 * eyebrow over every reply says which of the five this is, in words, which is
 * also what makes the distinction survive for a reader who cannot see the
 * violet rule beside it.
 *
 * Nothing here executes, resolves or asks a provider. Every control reports
 * upward.
 */

/**
 * The assistant speaking.
 *
 * A violet rule down the left edge rather than a chat bubble. Violet is the
 * Assistant's colour and only the Assistant's, so the rule is the mark that
 * says "this text came from the model" — which matters most at the moment the
 * next thing on screen is Vaultwork proposing to change your data, in
 * Vaultwork's own emerald.
 */
function Reply({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="relative flex flex-col gap-1.5 pl-3.5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] rounded-full bg-accent-2/60" />
      <p className="t-eyebrow flex items-center gap-1.5 text-accent-2">
        <Sparkles size={10} aria-hidden />
        {label}
      </p>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'plain'; children: React.ReactNode }) {
  return (
    <div
      className={`flex gap-2.5 rounded-lg border p-3 ${
        tone === 'warn' ? 'border-danger/40 bg-surface' : 'border-line bg-surface'
      }`}
    >
      {tone === 'warn' ? (
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      ) : null}
      <div className="min-w-0 flex-1 text-strong text-ink">{children}</div>
    </div>
  )
}

/**
 * "Which of these did you mean?"
 *
 * The rows come from the command layer's own resolver, in its own order, with
 * its own numbering — the same list the palette and Telegram show. Picking one
 * settles which row is meant and nothing else: it does not run the command, and
 * it does not ask the model again.
 */
function StepChoices({
  step,
  chosen,
  onChoose,
  disabled,
}: {
  step: Extract<AiStepOutcome, { status: 'ambiguous' }>
  chosen: Id | undefined
  onChoose: (stepId: string, taskId: Id) => void
  disabled: boolean
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-body text-ink-2">
        {`Which task did you mean for “${step.query}”?`}
      </legend>
      <div className="flex flex-col gap-1.5">
        {step.choices.map((choice) => {
          const picked = chosen === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={picked}
              onClick={() => onChoose(step.id, choice.id)}
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-strong transition-colors ${
                picked
                  ? 'border-accent-line bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-2 hover:border-accent-line hover:text-ink'
              }`}
            >
              <span className="tabular shrink-0 font-mono text-body text-ink-3">
                {choice.index}.
              </span>
              <span className="min-w-0 break-words">{choice.label}</span>
              {picked ? (
                <span className="ml-auto shrink-0 text-meta text-ink-3">chosen</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function AiTurnView({
  request,
  result,
  choices,
  onChoose,
  onProposeChosen,
  busy,
}: {
  request: string
  result: AiAskResult | null
  choices: ReadonlyMap<string, Id>
  onChoose: (stepId: string, taskId: Id) => void
  onProposeChosen: (steps: readonly AiStepOutcome[]) => void
  busy: boolean
}) {
  return (
    <article className="flex flex-col gap-3.5">
      {/*
        The request, as a record rather than a chat bubble pinned to the right.
        This is a log of what you asked and what came back, not a conversation
        with a personality — and a right-aligned bubble is the single strongest
        signal that a screen is pretending to be one.
      */}
      <div className="flex flex-col gap-1">
        <p className="t-eyebrow text-ink-3">You asked</p>
        <p className="break-words text-strong text-ink">{request}</p>
      </div>

      {result === null ? (
        <Reply label="Working">
          <p className="text-strong text-ink-3" role="status" aria-live="polite">
            Thinking…
          </p>
        </Reply>
      ) : null}

      {result?.kind === 'answer' ? (
        <Reply label="Answer">
          <div className="max-w-prose text-strong leading-relaxed text-ink">
            <Markdown source={result.message} />
          </div>
          {/* Stated, because an answer is the one outcome that changes nothing
              and the user should not have to deduce that from an absence. */}
          <p className="mt-2 text-meta text-ink-3">Nothing was changed — this is an answer.</p>
        </Reply>
      ) : null}

      {result?.kind === 'clarification' ? (
        <Reply label="Needs a detail">
          <div className="flex flex-col gap-2">
            <p className="text-strong text-ink">{result.message}</p>
            <ul className="flex flex-col gap-1 pl-4">
              {result.options.map((option) => (
                <li key={option} className="list-disc break-words text-strong text-ink-2">
                  {option}
                </li>
              ))}
            </ul>
            <p className="text-body text-ink-3">Ask again with the one you meant.</p>
          </div>
        </Reply>
      ) : null}

      {result?.kind === 'choices' ? (
        <Reply label="Needs a choice">
          <div className="flex flex-col gap-3">
            <p className="text-strong text-ink">{result.message}</p>
            {result.steps.map((step) =>
              step.status === 'ambiguous' ? (
                <StepChoices
                  key={step.id}
                  step={step}
                  chosen={choices.get(step.id)}
                  onChoose={onChoose}
                  disabled={busy}
                />
              ) : null,
            )}
            <div>
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => onProposeChosen(result.steps)}
              >
                Use this
              </Button>
            </div>
            <p className="text-meta text-ink-3">
              You will still be asked to confirm before anything changes.
            </p>
          </div>
        </Reply>
      ) : null}

      {result?.kind === 'unresolved' ? (
        <Reply label="Nothing matched">
          <Notice tone="warn">
            <p className="break-words">{result.message}</p>
            <p className="mt-1 text-body text-ink-3">
              Nothing was changed. Try naming it the way it appears in your list.
            </p>
          </Notice>
        </Reply>
      ) : null}

      {result?.kind === 'error' ? (
        <Reply label="Could not answer">
          <Notice tone="warn">
            <p className="break-words">{result.message}</p>
          </Notice>
        </Reply>
      ) : null}

      {/* A proposal is rendered by the view, which owns the confirmation. */}
    </article>
  )
}
