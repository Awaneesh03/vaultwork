import { create } from 'zustand'
import type { MenuAction } from '@/platform'

/**
 * Ephemeral UI state — and nothing else.
 *
 * The rule: if it should survive a refresh it belongs in Dexie; if it should
 * not, it belongs here. No Dexie row is ever copied into this store, because
 * two copies of the same data is a synchronisation bug waiting to happen.
 */
interface UiState {
  sidebarOpen: boolean
  commandPaletteOpen: boolean
  /**
   * A native menu item the user picked that the screen owning it must perform.
   *
   * Only for actions whose implementation already lives inside a screen —
   * Export and Import are the settings page's buttons, and the menu must press
   * those rather than grow a second copy of them that can drift. Actions the
   * shell can perform itself (navigation, opening a composer) never come
   * through here; they are done immediately.
   *
   * Ephemeral by construction: a pending request that outlived a refresh would
   * export a backup the user asked for in a previous session.
   */
  menuRequest: MenuAction | null
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleCommandPalette: () => void
  requestMenuAction: (action: MenuAction) => void
  clearMenuRequest: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  commandPaletteOpen: false,
  menuRequest: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  requestMenuAction: (menuRequest) => set({ menuRequest }),
  clearMenuRequest: () => set({ menuRequest: null }),
}))
