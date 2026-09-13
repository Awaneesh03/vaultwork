//! Desktop integration that is neither vault, Telegram nor AI.
//!
//! Currently one thing: whether macOS should open Vaultwork after login.
//!
//! This is *not* Telegram auto-start, and keeping the two apart matters. The
//! Telegram setting decides what happens once Vaultwork is running; this one
//! decides whether Vaultwork is running at all. Someone who wants their bot to
//! answer in the morning needs both, and being told that plainly is better than
//! discovering it at ten o'clock.
//!
//! The mechanism is `tauri-plugin-autostart`, which registers a real macOS
//! login item. Deliberately not a shell script, a LaunchAgent plist written by
//! hand, a cron entry or anything holding an absolute path to this build — all
//! of which survive an uninstall and none of which the user can turn off from
//! the place they turned on.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Why the setting could not be read or changed, in words a person can act on.
///
/// Same shape as the other error DTOs here: a machine-readable `kind` and a
/// message that never quotes an OS error verbatim, because those carry absolute
/// paths and the renderer has no business seeing one.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFailure {
    pub kind: String,
    pub message: String,
}

impl DesktopFailure {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }
}

/// Whether Vaultwork is currently registered to open after login.
///
/// Asked of the OS rather than remembered in `desktop-state`, so the answer
/// stays true when the login item is removed from System Settings behind the
/// app's back. A remembered copy would drift and the checkbox would lie.
#[tauri::command]
pub fn desktop_launch_at_login(app: AppHandle) -> Result<bool, DesktopFailure> {
    app.autolaunch()
        .is_enabled()
        .map_err(|_| DesktopFailure::new("unavailable", "Could not read the login item."))
}

#[tauri::command]
pub fn desktop_set_launch_at_login(
    app: AppHandle,
    enabled: bool,
) -> Result<bool, DesktopFailure> {
    let manager = app.autolaunch();

    let outcome = if enabled { manager.enable() } else { manager.disable() };
    outcome.map_err(|_| {
        DesktopFailure::new(
            "unavailable",
            if enabled {
                "Could not add Vaultwork to your login items."
            } else {
                "Could not remove Vaultwork from your login items."
            },
        )
    })?;

    // The OS is asked again rather than the requested value being echoed back:
    // a write that reported success and did not take effect would otherwise
    // leave the checkbox showing something untrue.
    desktop_launch_at_login(app)
}
