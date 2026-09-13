import { NavLink } from 'react-router-dom'
import { Settings as SettingsIcon, X } from 'lucide-react'
import { NAV_GROUPS } from '@/app/navigation'
import { CountBadge } from '@/components/ui/Badge'
import { Kbd } from '@/components/ui/Kbd'
import { useTaskCounts } from '@/features/tasks/hooks/useTaskCounts'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/store/uiStore'

/**
 * The navigation rail.
 *
 * Its own surface rung so it reads as chrome rather than as another panel, and
 * the one place in the application with a permanent visual identity: the mark,
 * the wordmark, and the violet bar that says where you are.
 *
 * The active item carries three signals at once — a tinted row, a solid accent
 * bar on the leading edge, and `aria-current`. That is not redundancy for its
 * own sake: a tint alone is a shade of grey to anyone not looking for it, and a
 * colour alone is nothing at all to a screen reader.
 */

/** Which nav paths carry a live count. */
const COUNTED: Record<string, 'inbox' | 'today' | 'upcoming' | 'overdue'> = {
  '/inbox': 'inbox',
  '/today': 'today',
  '/upcoming': 'upcoming',
  '/overdue': 'overdue',
}

function itemClasses(isActive: boolean): string {
  return cn(
    // 32px rows and 16px between groups: the whole rail has to fit a short
    // laptop window without scrolling, and a nav whose last item is clipped is
    // worse than two pixels less padding on each of nineteen rows.
    'group relative flex h-8 items-center gap-2.5 rounded-md pr-2 pl-3 text-[13px]',
    'transition-colors duration-[var(--duration-fast)]',
    isActive
      ? [
          'bg-accent-soft font-medium text-ink',
          'before:absolute before:inset-y-[6px] before:left-0 before:w-[2.5px]',
          'before:rounded-r-full before:bg-accent',
        ]
      : 'text-ink-2 hover:bg-surface hover:text-ink',
  )
}

export function Sidebar() {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const counts = useTaskCounts()

  return (
    <nav
      className="flex h-full w-[236px] flex-col border-r border-line bg-sidebar"
      aria-label="Sections"
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3.5">
        <div className="flex items-center gap-2.5">
          {/*
            The mark: a violet square with a mint corner. Small, geometric, and
            the only decorative element in the chrome — an identity needs one
            fixed point, and this is cheaper than a logo file.
          */}
          <span className="relative h-[18px] w-[18px] shrink-0 rounded-[5px] bg-accent" aria-hidden>
            <span className="absolute right-[3px] bottom-[3px] h-[6px] w-[6px] rounded-[2px] bg-accent-2" />
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-ink">Vaultwork</span>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="rounded-md p-1 text-ink-3 hover:bg-surface hover:text-ink lg:hidden"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="t-eyebrow px-3 pb-1.5 text-ink-3">{group.label}</p>
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => itemClasses(isActive)}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          size={15}
                          className={cn('shrink-0', isActive ? 'text-accent' : 'text-ink-3')}
                          aria-hidden
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        <NavCount path={item.path} counts={counts} />
                        {item.shortcut ? (
                          <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">
                            {item.shortcut}
                          </Kbd>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <NavLink
          to="/settings"
          onClick={() => setSidebarOpen(false)}
          className={({ isActive }) => itemClasses(isActive)}
        >
          {({ isActive }) => (
            <>
              <SettingsIcon
                size={15}
                className={cn('shrink-0', isActive ? 'text-accent' : 'text-ink-3')}
                aria-hidden
              />
              <span className="flex-1">Settings</span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  )
}

/**
 * A live count beside the four lists where "how many?" is actionable.
 *
 * Overdue is the only one that gets a warning tone, because it is the only one
 * where the number is a problem rather than a fact.
 */
function NavCount({ path, counts }: { path: string; counts: ReturnType<typeof useTaskCounts> }) {
  const key = COUNTED[path]
  if (!key || !counts) return null

  return <CountBadge value={counts[key]} tone={key === 'overdue' ? 'danger' : 'neutral'} />
}
