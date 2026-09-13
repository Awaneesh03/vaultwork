import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { diffLines, summarizeDiff } from '@/lib/diff'

/**
 * Two versions of a note, side by side.
 *
 * A readable comparison, not a merge tool — there is deliberately no way to
 * take a line from each side, because that is the automatic merging the
 * milestone forbids. The only two answers are "keep this one" and "keep that
 * one", and both are named by their consequence.
 *
 * Additions and removals carry a `+` / `−` marker as well as a colour, so the
 * comparison is usable without seeing the difference between green and red.
 */
export function ConflictDiff({
  title,
  local,
  external,
  busy = false,
  onKeepLocal,
  onKeepExternal,
  onClose,
}: {
  title: string
  local: string
  external: string
  busy?: boolean
  onKeepLocal: () => void
  onKeepExternal: () => void
  onClose: () => void
}) {
  const lines = diffLines(local, external)
  const summary = summarizeDiff(lines)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[6vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${title}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        className="flex max-h-[84vh] w-full max-w-3xl flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-xl [animation:panel-in_var(--duration-base)_var(--ease-out)]"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-strong font-semibold tracking-tight text-ink">{title}</h2>
            <p className="text-meta text-ink-3">
              {summary.removed} line{summary.removed === 1 ? '' : 's'} only in Vaultwork ·{' '}
              {summary.added} only in Obsidian
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-meta font-medium text-ink-3">
          <span>Vaultwork</span>
          <span>Obsidian</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-sunken">
          <table className="w-full border-collapse font-mono text-meta">
            <caption className="sr-only">
              Line by line comparison. Lines marked minus are only in Vaultwork; lines marked plus
              are only in Obsidian.
            </caption>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  key={index}
                  className={cn(
                    line.kind === 'removed' && 'bg-danger-soft/40',
                    line.kind === 'added' && 'bg-accent-soft/40',
                  )}
                >
                  <td className="w-8 select-none border-r border-line px-1.5 py-0.5 text-right text-ink-3">
                    {line.leftNumber ?? ''}
                  </td>
                  <td className="w-5 select-none px-1 py-0.5 text-center text-ink-3">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
                  </td>
                  <td
                    className={cn(
                      'whitespace-pre-wrap break-words px-1.5 py-0.5',
                      line.kind === 'same' ? 'text-ink-2' : 'text-ink',
                    )}
                  >
                    {line.text.length === 0 ? ' ' : line.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-meta text-ink-3">
          Vaultwork will not combine these. Choose the version to keep — the other is replaced.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" size="sm" disabled={busy} onClick={onKeepLocal}>
            Keep Vaultwork
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={onKeepExternal}>
            Keep Obsidian
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Decide later
          </Button>
        </div>
      </div>
    </div>
  )
}
