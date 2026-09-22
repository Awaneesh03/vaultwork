import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { SourceCapability, SourceId, SourceStatus } from '@/types/enums'
import { useSources } from '../hooks/useSources'

/**
 * Connected sources (M18.4): one readout of every integration Vaultwork has.
 *
 * A readout, not a control panel. Each row says what its integration itself
 * reports; setting one up still happens where it always has — the Obsidian
 * page, and the Assistant and Telegram groups below — so there is one place to
 * change each thing and this is not a second.
 */

const STATUS_LABELS: Record<SourceStatus, string> = {
  connected: 'Connected',
  available: 'Available',
  disconnected: 'Not connected',
  requiresSetup: 'Needs setup',
  unavailable: 'Not in this build',
  error: 'Problem',
}

/** Colour follows the vocabulary, and the label always carries the meaning too. */
const STATUS_TONES: Record<SourceStatus, BadgeTone> = {
  connected: 'ok',
  available: 'accent',
  disconnected: 'neutral',
  requiresSetup: 'neutral',
  unavailable: 'neutral',
  error: 'warn',
}

const CAPABILITY_LABELS: Record<SourceCapability, string> = {
  read: 'Read',
  write: 'Write',
  search: 'Search',
  import: 'Import',
  export: 'Export',
  sync: 'Sync',
  capture: 'Capture',
  reason: 'Reasoning',
}

/** Where each source is actually managed. Settings-local groups need no link. */
const MANAGE: Partial<Record<SourceId, { to: string; label: string }>> = {
  obsidian: { to: '/obsidian', label: 'Manage' },
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function ConnectedSourcesSection() {
  const { rows, refreshing, refresh } = useSources()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="t-meta flex-1 text-ink-3">
          Read from each integration when this page opened. Nothing here changes a connection.
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={13} aria-hidden />}
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? 'Checking…' : 'Check again'}
        </Button>
      </div>

      <ul
        aria-label="Connected sources"
        className="flex flex-col divide-y divide-line rounded-md border border-line"
      >
        {rows.map(({ id, source }) => {
          if (source === undefined) {
            // Still being asked. Only this row waits; the others have answered.
            return (
              <li key={id} className="px-3 py-2 text-meta text-ink-3" aria-busy="true">
                Checking…
              </li>
            )
          }
          const manage = MANAGE[id]
          return (
            <li
              key={id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              aria-label={`${source.name}: ${STATUS_LABELS[source.status]}`}
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-body font-medium text-ink">{source.name}</span>
                <span className="block break-words text-meta text-ink-3">{source.detail}</span>
              </span>
              <span className="text-meta text-ink-2">
                {source.capabilities.length > 0
                  ? source.capabilities
                      .map((capability) => CAPABILITY_LABELS[capability])
                      .join(' · ')
                  : '—'}
              </span>
              {source.checkedAt !== null ? (
                <span className="tabular text-meta text-ink-3">{clock(source.checkedAt)}</span>
              ) : null}
              <Badge tone={STATUS_TONES[source.status]}>{STATUS_LABELS[source.status]}</Badge>
              {manage ? (
                <Link
                  to={manage.to}
                  className="text-meta text-ink-2 underline-offset-2 hover:text-ink hover:underline"
                >
                  {manage.label}
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
