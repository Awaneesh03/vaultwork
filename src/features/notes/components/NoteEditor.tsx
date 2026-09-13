import { useEffect, useRef, useState } from 'react'
import { Columns2, Eye, Pencil } from 'lucide-react'
import { Markdown } from '@/components/markdown/Markdown'
import { cn } from '@/lib/cn'
import { toggleCheckbox } from '@/lib/markdown'
import type { EditorMode } from '@/store/noteUiStore'
import type { SaveState } from '../hooks/useAutosave'

/**
 * The markdown editor: a textarea, a preview, and the three ways to see them.
 *
 * The textarea is deliberately a plain one rather than a rich-text surface.
 * Markdown *is* the document — it is what will be written to the vault — so
 * editing the characters directly keeps one representation instead of a widget
 * model that has to be serialised back and might not round-trip.
 *
 * Split view keeps both panes scrollable independently; on a narrow screen it
 * collapses to a single column, because two 180px columns help nobody.
 */

const MODES: { id: EditorMode; label: string; icon: typeof Pencil }[] = [
  { id: 'edit', label: 'Edit', icon: Pencil },
  { id: 'split', label: 'Split', icon: Columns2 },
  { id: 'preview', label: 'Preview', icon: Eye },
]

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Could not save',
}

export function EditorModeSwitch({
  mode,
  onChange,
}: {
  mode: EditorMode
  onChange: (mode: EditorMode) => void
}) {
  return (
    <div
      role="group"
      aria-label="Editor mode"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {MODES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          title={label}
          className={cn(
            'inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[11.5px]',
            'transition-colors duration-[var(--duration-fast)]',
            mode === id ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          <Icon size={11} aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}

/** The save indicator. Stands in for the button this editor deliberately lacks. */
export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      // Announced politely so a screen reader hears "Saving" without being
      // interrupted mid-sentence on every keystroke.
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-[11px]',
        state === 'error' ? 'text-danger' : 'text-ink-3',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'error'
            ? 'bg-danger'
            : state === 'pending' || state === 'saving'
              ? 'bg-warn'
              : 'bg-ok',
        )}
      />
      {SAVE_LABEL[state]}
    </span>
  )
}

export function NoteEditor({
  body,
  mode,
  saveState,
  onChange,
  onBlur,
}: {
  body: string
  mode: EditorMode
  saveState: SaveState
  onChange: (body: string) => void
  onBlur: () => void
}) {
  const [value, setValue] = useState(body)
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = useRef(false)

  // Accept a new body from outside only while the user is not mid-edit, so a
  // live-query tick cannot overwrite what is being typed.
  useEffect(() => {
    if (!dirty.current) setValue(body)
  }, [body])

  const set = (next: string) => {
    dirty.current = true
    setValue(next)
    onChange(next)
  }

  const showEditor = mode !== 'preview'
  const showPreview = mode !== 'edit'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-3',
          mode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {showEditor ? (
          <textarea
            ref={area}
            value={value}
            onChange={(event) => set(event.target.value)}
            onBlur={() => {
              dirty.current = false
              onBlur()
            }}
            spellCheck
            aria-label="Note body"
            placeholder={
              '# A heading\n\nWrite in markdown. **Bold**, *italic*, `code`.\n\n- [ ] a task'
            }
            className={cn(
              'min-h-[320px] w-full resize-none rounded-md border border-line bg-surface p-3',
              'font-mono text-[13px] leading-relaxed text-ink',
              'placeholder:text-ink-3 focus:border-accent-line',
            )}
          />
        ) : null}

        {showPreview ? (
          <div
            className={cn(
              'min-h-[320px] overflow-y-auto rounded-md border p-3',
              mode === 'preview' ? 'border-line bg-surface' : 'border-line bg-sunken/40',
            )}
          >
            <Markdown
              source={value}
              // Ticking a box in the preview edits the markdown, so the
              // document stays the single source of truth.
              onToggleCheckbox={(index) => set(toggleCheckbox(value, index))}
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <SaveIndicator state={saveState} />
        <span className="flex-1" />
        <span className="hidden text-[11px] text-ink-3 sm:inline">Saves automatically</span>
      </div>
    </div>
  )
}
