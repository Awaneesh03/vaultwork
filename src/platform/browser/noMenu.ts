import type { MenuPort } from '../ports'

/** A browser tab has no menu bar. Subscribing succeeds and never fires. */
export const noMenu: MenuPort = {
  isSupported: false,
  async subscribe() {
    return () => {}
  },
}
