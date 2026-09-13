import type { DesktopPort } from '../ports'
import type { TauriBridge } from './bridge'

/**
 * Launch at login, through Vaultwork's own commands.
 *
 * The native side uses `tauri-plugin-autostart`, but that is deliberately not
 * imported here: the renderer talks to two named commands like every other
 * native capability, so the plugin stays an implementation detail of the Rust
 * side and no component gains a second way to reach the OS.
 */
export function createTauriDesktop(bridge: TauriBridge): DesktopPort {
  return {
    id: 'tauri-desktop',
    isSupported: true,

    async launchAtLogin() {
      // A login item that cannot be read is reported as off rather than thrown.
      // Settings should show a definite, safe state; the user can still toggle
      // it, and that path does surface a failure.
      try {
        return await bridge.desktopLaunchAtLogin()
      } catch {
        return false
      }
    },

    setLaunchAtLogin(enabled: boolean) {
      // Deliberately not caught: changing a setting that silently failed is
      // exactly the case the user needs told about.
      return bridge.desktopSetLaunchAtLogin(enabled)
    },
  }
}
