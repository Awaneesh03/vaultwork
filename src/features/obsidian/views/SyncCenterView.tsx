import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  FileQuestion,
  FileText,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
// Pure decision helpers, imported from the integrations leaf rather than
// through the service barrel: a component may not value-import a service, and
// these do no I/O — they are the same kind of thing as `lib/`.
import { safeDecisions, summarizeDecisions, type SyncItem } from '@/integrations/obsidian/syncPlan'
import type { SyncStatus } from '@/services'
import { ConflictDiff } from '../components/ConflictDiff'
import { SyncItemRow } from '../components/SyncItemRow'
import { SyncStatusBadge } from '../components/SyncStatusBadge'
import { VaultStatusBadge } from '../components/VaultConnection'
import { useVaultConnection } from '../hooks/useObsidian'
import { describeSyncResult, useVaultSync } from '../hooks/useVaultSync'

/**
 * The Sync Center.
 *
 * The screen is the workflow: **scan → look → decide → confirm → apply.** There
 * is no button that reconciles the vault on its own, because such a button has
 * to guess when both sides changed — and guessing is what this whole feature
 * exists to avoid.
 *
 * Every item starts on "Skip". Nothing is chosen for the user, and the summary
 * before applying says exactly how many things will be replaced.
 */

/** The order categories are shown in: decisions first, settled last. */
const SECTIONS: SyncStatus[] = [
  'conflict',
  'moved-change',
  'duplicate-id',
  'path-collision',
  'external-change',
  'deleted-local',
  'missing',
  'moved',
  'local-change',
  'untracked',
  'not-exported',
  'clean',
]

function Section({
  status,
  items,
  open,
  onToggle,
  children,
}: {
  status: SyncStatus
  items: SyncItem[]
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (items.length === 0) return null

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-elevated"
        >
          <ChevronRight
            size={13}
            aria-hidden
            className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-90')}
          />
          <SyncStatusBadge status={status} />
          <span className="tabular text-[12px] text-ink-2">{items.length}</span>
        </button>
      </h3>
      {open ? (
        <ul className="flex flex-col divide-y divide-line border-t border-line">{children}</ul>
      ) : null}
    </section>
  )
}

export function SyncCenterView() {
  const connection = useVaultConnection()
  const sync = useVaultSync()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState(false)
  const [comparing, setComparing] = useState<{
    item: SyncItem
    local: string
    external: string
  } | null>(null)

  const connected = connection.status?.state === 'connected'
  const plan = sync.plan

  /**
   * Notes and documents, grouped separately by status.
   *
   * Two maps rather than one, because a Markdown note and a PDF in the same
   * "Untracked" list would be offered the same actions, and they do not have
   * the same actions — Vaultwork can write a note back to the vault and can
   * never write a PDF.
   */
  const { notesByStatus, documentsByStatus } = useMemo(() => {
    const notes = new Map<SyncStatus, SyncItem[]>()
    const documents = new Map<SyncStatus, SyncItem[]>()
    for (const item of plan?.items ?? []) {
      const map = item.itemKind === 'document' ? documents : notes
      const bucket = map.get(item.status)
      if (bucket) bucket.push(item)
      else map.set(item.status, [item])
    }
    return { notesByStatus: notes, documentsByStatus: documents }
  }, [plan])

  const summary = plan === null ? null : summarizeDecisions(plan, sync.decisions)
  const nothingChosen = summary === null || summary.total === 0

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Link
          to="/obsidian"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-ink-3 hover:text-accent"
        >
          <ArrowLeft size={12} aria-hidden />
          Obsidian
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Sync</h2>
          <VaultStatusBadge state={connection.status?.state ?? null} />
          {connection.status?.vaultName ? (
            <span
              className="min-w-0 max-w-[220px] truncate font-mono text-[11.5px] text-ink-3"
              title={connection.status.vaultName}
            >
              {connection.status.vaultName}
            </span>
          ) : null}
        </div>
        <p className="max-w-prose text-[13px] text-ink-2">
          Scan to see what differs, choose what to do with each item, then apply. Nothing is written
          until you confirm, and nothing is ever merged for you.
        </p>
      </header>

      {!connected ? (
        <EmptyState
          icon={<AlertCircle size={20} aria-hidden />}
          title={
            connection.status?.state === 'unsupported' ? 'Not supported here' : 'Vault unavailable'
          }
          description={
            connection.status?.message ??
            'Connect a vault on the Obsidian screen. Notes work normally without one.'
          }
          action={
            <Link to="/obsidian" className="text-[12.5px] text-accent underline decoration-dotted">
              Go to Obsidian
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={sync.scanning || sync.applying}
              onClick={() => void sync.scan()}
              icon={<RefreshCw size={12} aria-hidden />}
            >
              {sync.scanning ? 'Scanning…' : plan === null ? 'Scan vault' : 'Scan again'}
            </Button>

            {plan !== null ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={sync.applying}
                  onClick={() => sync.decideAll(safeDecisions(plan))}
                  icon={<CheckCheck size={12} aria-hidden />}
                >
                  Select safe changes
                </Button>
                <span className="flex-1" />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={sync.applying || nothingChosen}
                  onClick={() => setConfirming(true)}
                >
                  Apply {summary?.total ?? 0}
                </Button>
              </>
            ) : null}
          </div>

          {plan !== null ? (
            <p
              className="text-[11.5px] text-ink-3"
              // Announced so the outcome of a scan is not visible only.
              role="status"
            >
              {/*
                Three categories, not one total. "12 files" answers nothing when
                four are notes, three are PDFs and five were passed over.
              */}
              Scanned {formatEventTime(plan.scannedAt, plan.scannedAt, '')} · {plan.seen.markdown}{' '}
              Markdown · {plan.seen.pdf} PDF · {plan.skipped.nonMarkdown} skipped
            </p>
          ) : null}

          {sync.result ? (
            <p
              role="status"
              className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2"
            >
              {/* Never "everything synced" unless it genuinely was. */}
              Sync finished — {describeSyncResult(sync.result)}
            </p>
          ) : null}

          {sync.error ? (
            <p
              role="alert"
              className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger"
            >
              <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
              {sync.error}
            </p>
          ) : null}

          {plan === null ? (
            <p className="text-[12.5px] text-ink-3">
              Nothing has been read yet. A scan changes nothing — it only looks.
            </p>
          ) : plan.items.length === 0 && plan.errors.length === 0 ? (
            /*
             * Two very different nothings.
             *
             * A scan that found nothing readable in a folder that plainly has
             * files in it is not agreement — it is a folder with no documents
             * in it, and almost always a folder the user did not mean to pick.
             * Saying "everything matches" there sends them looking for a bug in
             * the sync engine instead of at the vault they chose.
             */
            plan.seen.markdown + plan.seen.pdf === 0 && plan.skipped.nonMarkdown > 0 ? (
              <EmptyState
                icon={<FileQuestion size={20} aria-hidden />}
                title="Nothing here Vaultwork can read"
                description={`${plan.skipped.nonMarkdown} file${
                  plan.skipped.nonMarkdown === 1 ? '' : 's'
                } here, and none of them are Markdown notes or PDFs${
                  plan.skipped.examples.length > 0 ? ` — ${plan.skipped.examples.join(', ')}` : ''
                }. Vaultwork reads .md and .pdf, so there is nothing to import. Check that the folder you connected is your Obsidian vault.`}
                action={
                  <Link
                    to="/obsidian"
                    className="text-[12.5px] text-accent underline decoration-dotted"
                  >
                    Choose a different folder
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<CheckCheck size={20} aria-hidden />}
                title="Everything matches"
                description="Every note and every vault file agree."
              />
            )
          ) : (
            <div className="flex flex-col gap-2">
              {SECTIONS.map((status) => {
                const items = notesByStatus.get(status) ?? []
                const open = openSections[status] ?? status !== 'clean'
                return (
                  <Section
                    key={status}
                    status={status}
                    items={items}
                    open={open}
                    onToggle={() => setOpenSections((current) => ({ ...current, [status]: !open }))}
                  >
                    {items.map((item) => (
                      <SyncItemRow
                        key={item.key}
                        item={item}
                        decision={sync.decisions[item.key] ?? 'skip'}
                        now={plan.scannedAt}
                        today=""
                        onDecide={(decision) => sync.decide(item.key, decision)}
                        onCompare={async () => {
                          const versions = await sync.compare(item)
                          if (versions !== null) setComparing({ item, ...versions })
                        }}
                      />
                    ))}
                  </Section>
                )
              })}

              {/*
                PDF documents, under their own heading.
                
                Separate because the actions differ: a document can be imported,
                re-read or forgotten, and never exported — Vaultwork does not
                write PDFs. Mixing the two lists would offer actions that cannot
                happen.
              */}
              {documentsByStatus.size > 0 ? (
                <>
                  <h3 className="t-eyebrow mt-4 flex items-center gap-1.5 px-0.5 text-ink-3">
                    <FileText size={11} aria-hidden />
                    PDF documents
                  </h3>
                  {SECTIONS.map((status) => {
                    const items = documentsByStatus.get(status) ?? []
                    const key = `doc:${status}`
                    const open = openSections[key] ?? status !== 'clean'
                    return (
                      <Section
                        key={key}
                        status={status}
                        items={items}
                        open={open}
                        onToggle={() =>
                          setOpenSections((current) => ({ ...current, [key]: !open }))
                        }
                      >
                        {items.map((item) => (
                          <SyncItemRow
                            key={item.key}
                            item={item}
                            decision={sync.decisions[item.key] ?? 'skip'}
                            now={plan.scannedAt}
                            today=""
                            onDecide={(decision) => sync.decide(item.key, decision)}
                          />
                        ))}
                      </Section>
                    )
                  })}
                </>
              ) : null}

              {plan.errors.length > 0 ? (
                <section className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3">
                  <h3 className="t-eyebrow text-ink-3">Could not be read</h3>
                  <ul className="flex flex-col gap-1">
                    {plan.errors.map((error) => (
                      <li key={error.path} className="text-[11.5px] text-ink-3">
                        <span className="font-mono" title={error.path}>
                          {error.path}
                        </span>{' '}
                        — {error.message}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-ink-3">
                    These were skipped. Nothing about them was changed.
                  </p>
                </section>
              ) : null}
            </div>
          )}
        </>
      )}

      {confirming && plan !== null && summary !== null ? (
        <ConfirmApply
          summary={summary}
          busy={sync.applying}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false)
            await sync.apply()
          }}
        />
      ) : null}

      {comparing !== null ? (
        <ConflictDiff
          title={comparing.item.title}
          local={comparing.local}
          external={comparing.external}
          onKeepLocal={() => {
            sync.decide(comparing.item.key, 'keep-local')
            setComparing(null)
          }}
          onKeepExternal={() => {
            sync.decide(comparing.item.key, 'keep-external')
            setComparing(null)
          }}
          onClose={() => setComparing(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * The confirmation before anything is written.
 *
 * States the counts, and names separately how many choices replace content the
 * user has not seen — the number that actually decides whether this is a
 * routine action or one to think about.
 */
function ConfirmApply({
  summary,
  busy,
  onCancel,
  onConfirm,
}: {
  summary: ReturnType<typeof summarizeDecisions>
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const rows: [string, number][] = [
    ['Import', summary.imported],
    ['Export', summary.exported],
    ['Accept move', summary.moved],
    ['Delete from vault', summary.deleted],
    ['Stop tracking', summary.forgotten],
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Apply these changes"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">
          Apply {summary.total} change{summary.total === 1 ? '' : 's'}
        </h2>

        <dl className="flex flex-col gap-1 text-[12.5px]">
          {rows
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink-3">{label}</dt>
                <dd className="tabular text-ink">{count}</dd>
              </div>
            ))}
          {summary.skipped > 0 ? (
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Left alone</dt>
              <dd className="tabular text-ink-3">{summary.skipped}</dd>
            </div>
          ) : null}
        </dl>

        {summary.destructive > 0 ? (
          <p
            role="alert"
            className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger"
          >
            <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
            {summary.destructive} of these replace content that will be lost.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant={summary.destructive > 0 ? 'danger' : 'primary'}
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
