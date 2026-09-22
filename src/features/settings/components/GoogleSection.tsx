import { useState } from 'react'
import { Globe } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime, toTimeStr } from '@/lib/date'
import { describeGoogle, useGoogleSettings } from '../hooks/useGoogleSettings'

/** One fact, as a word. Mirrors the Assistant and Telegram sections. */
function Fact({ label, value, tone }: { label: string; value: string; tone: BadgeTone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-ink-3">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

const READ_ONLY =
  'Read-only. Vaultwork reads your calendar events and the headers of important emails — never a message body — and never sends, deletes, moves or changes anything. What it reads is shown on Today and not stored.'

/**
 * The Google section of Settings (M19.2).
 *
 * The same shape as the Assistant section, because it is the same problem: a
 * credential in the OS keychain, a native process that spends it, and a screen
 * that must describe the state honestly without being able to see the secret.
 * Nothing here ever holds a token: consent happens in the user's browser.
 *
 * One authorization covers both services, and Google lets the user untick
 * either one — so each is shown on its own line, and "Calendar only" is said,
 * never smoothed over.
 */
export function GoogleSection() {
  const google = useGoogleSettings()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const { status } = google

  if (!google.available) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-ink-2">Desktop only.</p>
        <p className="max-w-prose text-body text-ink-3">
          A browser cannot hold a Google grant — anything in the bundle is public. Open the desktop
          app to connect your Google account.
        </p>
      </div>
    )
  }

  if (!status.configuredInBuild) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-ink-2">Not in this build.</p>
        <p className="max-w-prose text-body text-ink-3">
          This copy of Vaultwork was built without a Google client, so it cannot connect to Google.
          Everything else works as usual.
        </p>
      </div>
    )
  }

  const connected = status.authorized
  const lastCheck =
    status.lastCheckedAt === null
      ? 'Not this session'
      : formatTime(toTimeStr(new Date(status.lastCheckedAt)))
  const service = (granted: boolean): { value: string; tone: BadgeTone } =>
    granted
      ? { value: 'Connected · read-only', tone: 'confirm' }
      : { value: 'Not granted', tone: 'neutral' }
  const partial = connected && (!status.calendar || !status.gmail)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2 panel p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-strong font-medium text-ink">
            {connected && status.account !== null ? status.account : 'Google account'}
          </span>
          <span className={`text-body ${connected ? 'text-ok' : 'text-ink-2'}`}>
            {describeGoogle(status, google.available)}
          </span>
        </div>

        {connected ? (
          <div className="flex flex-col gap-1.5 border-t border-line pt-2">
            <Fact label="Calendar" {...service(status.calendar)} />
            <Fact label="Gmail" {...service(status.gmail)} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-ink-3">Last check</span>
              <span className="tabular text-meta text-ink-2">{lastCheck}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-ink-3">Keychain reads</span>
              <span className="tabular font-mono text-meta text-ink-2">{status.keychainReads}</span>
            </div>
          </div>
        ) : null}
      </div>

      <p className="max-w-prose text-body text-ink-3">{READ_ONLY}</p>

      {status.reconnectRequired ? (
        <p className="text-body text-warn">
          Google no longer accepts this connection — access was removed, or it expired. Reconnect to
          continue.
        </p>
      ) : null}

      {google.waiting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-ink-2">Waiting for your browser…</span>
          <Button size="sm" variant="ghost" onClick={google.cancel}>
            Cancel
          </Button>
        </div>
      ) : !connected ? (
        <div>
          <Button
            size="sm"
            variant="primary"
            icon={<Globe size={13} aria-hidden />}
            disabled={google.busy}
            onClick={() => void google.connect()}
          >
            {status.reconnectRequired ? 'Reconnect' : 'Connect Google'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={google.busy} onClick={() => void google.check()}>
            Check again
          </Button>
          {partial ? (
            <Button size="sm" disabled={google.busy} onClick={() => void google.connect()}>
              Reconnect to grant {status.calendar ? 'Gmail' : 'Calendar'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={google.busy}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect
          </Button>
        </div>
      )}

      {confirmingDisconnect ? (
        <div className="flex flex-col gap-2 panel p-3">
          <p className="text-body text-ink">Disconnect Google?</p>
          <p className="text-body text-ink-2">
            Removes the grant from this Mac and asks Google to revoke it. Your tasks, notes and
            everything else in Vaultwork are untouched.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={google.busy}
              onClick={() => {
                setConfirmingDisconnect(false)
                void google.disconnect()
              }}
            >
              Disconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDisconnect(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {google.notice !== null ? (
        <p className={`text-body ${google.notice.ok ? 'text-ok' : 'text-danger'}`}>
          {google.notice.text}
        </p>
      ) : null}
    </div>
  )
}
