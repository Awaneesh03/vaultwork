import { AlertCircle, FolderOpen, Link2Off, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { ConnectionState, VaultStatus } from '@/services'
import { CONNECTION_LABELS, CONNECTION_TONES } from '../obsidianAppearance'

/**
 * Connect, disconnect, and what the vault is actually doing.
 *
 * The status shown is the *permission*, never the presence of a handle. A
 * handle survives a reload while its permission does not, and a panel that
 * says "Connected" on the strength of a stored handle is lying to the person
 * about to press Export.
 *
 * Every state carries a word as well as a colour, and the message explains what
 * to do about it rather than naming an exception.
 */

/**
 * The connection state, in a word.
 *
 * `null` means *not yet known*, and it says so. Defaulting an unknown state to
 * "Not connected" would be a small lie of exactly the kind this panel exists to
 * avoid — the user would read a definite answer to a question still being
 * asked, and the message beside it would not match.
 */
export function VaultStatusBadge({ state }: { state: ConnectionState | null }) {
  return (
    // Announced as a status so a screen reader hears the change without the
    // user having to go looking for it.
    <Badge role="status" tone={state === null ? 'neutral' : CONNECTION_TONES[state]}>
      {state === null ? 'Checking…' : CONNECTION_LABELS[state]}
    </Badge>
  )
}

/**
 * The edge that carries the state at a glance.
 *
 * A rule down the left rather than a tinted card: the band has to be readable
 * as "fine" or "needs you" from across the screen without the whole surface
 * changing colour every time the permission lapses. Never the only signal —
 * the badge beside it is the word.
 */
const EDGE: Record<ConnectionState, string> = {
  connected: 'bg-accent',
  'permission-required': 'bg-warn',
  'permission-denied': 'bg-danger',
  'not-connected': 'bg-line-strong',
  unsupported: 'bg-line-strong',
}

export function VaultConnection({
  status,
  busy,
  error,
  onConnect,
  onDisconnect,
  onGrantPermission,
}: {
  status: VaultStatus | null
  busy: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
  onGrantPermission: () => void
}) {
  // Until the first check returns, the state is genuinely unknown.
  const state = status?.state ?? null
  const connected = state === 'connected'

  return (
    <section className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)]">
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1', state === null ? 'bg-line' : EDGE[state])}
      />

      <div className="flex flex-col gap-3 py-4 pl-5 pr-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <FolderOpen
                size={14}
                className={cn('shrink-0', connected ? 'text-accent' : 'text-ink-3')}
                aria-hidden
              />
              {/*
                The vault's name is the heading once there is one. Which folder
                is connected is the question this band exists to answer, and
                "Obsidian vault" answers it for nobody with two vaults.
              */}
              <h3 className="t-section min-w-0 truncate text-ink" title={status?.vaultName ?? ''}>
                {status?.vaultName ?? 'Obsidian vault'}
              </h3>
              <VaultStatusBadge state={state} />
            </div>

            <p className="t-body max-w-prose leading-relaxed text-ink-2">
              {status?.message ?? 'Checking the vault…'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {state === null ? null : connected ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onDisconnect}
                icon={<Link2Off size={12} aria-hidden />}
              >
                Disconnect
              </Button>
            ) : state === 'permission-required' || state === 'permission-denied' ? (
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={onGrantPermission}
                icon={<ShieldAlert size={12} aria-hidden />}
              >
                Reconnect
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={busy || state === 'unsupported'}
                onClick={onConnect}
                icon={<FolderOpen size={12} aria-hidden />}
              >
                Connect vault
              </Button>
            )}
          </div>
        </div>

        {status?.state === 'connected' && !status.restorable ? (
          <p className="text-meta text-ink-3">
            This browser will ask you to choose the folder again after a reload.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
          >
            <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {/*
          Only while there is no vault. Once one is connected this is a
          paragraph of reassurance nobody is still reading, sitting above the
          thing they came here to do.
        */}
        {!connected ? (
          <p className="border-t border-line pt-3 text-meta leading-relaxed text-ink-3">
            Notes live in this browser and work without a vault. Obsidian is an optional destination
            — nothing here is required to write, search or organise them.
          </p>
        ) : null}
      </div>
    </section>
  )
}
