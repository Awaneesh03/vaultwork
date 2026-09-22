//! Where the desktop build remembers which folder is the vault.
//!
//! A single JSON file in the OS application-config directory. Three reasons it
//! is not a Dexie table:
//!
//!  1. An absolute filesystem path is *machine* state, not application data. It
//!     must not travel in a backup export, because restoring that backup on
//!     another machine would point the app at a folder that does not exist.
//!  2. Dexie is the source of truth for notes, tasks, goals and habits. Adding
//!     a row for something the browser build can never have would mean a schema
//!     migration for a field only one runtime uses.
//!  3. The browser adapter already keeps its handle outside the Dexie database
//!     for exactly the same reason (`vaultwork-vault-handle`). This is the same
//!     decision, made the same way, on the other side of the port.
//!
//! Nothing sensitive goes in here — a folder path and nothing else. No tokens,
//! no note contents, no window contents.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "desktop-state.json";

#[derive(Default, Serialize, Deserialize)]
struct DesktopState {
    #[serde(default)]
    vault_path: Option<String>,
    /// The one Telegram chat allowed to drive this installation.
    ///
    /// Here rather than in Dexie for the same reason as the vault path: it is
    /// machine state. A backup restored on another machine must not carry an
    /// authorization with it, and a chat id has no meaning in an export.
    #[serde(default)]
    telegram_chat_id: Option<String>,
    /// Telegram's `getUpdates` cursor. An optimisation, not a correctness
    /// mechanism — the message log is what makes redelivery safe, so losing
    /// this file costs a few replayed updates and nothing else.
    #[serde(default)]
    telegram_offset: i64,
    #[serde(default)]
    telegram_auto_start: bool,
    /// Which AI model this installation asks for. `None` means the provider's
    /// own default. Non-secret: the key itself lives in the credential store.
    #[serde(default)]
    ai_model: Option<String>,
    /// Whether the AI provider may be called at all.
    ///
    /// `Option` rather than `bool` so that "never set" and "explicitly off" are
    /// different states: a fresh installation that has just saved a key should
    /// work, and `#[serde(default)]` on a plain bool would read as "off".
    #[serde(default)]
    ai_enabled: Option<bool>,
    /// The Google account (M19.2): which services were granted, whose account,
    /// since when, and whether Google has since refused it. Non-secret by
    /// construction — the refresh token is in the credential store, and no
    /// access token, code, verifier, state, message or event is ever kept.
    #[serde(default)]
    google: GoogleRecord,
}

#[derive(Default, Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct GoogleRecord {
    #[serde(default)]
    pub calendar: bool,
    #[serde(default)]
    pub gmail: bool,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub connected_at: Option<i64>,
    #[serde(default)]
    pub reconnect_required: bool,
}

fn file_of(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(FILE))
}

fn read(app: &AppHandle) -> DesktopState {
    let Some(path) = file_of(app) else { return DesktopState::default() };
    let Ok(raw) = fs::read_to_string(path) else { return DesktopState::default() };
    // A corrupt state file is a forgotten vault, not a failed launch.
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write(app: &AppHandle, state: &DesktopState) {
    let Some(path) = file_of(app) else { return };
    if let Ok(encoded) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, encoded);
    }
}

pub fn remember_vault(app: &AppHandle, root: Option<&std::path::Path>) {
    let mut state = read(app);
    state.vault_path = root.map(|path| path.to_string_lossy().to_string());
    write(app, &state);
}

pub fn remembered_vault(app: &AppHandle) -> Option<PathBuf> {
    read(app).vault_path.map(PathBuf::from)
}

// ------------------------------------------------------------------ telegram

pub fn remember_authorized_chat(app: &AppHandle, chat_id: Option<&str>) {
    let mut state = read(app);
    state.telegram_chat_id = chat_id.map(|id| id.to_string());
    write(app, &state);
}

pub fn authorized_chat(app: &AppHandle) -> Option<String> {
    read(app).telegram_chat_id
}

pub fn remember_telegram_offset(app: &AppHandle, offset: i64) {
    let mut state = read(app);
    state.telegram_offset = offset;
    write(app, &state);
}

pub fn telegram_offset(app: &AppHandle) -> i64 {
    read(app).telegram_offset
}

pub fn remember_telegram_auto_start(app: &AppHandle, enabled: bool) {
    let mut state = read(app);
    state.telegram_auto_start = enabled;
    write(app, &state);
}

pub fn telegram_auto_start(app: &AppHandle) -> bool {
    read(app).telegram_auto_start
}

// ----------------------------------------------------------------------- ai

pub fn remember_ai_model(app: &AppHandle, model: Option<&str>) {
    let mut state = read(app);
    state.ai_model = model.map(|value| value.to_string());
    write(app, &state);
}

pub fn ai_model(app: &AppHandle) -> Option<String> {
    read(app).ai_model
}

pub fn remember_ai_enabled(app: &AppHandle, enabled: bool) {
    let mut state = read(app);
    state.ai_enabled = Some(enabled);
    write(app, &state);
}

/// Whether AI may be called when the user has never said either way.
///
/// Off. A fresh installation must not acquire an external network capability by
/// default, and saving a key is not the same act as switching one on — a key
/// can be stored while the user is still deciding. Turning AI on is therefore
/// always an explicit `ai_set_enabled(true)`.
///
/// This also means an existing installation, whose `desktop-state.json` predates
/// the field entirely, stays off until it is asked.
const AI_ENABLED_BY_DEFAULT: bool = false;

/// Resolves the stored tri-state into the answer the provider acts on.
///
/// Split out from `ai_enabled` so the default is pinned by a test rather than
/// by reading the line: the whole point of the setting is what happens when
/// nothing has been stored, and that case needs no `AppHandle` to check.
fn resolve_ai_enabled(stored: Option<bool>) -> bool {
    stored.unwrap_or(AI_ENABLED_BY_DEFAULT)
}

pub fn ai_enabled(app: &AppHandle) -> bool {
    resolve_ai_enabled(read(app).ai_enabled)
}

/// Clears every AI setting. Leaves the vault and Telegram alone.
pub fn forget_ai(app: &AppHandle) {
    let mut state = read(app);
    state.ai_model = None;
    state.ai_enabled = None;
    write(app, &state);
}

pub fn google_record(app: &AppHandle) -> GoogleRecord {
    read(app).google
}

pub fn remember_google(app: &AppHandle, record: GoogleRecord) {
    let mut state = read(app);
    state.google = record;
    write(app, &state);
}

pub fn remember_google_account(app: &AppHandle, account: Option<&str>) {
    let mut state = read(app);
    state.google.account = account.map(String::from);
    write(app, &state);
}

/// Google refused the grant: the account is gone until the user reconnects.
pub fn mark_google_reconnect_required(app: &AppHandle) {
    let mut state = read(app);
    state.google = GoogleRecord { reconnect_required: true, ..GoogleRecord::default() };
    write(app, &state);
}

/// Clears every Google setting. Leaves the vault, Telegram and AI alone.
pub fn forget_google(app: &AppHandle) {
    let mut state = read(app);
    state.google = GoogleRecord::default();
    write(app, &state);
}

/// Clears every Telegram setting. Deliberately leaves `vault_path` alone —
/// disconnecting a bot is not disconnecting a vault.
pub fn forget_telegram(app: &AppHandle) {
    let mut state = read(app);
    state.telegram_chat_id = None;
    state.telegram_offset = 0;
    state.telegram_auto_start = false;
    write(app, &state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_is_off_until_it_is_explicitly_switched_on() {
        // The M15.1.1 rule, stated once: nothing stored means off. Saving a
        // Groq key writes a credential, not this field, so a configured
        // provider is still an idle one until the user says otherwise.
        assert!(!resolve_ai_enabled(None), "a fresh installation must not enable AI");
        assert!(resolve_ai_enabled(Some(true)), "an explicit yes enables it");
        assert!(!resolve_ai_enabled(Some(false)), "an explicit no disables it");
    }

    #[test]
    fn a_state_file_written_before_the_field_existed_stays_off() {
        // An M14-era file has no `ai_enabled` key at all. It must deserialise
        // to "never asked", which resolves to off — not to a silently enabled
        // network capability on the next launch.
        let legacy = r#"{
            "vault_path": null,
            "telegram_chat_id": "123",
            "telegram_offset": 42,
            "telegram_auto_start": false
        }"#;

        let state: DesktopState = serde_json::from_str(legacy).expect("an older file still parses");
        assert_eq!(state.ai_enabled, None);
        assert!(!resolve_ai_enabled(state.ai_enabled));
        // And the rest of the file survives the round trip untouched.
        assert_eq!(state.telegram_chat_id.as_deref(), Some("123"));
        assert_eq!(state.telegram_offset, 42);
        // Nor any Google record: a pre-M19.2 file is simply not connected.
        assert_eq!(state.google, GoogleRecord::default());
    }

    #[test]
    fn forgetting_ai_returns_it_to_the_disabled_default() {
        // `forget_ai` clears the field rather than storing `false`, so a
        // disconnected provider is back in the "never asked" state.
        let mut state = DesktopState { ai_enabled: Some(true), ..DesktopState::default() };
        state.ai_model = None;
        state.ai_enabled = None;
        assert!(!resolve_ai_enabled(state.ai_enabled));
    }
}
