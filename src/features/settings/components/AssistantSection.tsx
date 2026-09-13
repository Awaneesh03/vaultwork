import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { describeAi, useAiSettings } from '../hooks/useAiSettings'

/** One fact about the provider, as a word. Mirrors the Telegram section. */
function Fact({ label, value, tone }: { label: string; value: string; tone: BadgeTone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-ink-3">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

/**
 * The Assistant section of Settings.
 *
 * Deliberately the same shape as the Telegram section, because it is the same
 * problem: a credential that lives in the OS keychain, a native process that
 * spends it, and a screen that must describe the state honestly without ever
 * being able to read the secret back.
 *
 * Two things it is careful about. It never claims the assistant is ready
 * because a key exists — "Configured" and "Enabled" are separate states, and
 * M15.1.1 made *off* the default deliberately, so a fresh installation never
 * reaches the network on its own. And after the key is saved it is gone from
 * this screen for good: no reveal, no masked preview, no field holding it.
 */
export function AssistantSection() {
  const ai = useAiSettings()
  const [key, setKey] = useState('')
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const { status } = ai

  if (!ai.available) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-ink-2">Unsupported in this runtime.</p>
        <p className="max-w-prose text-body text-ink-3">
          A browser cannot hold a provider key — anything in the bundle is public. Open the desktop
          app to configure the assistant.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/*
        Four separate answers, because they are four separate questions: is the
        assistant optional (always yes), is a key saved, is it switched on, and
        which model would answer. A single "status" line cannot say that a key
        is saved and the assistant is deliberately off — which is the default
        state of a fresh installation and needs no fixing.
      */}
      <div className="flex flex-col gap-2 panel p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-strong font-medium text-ink">
            {status.configured ? status.provider : 'No provider'}
          </span>
          <span className={`text-body ${status.enabled ? 'text-ok' : 'text-ink-2'}`}>
            {describeAi(status, ai.available)}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <Fact
            label="Provider key"
            value={status.configured ? 'In the keychain' : 'Not saved'}
            tone={status.configured ? 'confirm' : 'neutral'}
          />
          <Fact
            label="Reaching the provider"
            value={status.enabled ? 'Allowed' : 'Switched off'}
            tone={status.enabled ? 'confirm' : 'neutral'}
          />
          {status.model ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-ink-3">Model</span>
              <span className="font-mono text-meta text-ink-2">{status.model}</span>
            </div>
          ) : null}
          {/*
            A diagnostic, kept because each read is a potential OS
            authorization prompt and a climbing number is the symptom.
          */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-body text-ink-3">Keychain reads</span>
            <span className="tabular font-mono text-meta text-ink-2">{status.keychainReads}</span>
          </div>
        </div>
      </div>

      {status.lastError !== null ? (
        <p className="text-body text-danger">{status.lastError}</p>
      ) : null}

      {!status.configured ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-body text-ink-2">
            Provider API key
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="From your provider's dashboard"
              aria-label="AI provider API key"
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-body text-ink placeholder:text-ink-3 focus:border-accent-line"
            />
          </label>
          <p className="max-w-prose text-body text-ink-3">
            Saved to your operating system&apos;s credential store, never to Vaultwork&apos;s
            database or a backup file. It is not shown again after saving, and the assistant stays
            switched off until you enable it below.
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              icon={<KeyRound size={13} aria-hidden />}
              disabled={ai.busy || key.trim().length === 0}
              onClick={() => {
                const value = key.trim()
                // Out of React state the moment it is handed over.
                setKey('')
                void ai.configure(value)
              }}
            >
              Save key
            </Button>
          </div>
        </div>
      ) : null}

      {status.configured ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={ai.busy} onClick={() => void ai.test()}>
            Test connection
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={ai.busy}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Remove key
          </Button>
        </div>
      ) : null}

      {status.configured ? (
        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-sunken p-3 text-body text-ink">
          <input
            type="checkbox"
            className="mt-[3px]"
            checked={status.enabled}
            disabled={ai.busy}
            onChange={(event) => void ai.setEnabled(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Let the assistant reach the provider</span>
            <span className="text-body text-ink-3">
              Off by default, and off after a key is saved. Nothing leaves this machine until this
              is on, and only what you ask about is sent.
            </span>
          </span>
        </label>
      ) : null}

      {confirmingDisconnect ? (
        <div className="flex flex-col gap-2 panel p-3">
          <p className="text-body text-ink">Remove the provider key?</p>
          <p className="text-body text-ink-2">
            Clears the key from this machine and switches the assistant off. Your tasks, notes,
            projects, goals, habits and Obsidian vault are untouched.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={ai.busy}
              onClick={() => {
                setConfirmingDisconnect(false)
                void ai.disconnect()
              }}
            >
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {ai.notice !== null ? (
        <p role="status" className={`text-body ${ai.notice.ok ? 'text-ok' : 'text-danger'}`}>
          {ai.notice.text}
        </p>
      ) : null}
    </div>
  )
}
