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
import {
  SYNC_GROUP_HINTS,
  SYNC_GROUP_LABELS,
  SYNC_GROUP_ORDER,
  SYNC_STATUS_GROUPS,
  type SyncGroup,
} from '../obsidianAppearance'

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
  'error',
  'external-change',
  'deleted-local',
  'missing',
  'moved',
  'local-change',
  'untracked',
  'not-exported',
  'clean',
  'ignored',
]

/**
 * How a band is drawn.
 *
 * Three treatments, because three different things are being said. A decision
 * carries a danger edge and cannot be mistaken for a queued action; a settled
 * row is deliberately recessive — it is on screen to prove there is nothing to
 * do, not to be read. Colour is never the whole signal: each band is named in
 * words above the rows it contains.
 */
const BAND: Record<SyncGroup, { edge: string; panel: string; heading: string }> = {
  decide: {
    edge: 'bg-danger',
    panel: 'border-danger/30',
    heading: 'text-danger',
  },
  ready: { edge: 'bg-accent', panel: 'border-line', heading: 'text-ink-2' },
  settled: { edge: 'bg-line-strong', panel: 'border-line', heading: 'text-ink-3' },
}

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
    <section
      className={cn(
        'overflow-hidden rounded-lg border bg-surface',
        BAND[SYNC_STATUS_GROUPS[status]].panel,
      )}
    >
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
          <span className="tabular text-body text-ink-2">{items.length}</span>
        </button>
      </h3>
      {open ? (
        <ul className="flex flex-col divide-y divide-line border-t border-line">{children}</ul>
      ) : null}
    </section>
  )
}

/**
 * One band: a named group of states, or nothing at all.
 *
 * Returns `null` when the band is empty, so the page never shows a heading
 * over an empty region — "Needs your decision" with nothing under it reads as
 * a bug in the scan.
 */
function Band({
  group,
  count,
  children,
}: {
  group: SyncGroup
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null

  return (
    <section className="relative flex flex-col gap-2 pl-3">
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-[3px] rounded-full', BAND[group].edge)}
      />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className={cn('t-section', BAND[group].heading)}>{SYNC_GROUP_LABELS[group]}</h3>
        <span className="tabular text-meta text-ink-3">{count}</span>
        <p className="w-full text-meta text-ink-3">{SYNC_GROUP_HINTS[group]}</p>
      </div>
      {children}
    </section>
  )
}

/** How many items in one band, across every state that belongs to it. */
function countIn(byStatus: Map<SyncStatus, SyncItem[]>, group: SyncGroup): number {
  let total = 0
  for (const [status, items] of byStatus) {
    if (SYNC_STATUS_GROUPS[status] === group) total += items.length
  }
  return total
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
          className="inline-flex w-fit items-center gap-1 text-body text-ink-3 hover:text-accent"
        >
          <ArrowLeft size={12} aria-hidden />
          Obsidian
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-display font-semibold tracking-tight text-ink">Sync</h2>
          <VaultStatusBadge state={connection.status?.state ?? null} />
          {connection.status?.vaultName ? (
            <span
              className="min-w-0 max-w-[220px] truncate font-mono text-meta text-ink-3"
              title={connection.status.vaultName}
            >
              {connection.status.vaultName}
            </span>
          ) : null}
        </div>
        <p className="max-w-prose text-strong text-ink-2">
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
            <Link to="/obsidian" className="text-body text-accent underline decoration-dotted">
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

          {/*
            What is currently staged, before the confirmation asks about it.

            The Apply button carries a total; a total does not say whether the
            two things about to happen are two exports or one export and one
            deletion. Shown on the page so the answer is available while the
            choices are still being made, not only in the dialog afterwards.
          */}
          {summary !== null && summary.total > 0 ? (
            <p
              role="status"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-body text-ink-2"
            >
              <span className="font-medium text-accent">Staged</span>
              {(
                [
                  ['import', summary.imported],
                  ['export', summary.exported],
                  ['accept move', summary.moved],
                  ['delete from vault', summary.deleted],
                  ['stop tracking', summary.forgotten],
                ] as const
              )
                .filter(([, count]) => count > 0)
                .map(([label, count]) => (
                  <span key={label} className="tabular">
                    {count} {label}
                  </span>
                ))}
              {summary.destructive > 0 ? (
                <span className="tabular font-medium text-danger">
                  {summary.destructive} replaces content
                </span>
              ) : null}
              <span className="flex-1" />
              <span className="text-meta text-ink-3">Nothing is written until you apply.</span>
            </p>
          ) : null}

          {plan !== null ? (
            <p
              className="text-meta text-ink-3"
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
              className="rounded-md border border-line bg-surface px-3 py-2 text-body text-ink-2"
            >
              {/* Never "everything synced" unless it genuinely was. */}
              Sync finished — {describeSyncResult(sync.result)}
            </p>
          ) : null}

          {sync.error ? (
            <p
              role="alert"
              className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
            >
              <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
              {sync.error}
            </p>
          ) : null}

          {plan === null ? (
            <p className="text-body text-ink-3">
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
                    className="text-body text-accent underline decoration-dotted"
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
            <div className="flex flex-col gap-5">
              {/*
                Three bands, in the order a person needs them: what only they
                can decide, what is queued behind a click, and what already
                agrees. Before this the twelve states were twelve identical
                panels, and a conflict looked exactly like a rename.
              */}
              {SYNC_GROUP_ORDER.map((group) => (
                <Band key={group} group={group} count={countIn(notesByStatus, group)}>
                  {SECTIONS.filter((status) => SYNC_STATUS_GROUPS[status] === group).map(
                    (status) => {
                      const items = notesByStatus.get(status) ?? []
                      const open = openSections[status] ?? group !== 'settled'
                      return (
                        <Section
                          key={status}
                          status={status}
                          items={items}
                          open={open}
                          onToggle={() =>
                            setOpenSections((current) => ({ ...current, [status]: !open }))
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
                              onCompare={async () => {
                                const versions = await sync.compare(item)
                                if (versions !== null) setComparing({ item, ...versions })
                              }}
                            />
                          ))}
                        </Section>
                      )
                    },
                  )}
                </Band>
              ))}

              {/*
                PDF documents, under their own heading.

                Separate because the actions differ: a document can be imported,
                re-read or forgotten, and never exported — Vaultwork does not
                write PDFs. Mixing the two lists would offer actions that cannot
                happen.
              */}
              {documentsByStatus.size > 0 ? (
                <section className="flex flex-col gap-4 border-t border-line pt-5">
                  <h3 className="t-eyebrow flex items-center gap-1.5 px-0.5 text-ink-3">
                    <FileText size={11} aria-hidden />
                    PDF documents
                  </h3>
                  {SYNC_GROUP_ORDER.map((group) => (
                    <Band
                      key={`doc:${group}`}
                      group={group}
                      count={countIn(documentsByStatus, group)}
                    >
                      {SECTIONS.filter((status) => SYNC_STATUS_GROUPS[status] === group).map(
                        (status) => {
                          const items = documentsByStatus.get(status) ?? []
                          const key = `doc:${status}`
                          const open = openSections[key] ?? group !== 'settled'
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
                        },
                      )}
                    </Band>
                  ))}
                </section>
              ) : null}

              {plan.errors.length > 0 ? (
                <section className="flex flex-col gap-1.5 panel p-3">
                  <h3 className="t-eyebrow text-ink-3">Could not be read</h3>
                  <ul className="flex flex-col gap-1">
                    {plan.errors.map((error) => (
                      <li key={error.path} className="text-meta text-ink-3">
                        <span className="font-mono" title={error.path}>
                          {error.path}
                        </span>{' '}
                        — {error.message}
                      </li>
                    ))}
                  </ul>
                  <p className="text-meta text-ink-3">
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
        <h2 className="text-strong font-semibold tracking-tight text-ink">
          Apply {summary.total} change{summary.total === 1 ? '' : 's'}
        </h2>

        <dl className="flex flex-col gap-1 text-body">
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
            className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
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
