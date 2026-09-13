import { useRef, type KeyboardEvent, type Ref } from 'react'
import { cn } from '@/lib/cn'
import type { QuickAddToken, QuickAddTokenKind } from '@/services'
import { toSegments } from '../highlight'

/**
 * A text input that paints the tokens the parser recognised.
 *
 * The technique: an overlay renders the text with the recognised spans marked,
 * and the real `<input>` sits on top with transparent text and a visible caret.
 * Both share the exact same font metrics and padding, and the overlay's
 * horizontal scroll is kept in step with the input's — misalignment is the only
 * way this trick goes wrong.
 *
 * It exists because the parser already returns character ranges. Showing what
 * was understood — and, just as importantly, what was *not* — is what turns
 * "why did it ignore my date?" into something you can see.
 */

const KIND_CLASS: Record<QuickAddTokenKind, string> = {
  date: 'bg-accent-soft text-accent',
  time: 'bg-accent-soft text-accent',
  tag: 'bg-sunken text-ink-2',
  project: 'bg-sunken text-ink-2',
  priority: 'bg-sunken text-warn',
  estimate: 'bg-sunken text-ink-2',
  description: 'text-ink-3',
}

export interface HighlightedInputProps {
  value: string
  tokens: QuickAddToken[]
  onChange: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  inputRef?: Ref<HTMLInputElement>
  className?: string
  'aria-label'?: string
}

/** Shared between the overlay and the input so the two cannot drift. */
const TEXT = 'text-[13.5px] leading-[38px] font-sans tracking-normal'

export function HighlightedInput({
  value,
  tokens,
  onChange,
  onKeyDown,
  placeholder,
  inputRef,
  className,
  'aria-label': ariaLabel,
}: HighlightedInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const segments = toSegments(value, tokens)

  return (
    <div className={cn('relative h-[38px] min-w-0 flex-1 overflow-hidden', className)}>
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-0',
          TEXT,
        )}
      >
        {segments.map((segment, index) =>
          segment.kind === null ? (
            <span key={index} className="text-ink">
              {segment.text}
            </span>
          ) : (
            <span key={index} className={cn('rounded-sm', KIND_CLASS[segment.kind])}>
              {segment.text}
            </span>
          ),
        )}
      </div>

      <input
        ref={inputRef}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (overlayRef.current) {
            overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'absolute inset-0 w-full bg-transparent px-0 text-transparent caret-ink',
          'placeholder:text-ink-3',
          TEXT,
        )}
      />
    </div>
  )
}
