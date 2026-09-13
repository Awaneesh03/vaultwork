import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ALL_NAV_ITEMS, SETTINGS_ITEM } from '@/app/navigation'
import { ToastHost } from '@/components/feedback/ToastHost'
import { NoteComposerHost } from '@/features/notes/components/NoteComposerHost'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { cn } from '@/lib/cn'
import { useGlobalShortcuts } from '@/app/shortcuts/useGlobalShortcuts'
import { useNativeMenu } from '@/app/hooks/useNativeMenu'
import { useTelegram } from '@/app/hooks/useTelegram'
import { useUiStore } from '@/store/uiStore'

function titleFor(pathname: string): string {
  const match = [...ALL_NAV_ITEMS, SETTINGS_ITEM].find((item) =>
    item.path === '/' ? pathname === '/' : pathname.startsWith(item.path),
  )
  return match?.label ?? 'Vaultwork'
}

/**
 * Sidebar on desktop, off-canvas drawer below `lg`. The layout is deliberately
 * plain: it is a frame for the work, and a frame that draws attention to itself
 * is a frame that is wrong.
 */
export function AppShell() {
  const location = useLocation()
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  useGlobalShortcuts()
  useNativeMenu()
  useTelegram()

  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Vaultwork`
  }, [location.pathname])

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 animate-[overlay-in_var(--duration-fast)_var(--ease-out)] bg-black/50 backdrop-blur-[2px]"
            onClick={() => setSidebarOpen(false)}
          />
          <div
            className={cn(
              'absolute inset-y-0 left-0 shadow-[var(--shadow-lg)]',
              'animate-[panel-in_var(--duration-base)_var(--ease-out)]',
            )}
          >
            <Sidebar />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={titleFor(location.pathname)} />
        <main className="flex-1 overflow-y-auto">
          {/*
            Keyed on the route so navigating re-runs the entrance. One short
            fade-and-rise: enough to say the page changed, short enough that a
            keyboard user moving quickly never waits for it. Reduced-motion
            users get none of it — see the media query in globals.css.
          */}
          <div
            key={location.pathname}
            className="mx-auto w-full max-w-6xl animate-[fade-rise_var(--duration-base)_var(--ease-out)] px-4 py-7 sm:px-6 lg:px-8"
          >
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette />
      <NoteComposerHost />
      <ToastHost />
    </div>
  )
}
