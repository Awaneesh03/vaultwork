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
 * Nothing here executes, resolves or asks a provider. Every control reports
 * upward.
 */

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Sparkles size={14} className="mt-1 shrink-0 text-ink-3" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
      <div className="min-w-0 flex-1 text-[13px] text-ink">{children}</div>
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
      <legend className="text-[12.5px] text-ink-2">
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
              className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors ${
                picked
                  ? 'border-accent-line bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-2 hover:border-accent-line hover:text-ink'
              }`}
            >
              <span className="tabular shrink-0 font-mono text-[12px] text-ink-3">
                {choice.index}.
              </span>
              <span className="min-w-0 break-words">{choice.label}</span>
              {picked ? (
                <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">chosen</span>
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
    <article className="flex flex-col gap-3">
      <p className="self-end max-w-[85%] break-words rounded-lg border border-line bg-elevated px-3 py-2 text-[13px] text-ink">
        {request}
      </p>

      {result === null ? (
        <Bubble>
          <p className="text-[13px] text-ink-3" role="status" aria-live="polite">
            Thinking…
          </p>
        </Bubble>
      ) : null}

      {result?.kind === 'answer' ? (
        <Bubble>
          <div className="text-[13.5px] leading-relaxed text-ink">
            <Markdown source={result.message} />
          </div>
        </Bubble>
      ) : null}

      {result?.kind === 'clarification' ? (
        <Bubble>
          <div className="flex flex-col gap-2">
            <p className="text-[13.5px] text-ink">{result.message}</p>
            <ul className="flex flex-col gap-1 pl-4">
              {result.options.map((option) => (
                <li key={option} className="list-disc break-words text-[13px] text-ink-2">
                  {option}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-ink-3">Ask again with the one you meant.</p>
          </div>
        </Bubble>
      ) : null}

      {result?.kind === 'choices' ? (
        <Bubble>
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] text-ink">{result.message}</p>
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
            <p className="text-[11.5px] text-ink-3">
              You will still be asked to confirm before anything changes.
            </p>
          </div>
        </Bubble>
      ) : null}

      {result?.kind === 'unresolved' ? (
        <Bubble>
          <Notice tone="warn">
            <p className="break-words">{result.message}</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Nothing was changed. Try naming it the way it appears in your list.
            </p>
          </Notice>
        </Bubble>
      ) : null}

      {result?.kind === 'error' ? (
        <Bubble>
          <Notice tone="warn">
            <p className="break-words">{result.message}</p>
          </Notice>
        </Bubble>
      ) : null}

      {/* A proposal is rendered by the view, which owns the confirmation. */}
    </article>
  )
}
