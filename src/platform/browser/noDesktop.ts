import type { DesktopPort } from '../ports'

/**
 * The desktop port for a browser build.
 *
 * A tab has no login item to register, so this reports `false` and refuses to
 * change it rather than pretending the setting took. Settings reads
 * `isSupported` and hides the control entirely, which is better than a
 * checkbox that silently does nothing.
 */
export const noDesktop: DesktopPort = {
  id: 'no-desktop',
  isSupported: false,

  async launchAtLogin() {
    return false
  },

  async setLaunchAtLogin() {
    return false
  },
}
