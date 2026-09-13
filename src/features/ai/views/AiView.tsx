import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROUTES } from '@/app/navigation'
import { AiComposer } from '../components/AiComposer'
import { AiConfirmationCard } from '../components/AiConfirmationCard'
import { AiTurnView } from '../components/AiTurnView'
import { useAiAssistant, type AiAssistant } from '../hooks/useAiAssistant'

/**
 * The assistant, as a screen.
 *
 * Deliberately not a chat product. There is no streaming, no memory, no
 * personality and no scrollback that survives a reload — it is a place to ask
 * one question about your own work and, when the answer is a change, to read
 * exactly what that change is before it happens.
 *
 * The one visual idea worth naming: a proposal is not a message. It renders as
 * a bordered card with two buttons, in the accent surface the rest of Vaultwork
 * uses for "this needs your attention", because the difference between reading
 * an answer and authorising a mutation should be visible from across the room.
 */

/** Prompts drawn from what the assistant can actually do — nothing aspirational. */
const EXAMPLES = [
  "What's important today?",
  "What's overdue?",
  'Complete my Java task',
  'Move Study Java to tomorrow at 7pm',
  'Add a task to revise recursion tomorrow',
]

function Unavailable({ reason }: { reason: NonNullable<AiAssistant['unavailable']> }) {
  const copy = {
    unsupported: {
      title: 'The assistant needs the desktop app',
      body: 'A browser cannot hold a provider key — anything in the bundle would be public. Open Vaultwork on the desktop to use it.',
    },
    'not-configured': {
      title: 'The assistant is not configured',
      body: 'No provider key has been saved on this machine yet. Everything else in Vaultwork works without one.',
    },
    disabled: {
      title: 'The assistant is switched off',
      body: 'A key is saved, but the assistant is disabled. It stays off until it is explicitly turned on — a fresh installation never reaches the network on its own.',
    },
  }[reason]

  return (
    <div className="flex max-w-prose flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
      <h2 className="t-section text-ink">{copy.title}</h2>
      <p className="t-body leading-relaxed text-ink-2">{copy.body}</p>
      <div>
        <Link
          to={ROUTES.settings}
          className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:border-accent-line hover:bg-elevated"
        >
          Open Settings
        </Link>
      </div>
    </div>
  )
}

export function AiView() {
  const ai = useAiAssistant()
  const [draft, setDraft] = useState('')

  const busy = ai.phase === 'asking' || ai.phase === 'executing'
  const blocked = ai.unavailable !== null

  return (
    <div className="relative flex max-w-3xl flex-col gap-6">
      {/*
        The assistant's one piece of ambience: a violet bloom behind the top of
        the column. It is the only place in the application with a gradient, and
        it earns that by being the only place where something is *thinking* —
        which is exactly why it must not appear on any other screen.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[min(42rem,100%)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--accent-soft),transparent_70%)] opacity-60"
      />

      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="t-page flex items-center gap-2">
            <span
              className="grid h-6 w-6 place-items-center rounded-md bg-accent-soft text-accent"
              aria-hidden
            >
              <Sparkles size={14} />
            </span>
            Assistant
          </h2>
          <p className="t-meta max-w-prose text-ink-3">
            Asks about your tasks and proposes changes. It never changes anything on its own —
            every action is shown to you first.
          </p>
        </div>
        {ai.turns.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={13} aria-hidden />}
            onClick={ai.reset}
            disabled={busy}
          >
            Clear
          </Button>
        ) : null}
      </header>

      {blocked && ai.unavailable !== null ? <Unavailable reason={ai.unavailable} /> : null}

      {!blocked && ai.turns.length === 0 ? (
        <div className="relative flex flex-col gap-3">
          <p className="t-meta text-ink-3">
            Ask about your own work. Nothing changes until you confirm it.
          </p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => setDraft(example)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors duration-[var(--duration-fast)] hover:border-accent-line hover:bg-elevated hover:text-ink"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ai.turns.length > 0 ? (
        <section className="relative flex flex-col gap-6" aria-label="Conversation">
          {ai.turns.map((turn) => (
            <AiTurnView
              key={turn.id}
              request={turn.request}
              result={turn.result}
              choices={ai.choices}
              onChoose={ai.choose}
              onProposeChosen={(steps) => void ai.proposeChosen(steps)}
              busy={busy}
            />
          ))}
        </section>
      ) : null}

      {ai.confirmation !== null ? (
        <AiConfirmationCard
          confirmation={ai.confirmation}
          busy={ai.phase === 'executing'}
          onConfirm={() => void ai.confirm()}
          onCancel={ai.cancel}
        />
      ) : null}

      {ai.outcome !== null ? (
        <p
          role="status"
          aria-live="polite"
          className={`break-words text-[13px] ${ai.outcome.ok ? 'text-ok' : 'text-ink-2'}`}
        >
          {ai.outcome.message}
        </p>
      ) : null}

      {!blocked ? (
        <AiComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={(text) => void ai.ask(text)}
          disabled={blocked}
          busy={busy}
        />
      ) : null}

      {ai.status !== null && !blocked ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-2" aria-hidden />
          {ai.status.provider} · {ai.status.model}
        </p>
      ) : null}
    </div>
  )
}
