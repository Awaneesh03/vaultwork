import { Menu, Search } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { useUiStore } from '@/store/uiStore'

/**
 * The window's own bar: where you are, and the one control that gets you
 * anywhere else.
 *
 * Deliberately almost empty. Every pixel spent here is spent on every screen,
 * and the page below already says what it is — so this carries the route name,
 * the search affordance, and nothing else.
 */
export function TopBar({ title }: { title: string }) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md">
      <button
        type="button"
        onClick={toggleSidebar}
        className="rounded-md p-1.5 text-ink-2 transition-colors hover:bg-surface hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={17} />
      </button>

      <h1 className="t-section min-w-0 truncate text-ink">{title}</h1>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="group flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface pr-1.5 pl-2.5 text-[12.5px] text-ink-3 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink-2"
      >
        <Search size={14} aria-hidden />
        <span className="hidden sm:inline">Search or jump to</span>
        <Kbd className="ml-1 sm:ml-3">⌘K</Kbd>
      </button>
    </header>
  )
}
