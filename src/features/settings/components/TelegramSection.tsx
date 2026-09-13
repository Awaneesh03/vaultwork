import { useState } from 'react'
import { Send } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { describeTelegram, useTelegramSettings } from '../hooks/useTelegramSettings'

/**
 * One fact about the connection, as a word.
 *
 * The three facts this section has to keep apart — a token exists, a worker is
 * polling, a chat is allowed — were a mono key/value dump that read like a
 * debug panel. They are separate facts and each is now stated separately,
 * because "Configured" and "Running" being confused is the failure this whole
 * section exists to prevent.
 */
function Fact({ label, value, tone }: { label: string; value: string; tone: BadgeTone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-ink-3">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}

/**
 * The Telegram section of Settings.
 *
 * Two things it is careful about. It never claims to be connected because a
 * token exists — "Configured" and "Running" are separate states, and the badge
 * shows the one the worker actually reports. And after the token is saved it is
 * gone from this screen for good: there is no reveal, no masked preview, and no
 * field holding it. The bot's @username is the identity worth showing.
 */
export function TelegramSection() {
  const telegram = useTelegramSettings()
  const [token, setToken] = useState('')
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const { status } = telegram

  const state = describeTelegram(status, telegram.supported)

  if (!telegram.supported) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-ink-2">Unsupported in this runtime.</p>
        <p className="max-w-prose text-body text-ink-3">
          Telegram needs a process that stays running, which a browser tab is not. Open the desktop
          app to connect a bot.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/*
        The connection, as three separate answers plus the one sentence that
        summarises them. A single "status" line cannot say that a token is
        saved, the worker is stopped, and the chat is still unapproved — which
        is a perfectly ordinary state and needs three different actions.
      */}
      <div className="flex flex-col gap-2 panel p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-strong font-medium text-ink">
            {status.botUsername === null ? 'No bot connected' : `@${status.botUsername}`}
          </span>
          {/*
            Not a live region. The notice at the foot of this section is the one
            `status` role here; a second made `getByRole('status')` ambiguous,
            which is the accessible-tree version of the same confusion — two
            things both claiming to be *the* announcement.
          */}
          <span className={`text-body ${status.running ? 'text-ok' : 'text-ink-2'}`}>{state}</span>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <Fact
            label="Bot token"
            value={status.configured ? 'In the keychain' : 'Not saved'}
            tone={status.configured ? 'confirm' : 'neutral'}
          />
          <Fact
            label="Worker"
            value={status.running ? 'Polling' : 'Not polling'}
            tone={status.running ? 'confirm' : 'neutral'}
          />
          <Fact
            label="Chat"
            value={
              status.authorizedChatId !== null
                ? 'Authorized'
                : status.pendingChatId !== null
                  ? 'Waiting for approval'
                  : 'Not authorized'
            }
            tone={
              status.authorizedChatId !== null
                ? 'confirm'
                : status.pendingChatId !== null
                  ? 'warn'
                  : 'neutral'
            }
          />
        </div>
      </div>

      {status.lastError !== null ? (
        <p className="text-body text-danger">{status.lastError}</p>
      ) : null}

      {!status.configured ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-body text-ink-2">
            Bot token
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="From @BotFather"
              aria-label="Telegram bot token"
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-body text-ink placeholder:text-ink-3 focus:border-accent-line"
            />
          </label>
          <p className="max-w-prose text-body text-ink-3">
            Saved to your operating system&apos;s credential store, never to Vaultwork&apos;s
            database or a backup file. It is not shown again after saving.
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              icon={<Send size={13} aria-hidden />}
              disabled={telegram.busy || token.trim().length === 0}
              onClick={() => {
                const value = token.trim()
                // Out of React state the moment it is handed over.
                setToken('')
                void telegram.configure(value)
              }}
            >
              Configure
            </Button>
          </div>
        </div>
      ) : null}

      {status.configured && status.pendingChatId !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-accent-soft p-3">
          <p className="text-body text-ink">
            {status.pendingChatName === null
              ? 'A chat is asking for access.'
              : `${status.pendingChatName} is asking for access.`}
          </p>
          <p className="text-body text-ink-2">
            Approve it only if that is you. The approved chat can create, complete and delete your
            tasks.
          </p>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={telegram.busy}
              onClick={() => {
                const pending = status.pendingChatId
                if (pending !== null) void telegram.authorize(pending)
              }}
            >
              Authorize this chat
            </Button>
          </div>
        </div>
      ) : null}

      {status.configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="t-eyebrow mr-1 text-ink-3">Connection</h4>
          <Button size="sm" disabled={telegram.busy} onClick={() => void telegram.test()}>
            Test connection
          </Button>
          {status.running ? (
            <Button size="sm" disabled={telegram.busy} onClick={() => void telegram.stop()}>
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={telegram.busy}
              onClick={() => void telegram.start()}
            >
              Start
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={telegram.busy}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect
          </Button>
        </div>
      ) : null}

      {status.configured ? (
        /*
         * Automation, under its own heading and separated from the manual
         * controls above it.
         *
         * The distinction this section has to carry is "configured" versus
         * "running": a saved token means Telegram *can* run, not that it is
         * running now. Those were previously one undifferentiated stack of
         * controls with the auto-start checkbox last, which is why it reads as
         * an afterthought and gets missed — the setting that removes the daily
         * click was the least prominent thing on the panel.
         */
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-3">
          <h4 className="t-eyebrow text-ink-3">Automation</h4>

          <label className="flex items-start gap-2.5 text-body text-ink">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={status.autoStart}
              disabled={telegram.busy}
              onChange={(event) => void telegram.setAutoStart(event.target.checked)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Start Telegram automatically</span>
              <span className="text-body text-ink-3">
                Starts the worker when Vaultwork opens, so you do not have to come here and press
                Start. Turning the bot off here, or disconnecting it, also turns this off.
              </span>
            </span>
          </label>

          {/*
            Said plainly rather than implied, and said precisely.

            There is no Telegram daemon. Polling lives inside this process, so
            the chain is: macOS starts Vaultwork (if "Launch at login" is on),
            Vaultwork starts the worker (if this box is ticked and a token is
            saved), and quitting Vaultwork ends both. A user who expects a bot
            that answers overnight should learn that here rather than by
            wondering why nothing replied.
          */}
          <div className="flex flex-col gap-1 border-t border-line pt-2 text-meta text-ink-3">
            <p>
              There is no separate Telegram service. The bot is part of Vaultwork and runs only
              while Vaultwork is running — quitting the app stops it until you open it again.
            </p>
            <p>
              For it to be answering before you sit down, both this and{' '}
              <span className="text-ink-2">Launch Vaultwork at login</span> under Desktop need to be
              on: macOS starts Vaultwork, and Vaultwork starts the bot.
            </p>
          </div>
        </div>
      ) : null}

      {confirmingDisconnect ? (
        <div className="flex flex-col gap-2 panel p-3">
          <p className="text-body text-ink">Remove the bot token?</p>
          <p className="text-body text-ink-2">
            Stops polling and clears the token and the authorized chat from this machine. Your
            tasks, notes, projects, goals, habits and Obsidian vault are untouched.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={telegram.busy}
              onClick={() => {
                setConfirmingDisconnect(false)
                void telegram.disconnect()
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

      {telegram.notice !== null ? (
        <p role="status" className={`text-body ${telegram.notice.ok ? 'text-ok' : 'text-danger'}`}>
          {telegram.notice.text}
        </p>
      ) : null}
    </div>
  )
}
