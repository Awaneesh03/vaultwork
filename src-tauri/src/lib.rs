//! Vaultwork's desktop shell.
//!
//! The guiding rule of M13: **Tauri is a runtime adapter around Vaultwork, not
//! a replacement for Vaultwork's architecture.** No application logic lives in
//! this crate. There is no database here, no note model, no sync algorithm and
//! no knowledge graph — those stay in TypeScript, where they are tested, and
//! the data stays in IndexedDB inside the WebView.
//!
//! What this crate provides is exactly three things the browser cannot:
//!
//!   1. a native folder picker and unsandboxed reads/writes *within* that one
//!      folder (`vault.rs`),
//!   2. OS notifications and a native menu bar,
//!   3. somewhere machine-local to remember which folder was picked
//!      (`store.rs`).

mod ai;
mod menu;
mod paths;
mod secrets;
mod store;
mod telegram;
// Public so `tests/filesystem.rs` can drive the real filesystem functions
// against a temporary directory. Only the free functions are reachable; the
// commands still need an `AppHandle` and Tauri's own state.
pub mod vault;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Window geometry is restored by the plugin rather than by application
        // code: it is the one piece of state that belongs to the shell.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(vault::VaultState::default())
        .manage(Arc::new(telegram::TelegramState::default()))
        .manage(Arc::new(ai::AiState::default()))
        .setup(|app| {
            let handle = app.handle();
            app.set_menu(menu::build(handle)?)?;

            // Restoring at start-up means the vault is already connected by the
            // time the UI asks, so a desktop user does not re-pick their folder
            // on every launch the way a browser user must re-grant permission.
            let state = app.state::<vault::VaultState>();
            let _ = vault::vault_restore(handle.clone(), state);

            // Telegram starts only if the user asked it to. Default off: a
            // network integration that begins polling the moment the app opens
            // is a surprise, and an invalid token would then greet every launch
            // with an error nobody asked for.
            // One credential-store access per launch, cached from here on.
            telegram::prime(handle);

            // The same, for the AI provider: Settings has to be able to say
            // "Configured" or "Not configured" without guessing, and asking
            // once per launch is the whole cost. No request is made here —
            // an AI provider that called out at start-up would be a surprise.
            ai::prime(handle);
            // `prime` above has just set `configured` from the credential
            // store, so both halves of this decision are known without a
            // second keychain read.
            if telegram::should_auto_start(
                store::telegram_auto_start(handle),
                telegram::is_configured(handle),
            ) {
                telegram::start_worker(handle.clone());
            }
            Ok(())
        })
        .on_menu_event(|app, event| menu::on_event(app, event))
        .invoke_handler(tauri::generate_handler![
            vault::vault_connect,
            vault::vault_disconnect,
            vault::vault_current,
            vault::vault_restore,
            vault::vault_permission,
            vault::vault_read,
            vault::vault_write,
            vault::vault_delete,
            vault::vault_exists,
            vault::vault_create_dir,
            vault::vault_list,
            vault::vault_read_pdf_text,
            vault::runtime_info,
            telegram::telegram_status,
            telegram::telegram_configure,
            telegram::telegram_test,
            telegram::telegram_start,
            telegram::telegram_stop,
            telegram::telegram_authorize,
            telegram::telegram_send,
            telegram::telegram_ack,
            telegram::telegram_set_auto_start,
            telegram::telegram_disconnect,
            ai::ai_status,
            ai::ai_configure,
            ai::ai_disconnect,
            ai::ai_set_enabled,
            ai::ai_set_model,
            ai::ai_test,
            ai::ai_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vaultwork");
}
