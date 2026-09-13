import { useRef, useState, type KeyboardEvent } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * Where a question is typed.
 *
 * Enter submits and Shift+Enter adds a line, which is the convention everywhere
 * a message box exists — and the reason this is a textarea rather than an
 * input: "plan my revision" is often three lines, and a single-line field would
 * silently discard the shape of the request.
 *
 * The field owns its own text. Lifting it into the assistant hook would mean a
 * re-render of the whole conversation on every keystroke, for a value nothing
 * else needs until submit.
 */
export function AiComposer({
  onSubmit,
  disabled,
  busy,
  value,
  onValueChange,
}: {
  onSubmit: (text: string) => void
  disabled: boolean
  busy: boolean
  /** Controlled only so an example prompt can fill it in. */
  value: string
  onValueChange: (text: string) => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [rows, setRows] = useState(1)

  const ready = value.trim().length > 0 && !disabled && !busy

  const submit = () => {
    if (!ready) return
    onSubmit(value.trim())
    onValueChange('')
    setRows(1)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="ai-composer" className="sr-only">
        Ask the assistant
      </label>
      <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 focus-within:border-accent-line">
        <textarea
          id="ai-composer"
          ref={field}
          rows={rows}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onValueChange(event.target.value)
            setRows(Math.min(6, event.target.value.split('\n').length))
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask about your work, or describe a change…"
          spellCheck
          className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-strong text-ink placeholder:text-ink-3 disabled:opacity-50"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!ready}
          icon={<CornerDownLeft size={13} aria-hidden />}
        >
          {busy ? 'Thinking…' : 'Ask'}
        </Button>
      </div>
      <p className="px-1 text-meta text-ink-3">
        Enter to send · Shift+Enter for a new line. Nothing changes until you confirm it.
      </p>
    </div>
  )
}
