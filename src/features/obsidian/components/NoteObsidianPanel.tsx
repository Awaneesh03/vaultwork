import { useState } from 'react'
import { AlertCircle, FileDown, FileUp, FolderTree, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { NoteSyncReport } from '@/services'
import { SyncStatusBadge } from './SyncStatusBadge'
import { SYNC_STATUS_DESCRIPTIONS } from '../obsidianAppearance'

/**
 * One note's Obsidian section, on the note detail screen.
 *
 * Only shows actions the current adapter can actually perform: with no vault
 * connected there is nothing here but an explanation, because offering an
 * Export button that always fails is worse than offering none.
 *
 * A conflict does not hide the buttons — it changes what they mean. Both
 * choices stay available and are labelled with their consequence, because the
 * milestone's rule is that the *user* decides, not that the app refuses.
 */
export function NoteObsidianPanel({
  connected,
  report,
  busy,
  error,
  message,
  suggestedPath,
  onExport,
  onImport,
  onRefresh,
  onRename,
  onDelete,
  className,
}: {
  connected: boolean
  report: NoteSyncReport | null
  busy: boolean
  error: string | null
  message: string | null
  /** The path this note would reserve for its current title and tags. */
  suggestedPath: string | null
  onExport: (options?: { overwriteExternalChanges?: boolean }) => void
  onImport: (options?: { overwriteLocalChanges?: boolean }) => void
  onRefresh: () => void
  onRename: (path: string) => void
  onDelete: () => void
  className?: string
}) {
  const [confirming, setConfirming] = useState<'export' | 'import' | 'delete' | null>(null)

  if (!connected) {
    return (
      <section className={cn('flex flex-col gap-1.5', className)}>
        <h3 className="t-eyebrow text-ink-3">Obsidian</h3>
        <p className="text-[12px] text-ink-3">
          No vault connected. This note works exactly as it does now — connect a vault on the
          Obsidian screen to write it to a file.
        </p>
      </section>
    )
  }

  const status = report?.status ?? 'not-exported'
  const conflicted = status === 'conflict'
  const external = status === 'external-change'
  const canRename = suggestedPath !== null && suggestedPath !== report?.vaultPath

  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="t-eyebrow text-ink-3">Obsidian</h3>
        <SyncStatusBadge status={status} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Check the vault file again"
          className="rounded-md p-1 text-ink-3 hover:bg-elevated hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-3">{SYNC_STATUS_DESCRIPTIONS[status]}</p>

      {report?.vaultPath ? (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <FolderTree size={10} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate font-mono" title={report.vaultPath}>
            {report.vaultPath}
          </span>
        </p>
      ) : null}

      {report?.pathError ? (
        <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
          {report.pathError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant={conflicted || external ? 'danger' : 'primary'}
          size="sm"
          disabled={busy}
          onClick={() => (conflicted || external ? setConfirming('export') : onExport())}
          icon={<FileUp size={11} aria-hidden />}
        >
          {conflicted || external ? 'Export, replacing vault' : 'Export'}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={busy || status === 'not-exported' || status === 'missing'}
          onClick={() => setConfirming('import')}
          icon={<FileDown size={11} aria-hidden />}
        >
          Import
        </Button>

        {canRename ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onRename(suggestedPath)}
            icon={<FolderTree size={11} aria-hidden />}
          >
            Move file
          </Button>
        ) : null}

        <span className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          disabled={busy || status === 'not-exported'}
          onClick={() => setConfirming('delete')}
          icon={<Trash2 size={11} aria-hidden />}
        >
          Delete file
        </Button>
      </div>

      {canRename ? (
        <p className="text-[11px] text-ink-3">
          Its title now suggests{' '}
          <span className="font-mono" title={suggestedPath}>
            {suggestedPath}
          </span>
          .
        </p>
      ) : null}

      {confirming !== null ? (
        <div
          role="alertdialog"
          aria-label={
            confirming === 'export'
              ? 'Replace the vault file'
              : confirming === 'import'
                ? 'Replace this note'
                : 'Delete the vault file'
          }
          className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-2.5"
        >
          <p className="inline-flex items-start gap-1.5 text-[12px] text-ink-2">
            <AlertCircle size={12} className="mt-[2px] shrink-0 text-warn" aria-hidden />
            {confirming === 'export'
              ? 'The vault file has changes this note does not have. Exporting replaces them.'
              : confirming === 'import'
                ? 'This replaces the note with what the vault file says.'
                : 'This removes the file from your vault. The note stays in Vaultwork.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (confirming === 'export') onExport({ overwriteExternalChanges: true })
                if (confirming === 'import') onImport({ overwriteLocalChanges: true })
                if (confirming === 'delete') onDelete()
                setConfirming(null)
              }}
            >
              {confirming === 'export'
                ? 'Replace vault file'
                : confirming === 'import'
                  ? 'Replace note'
                  : 'Delete from vault'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {message ? <p className="text-[11.5px] text-ink-2">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
