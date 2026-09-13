import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NoteLinkView } from '@/services'
import type { Id } from '@/types/entities'
import type { RefType } from '@/types/enums'
import { LINK_ICONS } from '../noteAppearance'

/**
 * What a note is about, and how to change it.
 *
 * Each attached link is a real router `Link`, so a note is a way *into* the
 * work rather than a dead reference. The labels are resolved by the query
 * service at read time, which is why a renamed task reads renamed here without
 * this component knowing anything happened.
 */

export interface LinkCandidate {
  refType: RefType
  refId: Id
  label: string
}

export function NoteLinkPicker({
  links,
  candidates,
  onAttach,
  onDetach,
}: {
  links: NoteLinkView[]
  /** Everything linkable, already resolved to labels by the hook layer. */
  candidates: LinkCandidate[]
  onAttach: (refType: RefType, refId: Id) => void
  onDetach: (refType: RefType, refId: Id) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const attached = useMemo(
    () => new Set(links.map((link) => `${link.refType}:${link.refId}`)),
    [links],
  )

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase()
    return candidates
      .filter((candidate) => !attached.has(`${candidate.refType}:${candidate.refId}`))
      .filter((candidate) => candidate.label.toLowerCase().includes(terms))
      .slice(0, 8)
  }, [candidates, attached, query])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 t-eyebrow text-ink-3">
          Linked to
        </h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-2 hover:border-accent-line hover:text-ink"
        >
          <Plus size={11} aria-hidden />
          Link
        </button>
      </div>

      {links.length === 0 ? (
        <p className="text-[12px] text-ink-3">
          Not linked to anything yet. A note can reference a task, project, goal or habit.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {links.map((link) => {
            const Icon = LINK_ICONS[link.refType]
            return (
              <li key={`${link.refType}:${link.refId}`}>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border py-1 pl-2 pr-1 text-[12px]',
                    link.missing
                      ? 'border-line bg-sunken text-ink-3'
                      : 'border-line bg-surface text-ink-2',
                  )}
                >
                  <Icon size={11} aria-hidden className="shrink-0" />
                  {link.missing ? (
                    // The note said it was about something; saying so is more
                    // honest than quietly dropping the reference.
                    <span className="italic">{link.label}</span>
                  ) : (
                    <Link to={link.href} className="hover:text-accent">
                      {link.label}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => onDetach(link.refType, link.refId)}
                    aria-label={`Unlink ${link.label}`}
                    className="rounded p-0.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
                  >
                    <X size={11} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {open ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-sunken p-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a task, project, goal or habit"
            aria-label="Find something to link"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent-line"
          />

          {matches.length === 0 ? (
            <p className="px-1 py-1 text-[11.5px] text-ink-3">Nothing else to link.</p>
          ) : (
            <ul className="flex flex-col">
              {matches.map((candidate) => {
                const Icon = LINK_ICONS[candidate.refType]
                return (
                  <li key={`${candidate.refType}:${candidate.refId}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onAttach(candidate.refType, candidate.refId)
                        setQuery('')
                      }}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] text-ink-2 hover:bg-elevated hover:text-ink"
                    >
                      <Icon size={11} aria-hidden className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                      <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-ink-3">
                        {candidate.refType}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
