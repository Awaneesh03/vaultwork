import { isMenuAction, type MenuPort } from '../ports'
import type { TauriBridge } from './bridge'

/**
 * The native menu, as far as the web layer is concerned.
 *
 * Rust emits an id; this turns it into a typed action and hands it upward. It
 * deliberately knows nothing about what the ids *mean* — "New Note" is a
 * command the application already has, and the menu must reuse it rather than
 * grow a second implementation that can drift from the button.
 */
export function createTauriMenu(bridge: TauriBridge): MenuPort {
  return {
    isSupported: true,

    async subscribe(handler) {
      return bridge.onMenu((id) => {
        // An id the web layer does not recognise is ignored rather than guessed
        // at: predefined items (Quit, Copy, Fullscreen) are handled natively
        // and never need to reach React.
        if (isMenuAction(id)) handler(id)
      })
    },
  }
}
