//! The native application menu.
//!
//! Deliberately small. The menu is not a second copy of the application's
//! command surface — it holds the handful of actions a macOS or Windows user
//! expects to find in a menu bar, and each one emits an event that the renderer
//! turns into the *same* command or navigation the UI already uses. Nothing
//! here reaches into application state, and no menu item performs work in Rust.

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

/// The event the renderer listens for. One event, one payload — so adding a
/// menu item later never means adding another listener.
pub const MENU_EVENT: &str = "vaultwork://menu";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Vaultwork")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Vaultwork"),
            Some(AboutMetadata {
                name: Some("Vaultwork".into()),
                version: Some(app.package_info().version.to_string()),
                comments: Some("A local-first personal productivity workspace.".into()),
                ..Default::default()
            }),
        )?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Vaultwork"))?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new-task", "New Task")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new-note", "New Note")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("export", "Export…").build(app)?)
        .item(&MenuItemBuilder::with_id("import", "Import…").build(app)?)
        .build()?;

    // Mostly predefined: without cut/copy/paste/select-all, macOS loses
    // Cmd+C/V/X/A *inside text fields*, which would break the note editor.
    //
    // Undo is the exception, and the reason is a genuine macOS constraint.
    // `PredefinedMenuItem::undo` carries the Cmd+Z key equivalent, and AppKit
    // resolves key equivalents against the main menu *before* the event
    // reaches the WebView's responder chain. With it in place, the web layer's
    // own Cmd+Z handler could never fire, so the application's undo stack —
    // the one behind the Undo toast — was unreachable from the keyboard on
    // desktop, while it worked in the browser.
    //
    // A custom item takes the same key equivalent and forwards it to the
    // renderer, which decides between text-editing undo and application undo
    // exactly the way the browser's keydown handler already does. One undo
    // stack, one rule about when it applies, two runtimes.
    //
    // Redo stays predefined: the application has no redo, so Shift+Cmd+Z
    // should keep meaning "redo my typing".
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("go-dashboard", "Dashboard")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-tasks", "Tasks")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-calendar", "Calendar")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go-notes", "Notes")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu])
}

/// Forwards a menu click to the renderer.
///
/// The Rust side does not know what "New Note" means, and should not: it emits
/// the id and the web layer dispatches the existing command. That keeps one
/// implementation of every action rather than two that can drift.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.as_str();
    // `settings`, `quit` and the predefined items are handled by Tauri itself
    // or by the renderer; anything unrecognised is simply not forwarded.
    let _ = app.emit(MENU_EVENT, id.to_string());
}
