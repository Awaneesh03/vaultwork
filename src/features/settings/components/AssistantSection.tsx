import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { describeAi, useAiSettings } from '../hooks/useAiSettings'

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
        <p className="text-[12.5px] text-ink-2">Unsupported in this runtime.</p>
        <p className="max-w-prose text-[12.5px] text-ink-3">
          A browser cannot hold a provider key — anything in the bundle is public. Open the desktop
          app to configure the assistant.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      <dl className="flex flex-col gap-1.5 font-mono text-[12px] text-ink-2">
        <div className="flex justify-between gap-3">
          <dt>status</dt>
          <dd className={status.enabled ? 'text-ok' : 'text-ink'}>
            {describeAi(status, ai.available)}
          </dd>
        </div>
        {status.configured ? (
          <div className="flex justify-between gap-3">
            <dt>provider</dt>
            <dd className="text-ink">{status.provider}</dd>
          </div>
        ) : null}
        {status.model ? (
          <div className="flex justify-between gap-3">
            <dt>model</dt>
            <dd className="text-ink">{status.model}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt>credential store reads</dt>
          <dd className="tabular text-ink">{status.keychainReads}</dd>
        </div>
      </dl>

      {status.lastError !== null ? (
        <p className="text-[12.5px] text-danger">{status.lastError}</p>
      ) : null}

      {!status.configured ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
            Provider API key
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="From your provider's dashboard"
              aria-label="AI provider API key"
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-accent-line"
            />
          </label>
          <p className="max-w-prose text-[12px] text-ink-3">
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
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={ai.busy}
            onChange={(event) => void ai.setEnabled(event.target.checked)}
          />
          Let the assistant reach the provider
        </label>
      ) : null}

      {confirmingDisconnect ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <p className="text-[12.5px] text-ink">Remove the provider key?</p>
          <p className="text-[12px] text-ink-2">
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
        <p
          role="status"
          className={`text-[12.5px] ${ai.notice.ok ? 'text-ok' : 'text-danger'}`}
        >
          {ai.notice.text}
        </p>
      ) : null}
    </div>
  )
}
