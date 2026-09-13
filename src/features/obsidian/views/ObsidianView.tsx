import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  FileDown,
  FileQuestion,
  FileText,
  FileUp,
  GitCompare,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { ImportPreview, SyncStatus } from '@/services'
import { VaultConnection } from '../components/VaultConnection'
import { SyncStatusBadge } from '../components/SyncStatusBadge'
import { useVaultConnection, useVaultScan } from '../hooks/useObsidian'
import { SYNC_STATUS_DESCRIPTIONS, SYNC_STATUS_LABELS } from '../obsidianAppearance'

/**
 * The Obsidian screen.
 *
 * The shape of this page is the sync policy made visible: **scan, look, then
 * choose.** There is no button that reconciles everything, because a button
 * like that has to guess what the user wants when both sides changed, and
 * guessing is what this milestone exists to forbid.
 *
 * Nothing here reaches a filesystem. Every operation goes through the hooks,
 * which go through the service, which speaks to a `VaultPort` — so this file
 * would be unchanged if the adapter underneath were Tauri.
 */

const ORDER: SyncStatus[] = [
  'conflict',
  'external-change',
  'local-change',
  'not-exported',
  'missing',
  'clean',
]

function CountChip({ status, count }: { status: SyncStatus; count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-meta text-ink-2"
      title={SYNC_STATUS_DESCRIPTIONS[status]}
    >
      <SyncStatusBadge status={status} />
      <span className="tabular">{count}</span>
    </span>
  )
}

export function ObsidianView() {
  const connection = useVaultConnection()
  const vaultScan = useVaultScan()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [bulk, setBulk] = useState<string | null>(null)

  const connected = connection.status?.state === 'connected'
  const scan = vaultScan.scan

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <Sparkles size={18} className="text-accent" aria-hidden />
          <h2 className="t-page text-ink">Obsidian</h2>
        </div>
        <p className="t-body max-w-prose text-ink-2">
          Vaultwork reads Markdown notes and PDF documents from your vault. Notes sync both ways;
          PDFs are read only. Vaultwork never merges and never overwrites a file you changed — when
          both sides move, it stops and asks.
        </p>
      </header>

      <VaultConnection
        status={connection.status}
        busy={connection.busy}
        error={connection.error}
        onConnect={() => void connection.connect()}
        onDisconnect={() => void connection.disconnect()}
        onGrantPermission={() => void connection.grantPermission()}
      />

      {connected ? (
        <section className="flex flex-col gap-3.5 panel p-4 shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-section text-ink">Sync</h3>
            <span className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              disabled={vaultScan.busy}
              onClick={() => void vaultScan.run()}
              icon={<RefreshCw size={12} aria-hidden />}
            >
              Scan vault
            </Button>
            <Link
              to="/obsidian/sync"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-body font-medium text-ink-2 hover:border-accent-line hover:text-ink"
            >
              <GitCompare size={12} aria-hidden />
              Sync center
            </Link>
            <Button
              variant="primary"
              size="sm"
              // Deliberately disabled until a scan has run: exporting before
              // looking is exactly the blind operation the policy forbids.
              disabled={vaultScan.busy || scan === null}
              onClick={async () => {
                const result = await vaultScan.exportAll()
                if (result === null) return
                setBulk(
                  `${result.exported.length} exported · ${result.skipped.length} skipped · ${result.failed.length} failed`,
                )
              }}
              icon={<FileUp size={12} aria-hidden />}
            >
              Export all
            </Button>
          </div>

          {scan === null ? (
            <p className="text-body text-ink-3">
              Scan to see what is in sync before changing anything.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {ORDER.map((status) => (
                  <CountChip key={status} status={status} count={scan.counts[status]} />
                ))}
              </div>

              {/*
                Folders the walk could not read.

                Shown before the counts are believed, because a scan that could
                not open part of the vault is reporting a smaller vault than the
                one on disk — and "0 files" with no explanation is the symptom
                that made this worth surfacing at all.
              */}
              {scan.errors.length > 0 ? (
                <div
                  role="alert"
                  className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-body text-danger"
                >
                  <span className="inline-flex items-start gap-1.5">
                    <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
                    {scan.errors.length === 1
                      ? 'One folder could not be read, so this count may be incomplete.'
                      : `${scan.errors.length} folders could not be read, so this count may be incomplete.`}
                  </span>
                  <ul className="flex flex-col gap-0.5 pl-5">
                    {scan.errors.slice(0, 5).map((entry) => (
                      <li key={entry.path} className="break-words font-mono text-meta">
                        {entry.path} — {entry.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                A folder with files in it but nothing Vaultwork can read.

                This is the state that reads as a broken sync engine and is not
                one: a folder of images or archives scans perfectly and imports
                nothing. Said plainly here, next to the zeroes it explains.
              */}
              {/* What the scan actually saw, in the three categories that matter. */}
              {/*
                Three categories, three numbers. The dominant figure is the
                count, not the label — this strip exists to be read at a glance
                and only then explained.
              */}
              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
                {(
                  [
                    ['Markdown', scan.seen.markdown, 'text-ink'],
                    ['PDFs', scan.seen.pdf, 'text-ink'],
                    ['Skipped', scan.skipped.nonMarkdown, 'text-ink-3'],
                  ] as const
                ).map(([label, count, tone]) => (
                  <div key={label} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
                    <dt className="t-eyebrow text-ink-3">{label}</dt>
                    <dd className={`tabular text-display leading-none font-semibold ${tone}`}>
                      {count}
                    </dd>
                  </div>
                ))}
              </dl>

              {scan.untrackedDocuments.length > 0 ? (
                <p className="flex flex-wrap items-center gap-1.5 text-body text-ink-2">
                  <FileText size={12} className="shrink-0 text-ink-3" aria-hidden />
                  {scan.untrackedDocuments.length} PDF
                  {scan.untrackedDocuments.length === 1 ? '' : 's'} not read yet.
                  <Link to="/obsidian/sync" className="text-accent underline decoration-dotted">
                    Import them in Sync center
                  </Link>
                </p>
              ) : null}

              {scan.untracked.length === 0 &&
              scan.untrackedDocuments.length === 0 &&
              scan.seen.markdown + scan.seen.pdf === 0 &&
              scan.skipped.nonMarkdown > 0 &&
              scan.reports.length === 0 ? (
                <p
                  role="status"
                  className="flex flex-col gap-1 rounded-md border border-line bg-sunken px-2.5 py-2 text-body text-ink-2"
                >
                  <span className="inline-flex items-start gap-1.5">
                    <FileQuestion size={12} className="mt-[2px] shrink-0" aria-hidden />
                    Nothing here Vaultwork can read — {scan.skipped.nonMarkdown} file
                    {scan.skipped.nonMarkdown === 1 ? '' : 's'}, and none of them are Markdown notes
                    or PDFs.
                  </span>
                  {scan.skipped.examples.length > 0 ? (
                    <span className="pl-5 break-words font-mono text-meta text-ink-3">
                      {scan.skipped.examples.join(', ')}
                    </span>
                  ) : null}
                  <span className="pl-5 text-ink-3">
                    Vaultwork reads <code>.md</code> and <code>.pdf</code>. Check that the folder
                    you connected is your Obsidian vault.
                  </span>
                </p>
              ) : null}

              {scan.counts.conflict > 0 ? (
                <p
                  role="alert"
                  className="inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
                >
                  <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
                  {scan.counts.conflict} note{scan.counts.conflict === 1 ? '' : 's'} changed on both
                  sides. Open each one to choose which version to keep — nothing was written.
                </p>
              ) : null}

              {bulk ? <p className="text-body text-ink-2">{bulk}</p> : null}

              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {scan.reports
                  .filter((report) => report.status !== 'clean')
                  .slice(0, 12)
                  .map((report) => (
                    <li
                      key={report.noteId}
                      className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-body"
                    >
                      <Link
                        to={`/notes/${report.noteId}`}
                        className="min-w-0 flex-1 truncate font-mono text-meta text-ink-2 hover:text-accent"
                        title={report.vaultPath ?? 'No vault path'}
                      >
                        {report.vaultPath ?? 'No vault path'}
                      </Link>
                      <SyncStatusBadge status={report.status} />
                    </li>
                  ))}
              </ul>

              {scan.untracked.length > 0 ? (
                <section className="flex flex-col gap-1.5">
                  <h4 className="t-eyebrow text-ink-3">In the vault, not in Vaultwork</h4>
                  <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                    {scan.untracked.slice(0, 10).map((path) => (
                      <li
                        key={path}
                        className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-body"
                      >
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-meta text-ink-2"
                          title={path}
                        >
                          {path}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => setPreview(await vaultScan.preview(path))}
                          icon={<FileDown size={11} aria-hidden />}
                        >
                          Import
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-meta text-ink-3">
                    Export never deletes these. They are yours.
                  </p>
                </section>
              ) : null}
            </>
          )}

          {vaultScan.error ? (
            <p
              role="alert"
              className="rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger"
            >
              {vaultScan.error}
            </p>
          ) : null}
        </section>
      ) : null}

      {preview ? (
        <ImportConfirmation
          preview={preview}
          onCancel={() => setPreview(null)}
          onConfirm={async () => {
            await vaultScan.importFile(preview.path, { overwriteLocalChanges: true })
            setPreview(null)
          }}
        />
      ) : null}
    </section>
  )
}

/**
 * The confirmation the milestone requires before an import can replace anything.
 *
 * It names the file, the title, whether a matching note already exists and
 * whether local work would be lost — a confirmation is only meaningful if the
 * user is told what they are agreeing to.
 */
function ImportConfirmation({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: ImportPreview
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import from Obsidian"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <h2 className="text-strong font-semibold tracking-tight text-ink">Import from Obsidian</h2>

        <dl className="flex flex-col gap-1.5 text-body">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-3">Title</dt>
            <dd className="min-w-0 flex-1 truncate text-ink">{preview.title}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-3">File</dt>
            <dd
              className="min-w-0 flex-1 truncate font-mono text-meta text-ink-2"
              title={preview.path}
            >
              {preview.path}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-3">Matches</dt>
            <dd className="min-w-0 flex-1 text-ink-2">
              {preview.existingNoteId === null
                ? 'No existing note — a new one will be created'
                : `“${preview.existingTitle}”`}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-3">State</dt>
            <dd className="min-w-0 flex-1 text-ink-2">{SYNC_STATUS_LABELS[preview.status]}</dd>
          </div>
        </dl>

        {preview.wouldOverwrite ? (
          <p
            role="alert"
            className={cn(
              'inline-flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-body text-danger',
            )}
          >
            <AlertCircle size={12} className="mt-[2px] shrink-0" aria-hidden />
            This note has local changes that are not in the file. Importing will replace them.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant={preview.wouldOverwrite ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {preview.wouldOverwrite ? 'Replace local changes' : 'Import'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
