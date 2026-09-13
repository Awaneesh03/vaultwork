import { create } from 'zustand'
import type { NoteFilterKind } from '@/services'
import type { Id } from '@/types/entities'

/**
 * Ephemeral state for the Notes screens.
 *
 * No note body lives here. The editor holds the text being typed in local
 * component state and the database holds what has been saved; putting a draft
 * in a global store would give the application two copies of the truth and a
 * reason for them to diverge.
 */

export type EditorMode = 'edit' | 'split' | 'preview'

interface NoteUiState {
  filter: NoteFilterKind
  /** Set from `?tag=` — narrows the list to one tag. */
  tagId: Id | null
  search: string
  /** The quick-capture composer, reachable from anywhere with Shift+N. */
  composerOpen: boolean
  mode: EditorMode
  searchFocusNonce: number
  /** Set when the composer is opened from an entity screen. */
  composerLink: { refType: string; refId: Id } | null

  setFilter: (filter: NoteFilterKind) => void
  setTagId: (tagId: Id | null) => void
  setSearch: (search: string) => void
  setMode: (mode: EditorMode) => void
  openComposer: (link?: { refType: string; refId: Id } | null) => void
  closeComposer: () => void
  focusSearch: () => void
  reset: () => void
}

export const useNoteUiStore = create<NoteUiState>((set) => ({
  filter: 'all',
  tagId: null,
  search: '',
  composerOpen: false,
  // Split by default: the point of a markdown editor is seeing both.
  mode: 'split',
  searchFocusNonce: 0,
  composerLink: null,

  setFilter: (filter) => set({ filter }),
  setTagId: (tagId) => set({ tagId }),
  setSearch: (search) => set({ search }),
  setMode: (mode) => set({ mode }),
  openComposer: (composerLink = null) => set({ composerOpen: true, composerLink }),
  closeComposer: () => set({ composerOpen: false, composerLink: null }),
  focusSearch: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),

  /**
   * Clears the per-visit state. `mode` is deliberately *not* included: which
   * pane you like is a preference that should survive walking between notes,
   * whereas a filter left applied is a good way to think you have no notes.
   */
  reset: () =>
    set({ filter: 'all', tagId: null, search: '', composerOpen: false, composerLink: null }),
}))
