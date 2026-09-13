import { AlertCircle, FolderOpen, Link2Off, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
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

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-2">
        <FolderOpen size={15} className="shrink-0 text-accent" aria-hidden />
        <h3 className="text-strong font-semibold text-ink">Obsidian vault</h3>
        <VaultStatusBadge state={state} />
        <span className="flex-1" />

        {state === null ? null : state === 'connected' ? (
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

      {status?.vaultName ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-body text-ink-3">
          <span>Folder</span>
          {/* A long folder name truncates but stays readable in full on hover. */}
          <span
            className="min-w-0 max-w-full truncate font-mono text-meta text-ink-2"
            title={status.vaultName}
          >
            {status.vaultName}
          </span>
        </p>
      ) : null}

      <p className="text-body leading-relaxed text-ink-3">
        {status?.message ?? 'Checking the vault…'}
      </p>

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

      <p className="text-meta leading-relaxed text-ink-3">
        Notes live in this browser and work without a vault. Obsidian is an optional destination —
        nothing here is required to write, search or organise them.
      </p>
    </section>
  )
}
