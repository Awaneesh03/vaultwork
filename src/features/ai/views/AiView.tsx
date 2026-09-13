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

/**
 * Prompts drawn from what the assistant can actually do — nothing aspirational.
 *
 * Split by what happens next rather than listed flat. The first group is
 * answered and changes nothing; the second ends at a confirmation. That is the
 * single most important thing to learn about this screen, and it is cheaper to
 * teach here than to discover the first time a proposal appears.
 */
const EXAMPLE_GROUPS: { label: string; hint: string; prompts: string[] }[] = [
  {
    label: 'Ask about your work',
    hint: 'Answered from your own data. Nothing changes.',
    prompts: ["What's important today?", "What's overdue?"],
  },
  {
    label: 'Propose a change',
    hint: 'Comes back as a proposal you confirm or discard.',
    prompts: [
      'Complete my Java task',
      'Move Study Java to tomorrow at 7pm',
      'Add a task to revise recursion tomorrow',
    ],
  },
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
    <div className="flex max-w-prose flex-col gap-3 panel p-5 shadow-[var(--shadow-sm)]">
      <h2 className="t-section text-ink">{copy.title}</h2>
      <p className="t-body leading-relaxed text-ink-2">{copy.body}</p>
      <div>
        <Link
          to={ROUTES.settings}
          className="inline-flex h-7 items-center rounded-md border border-line bg-surface px-2.5 text-body font-medium text-ink transition-colors hover:border-accent-line hover:bg-elevated"
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

        It drew in emerald until Phase 6: the comment said violet, the token
        said `--accent-soft`, and the palette reversal had quietly made those
        two different colours.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[min(42rem,100%)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--accent-2-soft),transparent_70%)] opacity-60"
      />

      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="t-page flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-md bg-accent-2-soft text-accent-2"
              aria-hidden
            >
              <Sparkles size={15} />
            </span>
            Assistant
          </h2>
          <p className="t-meta max-w-prose text-ink-3">
            Asks about your tasks and proposes changes. It never changes anything on its own — every
            action is shown to you first.
          </p>
          {/*
            Which model is answering, beside the name of the thing answering,
            rather than in grey type at the bottom of the column. It is the
            other half of "what is this" — and on a screen whose whole promise
            is that you can see what it is doing, the provider is not a
            footnote.
          */}
          {ai.status !== null && !blocked ? (
            <p className="flex flex-wrap items-center gap-1.5 text-micro text-ink-3">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-2" aria-hidden />
              <span className="font-mono">{ai.status.provider}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{ai.status.model}</span>
            </p>
          ) : null}
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
        <div className="relative flex flex-col gap-5">
          {EXAMPLE_GROUPS.map((group) => (
            <section key={group.label} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className="t-eyebrow text-ink-2">{group.label}</h3>
                <p className="text-micro text-ink-3">{group.hint}</p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {group.prompts.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => setDraft(example)}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-body text-ink-2 transition-colors duration-[var(--duration-fast)] hover:border-accent-line hover:bg-elevated hover:text-ink"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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

      {/*
        What actually happened, as its own band rather than a coloured sentence
        adrift between the card and the composer. Undo is not reimplemented
        here: a change applied through the executor lands on the ordinary toast
        stack with the ordinary undo, and saying so is better than growing a
        second one that could disagree with it.
      */}
      {ai.outcome !== null ? (
        <div
          role="status"
          aria-live="polite"
          className={`relative flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-3 py-2.5 ${
            ai.outcome.ok ? 'border-ok/40 bg-ok-soft' : 'border-line bg-surface'
          }`}
        >
          <p
            className={`min-w-0 break-words text-strong ${ai.outcome.ok ? 'text-ok' : 'text-ink-2'}`}
          >
            {ai.outcome.message}
          </p>
          {ai.outcome.ok ? (
            <p className="text-meta text-ink-3">Undo is on the toast, as with any other change.</p>
          ) : null}
        </div>
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
    </div>
  )
}
