import { useLaunchAtLogin } from '../hooks/useLaunchAtLogin'

/**
 * Operating-system integration.
 *
 * One setting, and its whole job is to be distinguishable from the Telegram
 * one. "Start Telegram automatically" decides what happens once Vaultwork is
 * running; this decides whether Vaultwork is running at all. Somebody who
 * wants their bot to answer before they sit down needs both switched on, and
 * the copy says so rather than leaving it to be discovered.
 */
export function DesktopSection() {
  const launch = useLaunchAtLogin()

  if (!launch.supported) {
    return (
      <p className="t-meta max-w-prose text-ink-3">
        Login items are a desktop feature. This is the browser build, so there is nothing to
        register.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
        <input
          type="checkbox"
          className="mt-[3px]"
          checked={launch.enabled}
          disabled={launch.busy}
          onChange={(event) => void launch.set(event.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Launch Vaultwork at login</span>
          <span className="text-[12px] text-ink-3">
            Adds Vaultwork to your macOS login items. Combine it with “Start Telegram automatically”
            if you want the bot answering before you open the window.
          </span>
        </span>
      </label>

      {launch.error !== null ? (
        <p role="alert" className="text-[12px] text-danger">
          {launch.error}
        </p>
      ) : null}

      <p className="t-meta text-ink-3">
        Read from macOS each time this screen opens, so removing Vaultwork from System Settings is
        reflected here.
      </p>
    </div>
  )
}
