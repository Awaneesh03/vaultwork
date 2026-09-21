import { Menu, Plus, Search } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { useUiStore } from '@/store/uiStore'

/**
 * The window's own bar: where you are, the one control that gets you anywhere
 * else, and (M18.3) the one control that takes in anything.
 *
 * Deliberately almost empty. Every pixel spent here is spent on every screen,
 * and the page below already says what it is — so this carries the route name,
 * capture, the search affordance, and nothing else.
 */
export function TopBar({ title }: { title: string }) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen)

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

      {/* M18.3: the one control that captures anything, on every screen. */}
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-accent-line/60 bg-accent-soft px-2.5 text-body text-accent transition-colors hover:border-accent-line hover:bg-accent-soft/80"
      >
        <Plus size={14} aria-hidden />
        <span className="hidden sm:inline">Capture</span>
        <Kbd className="ml-1 hidden sm:inline-flex">I</Kbd>
      </button>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="group flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface pr-1.5 pl-2.5 text-body text-ink-3 transition-colors hover:border-accent-line hover:bg-elevated hover:text-ink-2"
      >
        <Search size={14} aria-hidden />
        <span className="hidden sm:inline">Search or jump to</span>
        <Kbd className="ml-1 sm:ml-3">⌘K</Kbd>
      </button>
    </header>
  )
}
