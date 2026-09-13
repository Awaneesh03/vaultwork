import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Id, Tag } from '@/types/entities'

/**
 * Assigning tags.
 *
 * Typing filters what exists; Enter takes the top suggestion, or creates the
 * tag if nothing matches. Creating is offered rather than automatic, because
 * "#jvaa" from a typo becoming a permanent tag is how a tag list turns to
 * rubbish — Quick Add's `#tag` syntax is the fast path for people who know
 * what they want.
 */

export interface TagPickerProps {
  selected: Id[]
  tags: Tag[]
  onChange: (tagIds: Id[]) => void
  /** Returns the created (or restored) tag, so it can be selected at once. */
  onCreate?: (name: string) => Promise<Tag | null>
}

export function TagPicker({ selected, tags, onChange, onCreate }: TagPickerProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const chosen = tags.filter((tag) => selected.includes(tag.id))
  const needle = query.trim().toLowerCase()

  const suggestions = useMemo(() => {
    const available = tags.filter((tag) => !selected.includes(tag.id))
    if (needle.length === 0) return available.slice(0, 6)
    return available.filter((tag) => tag.name.includes(needle)).slice(0, 6)
  }, [tags, selected, needle])

  const exactExists = tags.some((tag) => tag.name === needle)
  const canCreate = needle.length > 0 && !exactExists && onCreate !== undefined

  const add = (id: Id) => {
    onChange([...selected, id])
    setQuery('')
    inputRef.current?.focus()
  }

  const create = async () => {
    if (!onCreate || needle.length === 0) return
    const tag = await onCreate(needle)
    if (tag) add(tag.id)
    else setQuery('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {chosen.map((tag) => (
            <li key={tag.id}>
              <span className="inline-flex items-center gap-1 rounded-sm bg-sunken py-0.5 pl-1.5 pr-1 text-[11.5px] text-ink-2">
                #{tag.name}
                <button
                  type="button"
                  aria-label={`Remove ${tag.name}`}
                  onClick={() => onChange(selected.filter((id) => id !== tag.id))}
                  className="rounded-sm p-0.5 text-ink-3 hover:text-danger"
                >
                  <X size={10} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const first = suggestions[0]
            if (first) add(first.id)
            else if (canCreate) void create()
          } else if (event.key === 'Backspace' && query.length === 0) {
            const last = chosen[chosen.length - 1]
            if (last) onChange(selected.filter((id) => id !== last.id))
          }
        }}
        placeholder="Add a tag…"
        className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong"
      />

      {suggestions.length > 0 || canCreate ? (
        <ul className="flex flex-wrap gap-1">
          {suggestions.map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => add(tag.id)}
                className="rounded-sm border border-line px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:border-line-strong hover:text-ink"
              >
                #{tag.name}
              </button>
            </li>
          ))}
          {canCreate ? (
            <li>
              <button
                type="button"
                onClick={() => void create()}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border border-dashed border-line px-1.5 py-0.5',
                  'text-[11.5px] text-accent hover:border-accent',
                )}
              >
                <Plus size={10} aria-hidden />
                Create #{needle}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
