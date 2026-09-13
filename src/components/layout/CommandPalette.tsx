import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CornerDownLeft,
  FolderKanban,
  Moon,
  Plus,
  Search,
  Sun,
  Terminal,
} from 'lucide-react'
import { ALL_NAV_ITEMS, SETTINGS_ITEM } from '@/app/navigation'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import { useTheme } from '@/hooks/useTheme'
import { useProjectSearch } from '@/features/projects/hooks/useProjectSearch'
import { useTaskSearch } from '@/features/tasks/hooks/useTaskSearch'
import { cn } from '@/lib/cn'
import type { CommandIntent } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import { useUiStore } from '@/store/uiStore'

/**
 * The command palette — now a *producer* of CommandIntents.
 *
 * In M1 this component assembled its own list of things to do. It no longer
 * owns any task logic: it builds intents, hands them to `useCommands`, and
 * renders whatever CommandResult comes back — including the ambiguous case,
 * where it shows the numbered choices the resolver returned and asks.
 *
 * Which is the whole point. `/done binary trees` typed here travels the exact
 * path a Telegram message will in M14, and this file contains no knowledge of
 * how a task gets completed.
 *
 * Theme switching stays a local UI action: it is a settings concern with its
 * own service, not a command anyone would send from a chat window.
 */

interface PaletteItem {
  id: string
  label: string
  hint: string
  icon: 'command' | 'add' | 'task' | 'project' | 'nav' | 'theme'
  run: () => void
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const openTask = useTaskUiStore((s) => s.openTask)
  const theme = useTheme()
  const { run, dispatch, ambiguity, resolve, clearAmbiguity, pending } = useCommands()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()
  const isCommand = trimmed.startsWith('/')
  const matchingTasks = useTaskSearch(isCommand ? '' : trimmed, 5)
  const matchingProjects = useProjectSearch(isCommand ? '' : trimmed, 4)

  const close = () => {
    setOpen(false)
    clearAmbiguity()
  }

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = []

    if (isCommand) {
      // A slash command is passed through verbatim; the router owns the syntax.
      list.push({
        id: 'command:run',
        label: `Run ${trimmed}`,
        hint: 'Command',
        icon: 'command',
        run: () => void run(trimmed, 'palette'),
      })
    } else if (trimmed.length > 0) {
      list.push({
        id: 'command:add',
        label: `Add “${trimmed}”`,
        hint: 'Quick add syntax works here',
        icon: 'add',
        run: () => void run(trimmed, 'palette'),
      })

      for (const task of matchingTasks) {
        list.push({
          id: `task:${task.id}`,
          label: task.title,
          hint: task.status === 'done' ? 'Completed task' : 'Open task',
          icon: 'task',
          run: () => openTask(task.id),
        })
      }

      for (const { project, stats } of matchingProjects) {
        const intent: CommandIntent = {
          kind: 'project.open',
          source: 'palette',
          raw: '',
          ref: { by: 'id', id: project.id },
        }
        list.push({
          id: `project:${project.id}`,
          label: project.name,
          hint:
            stats.total === 0
              ? 'Project · no tasks'
              : `Project · ${stats.remaining} left of ${stats.total}`,
          icon: 'project',
          run: () => void dispatch(intent),
        })
      }
    }

    const navMatches = [...ALL_NAV_ITEMS, SETTINGS_ITEM].filter((item) => {
      if (trimmed.length === 0 || isCommand) return true
      const needle = trimmed.toLowerCase()
      return (
        item.label.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)
      )
    })

    for (const item of navMatches) {
      const intent: CommandIntent = {
        kind: 'app.navigate',
        source: 'palette',
        raw: '',
        path: item.path,
        label: `Go to ${item.label}`,
      }
      list.push({
        id: `nav:${item.path}`,
        label: `Go to ${item.label}`,
        hint: item.description,
        icon: 'nav',
        run: () => void dispatch(intent),
      })
    }

    if (trimmed.length === 0 || 'theme'.includes(trimmed.toLowerCase())) {
      list.push(
        {
          id: 'theme:toggle',
          label: theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
          hint: 'Overrides the system preference',
          icon: 'theme',
          run: () => theme.setPreference(theme.resolved === 'dark' ? 'light' : 'dark'),
        },
        {
          id: 'theme:system',
          label: 'Follow the system theme',
          hint: 'Track the OS setting again',
          icon: 'theme',
          run: () => theme.setPreference('system'),
        },
      )
    }

    return list
  }, [isCommand, trimmed, matchingTasks, matchingProjects, run, dispatch, openTask, theme])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
      clearAmbiguity()
      return
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  if (!open) return null

  const choices = ambiguity?.choices ?? []
  const length = ambiguity ? choices.length : items.length

  const commit = (index: number) => {
    if (ambiguity) {
      const choice = choices[index]
      if (!choice) return
      // The resolver returned candidates; this picks one. Nothing is guessed.
      void resolve(choice.id).then(close)
      return
    }
    const item = items[index]
    if (!item) return
    item.run()
    close()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-[overlay-in_var(--duration-fast)_var(--ease-out)] items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl animate-[dialog-in_var(--duration-base)_var(--ease-out)] overflow-hidden rounded-xl border border-line bg-elevated shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          {isCommand ? (
            <Terminal size={15} className="text-accent" aria-hidden />
          ) : (
            <Search size={15} className="text-ink-3" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((i) => Math.min(i + 1, length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commit(active)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                if (ambiguity) clearAmbiguity()
                else close()
              } else if (ambiguity && /^[1-9]$/.test(event.key)) {
                // The choices are numbered, so typing the number picks it.
                event.preventDefault()
                commit(Number(event.key) - 1)
              }
            }}
            placeholder="Search, add a task, or type / for a command…"
            aria-label="Command input"
            className="h-11 flex-1 bg-transparent text-strong text-ink placeholder:text-ink-3"
          />
          {pending ? <span className="text-meta text-ink-3">…</span> : <Kbd>esc</Kbd>}
        </div>

        {ambiguity ? (
          <div className="p-1.5">
            <p className="px-2.5 pb-1.5 pt-1 text-body text-ink-2">{ambiguity.message}</p>
            <ul>
              {choices.map((choice, index) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
                      'transition-colors duration-[var(--duration-fast)]',
                      index === active
                        ? [
                            'bg-accent-soft text-ink',
                            'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px]',
                            'before:rounded-r-full before:bg-accent',
                          ]
                        : 'bg-transparent hover:bg-surface',
                    )}
                  >
                    <span className="tabular w-4 shrink-0 text-meta text-ink-3">
                      {choice.index}
                    </span>
                    <span className="flex-1 truncate text-strong text-ink">{choice.label}</span>
                    {choice.hint ? (
                      <span className="hidden text-meta text-ink-3 sm:inline">{choice.hint}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <li className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
                <p className="t-body text-ink">Nothing matches “{query}”</p>
                <p className="t-meta max-w-xs text-ink-3">
                  Press Enter to add it as a task, or start with{' '}
                  <span className="font-mono text-ink-2">/</span> to run a command.
                </p>
              </li>
            ) : (
              items.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
                      'transition-colors duration-[var(--duration-fast)]',
                      index === active
                        ? [
                            'bg-accent-soft text-ink',
                            'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px]',
                            'before:rounded-r-full before:bg-accent',
                          ]
                        : 'bg-transparent hover:bg-surface',
                    )}
                  >
                    <PaletteIcon
                      kind={item.icon}
                      dark={theme.resolved === 'dark'}
                      active={index === active}
                    />
                    <span className="min-w-0 flex-1 truncate text-strong text-ink">
                      {item.label}
                    </span>
                    <span className="hidden shrink-0 text-meta text-ink-3 sm:inline">
                      {item.hint}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-meta text-ink-3">
          <span className="inline-flex items-center gap-1">
            <Kbd>/add</Kbd> <Kbd>/done</Kbd> <Kbd>/today</Kbd> <Kbd>/projects</Kbd>
          </span>
          <span className="flex-1" />
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Kbd>↵</Kbd> run · <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
        </div>
      </div>
    </div>
  )
}

function PaletteIcon({
  kind,
  dark,
  active = false,
}: {
  kind: PaletteItem['icon']
  dark: boolean
  active?: boolean
}) {
  const props = {
    size: 14,
    className: active ? 'shrink-0 text-accent' : 'shrink-0 text-ink-3',
    'aria-hidden': true,
  } as const
  if (kind === 'command') return <Terminal {...props} />
  if (kind === 'add') return <Plus {...props} />
  if (kind === 'task') return <CheckCircle2 {...props} />
  if (kind === 'project') return <FolderKanban {...props} />
  if (kind === 'theme') return dark ? <Sun {...props} /> : <Moon {...props} />
  return <CornerDownLeft {...props} />
}
