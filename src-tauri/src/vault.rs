//! The native vault bridge.
//!
//! This is the entire filesystem surface Vaultwork exposes to its own
//! renderer. There is no `read_any_file`, no `write_any_file` and no
//! `execute_command`, and the commands below deliberately do **not** take a
//! root directory as an argument: the root lives in Rust state and is set only
//! by `vault_connect` (the native picker, which is a user gesture) or by
//! `vault_restore` (a path the user previously picked). The renderer can
//! therefore name a file *within* the vault and nothing else — which is the
//! same capability the browser adapter gets from a `FileSystemDirectoryHandle`,
//! expressed the way a native process has to express it.
//!
//! Known limitation, stated rather than hidden: a symlink *inside* the vault
//! that points outside it will be followed, exactly as it would be by Obsidian
//! itself. Resolving that would mean canonicalising every path and refusing
//! vaults that legitimately use links, which is a worse trade for a
//! single-user desktop app than the honest note.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::paths::{check_relative, resolve_in_root, PathRejection};
use crate::store;

/// The connected vault. `None` until the user picks one.
#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
}

impl VaultState {
    fn get(&self) -> Option<PathBuf> {
        self.root.lock().ok().and_then(|guard| guard.clone())
    }

    fn set(&self, value: Option<PathBuf>) {
        if let Ok(mut guard) = self.root.lock() {
            *guard = value;
        }
    }

    /// Test seam. Connecting normally goes through the folder picker, which a
    /// test has no way to answer, so `tests/pdf_command.rs` points the state at
    /// a temporary directory directly. Never called by application code.
    #[doc(hidden)]
    pub fn set_for_test(&self, value: Option<PathBuf>) {
        self.set(value);
    }
}

/// What the renderer learns about a connection.
///
/// The folder *name*, never the absolute path: the TypeScript `VaultConnection`
/// contract has said "never an absolute path" since M10, and a desktop build is
/// not a reason to start leaking `/Users/<someone>/…` into a UI, an event log
/// or a backup export.
#[derive(Serialize)]
pub struct VaultConnectionDto {
    pub name: String,
    pub restorable: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct VaultEntryDto {
    pub name: String,
    pub path: String,
    pub kind: String,
}

/// A failure the renderer can translate into a `VaultError`.
///
/// `kind` is one of the existing `VaultErrorKind` strings — the desktop adapter
/// introduces no new failure vocabulary. `message` is written for a person and
/// never carries the absolute path; `path` is the vault-relative one the caller
/// already knows.
#[derive(Serialize, Deserialize, Debug)]
pub struct VaultFailure {
    pub kind: String,
    pub message: String,
    pub path: Option<String>,
}

impl VaultFailure {
    fn new(kind: &str, message: impl Into<String>, path: Option<String>) -> Self {
        Self { kind: kind.into(), message: message.into(), path }
    }

    fn not_connected() -> Self {
        Self::new("not-connected", "No Obsidian vault is connected.", None)
    }

    fn invalid(rejection: PathRejection, path: &str) -> Self {
        Self::new(
            "invalid-path",
            format!("Refused: {}.", rejection.reason()),
            Some(path.to_string()),
        )
    }
}

/// Translates an OS error into the vocabulary the UI already speaks.
///
/// Raw `io::Error` text ("No such file or directory (os error 2)") never
/// reaches a user, and neither does the absolute path it would otherwise
/// contain. The operation and the vault-relative path are kept, because those
/// are the two things that make a failure actionable.
fn translate(error: &std::io::Error, operation: &str, path: &str) -> VaultFailure {
    use std::io::ErrorKind;
    let (kind, message) = match error.kind() {
        ErrorKind::NotFound => ("not-found", format!("“{path}” is not in the vault.")),
        ErrorKind::PermissionDenied => (
            "permission-denied",
            format!("The system refused permission to {operation} “{path}”."),
        ),
        ErrorKind::InvalidData => (
            "read-failed",
            format!("“{path}” is not valid UTF-8 text."),
        ),
        _ if operation == "read" || operation == "list" => {
            ("read-failed", format!("Could not read “{path}”."))
        }
        _ => ("write-failed", format!("Could not {operation} “{path}”.")),
    };
    VaultFailure::new(kind, message, Some(path.to_string()))
}

fn root_of(state: &State<'_, VaultState>) -> Result<PathBuf, VaultFailure> {
    state.get().ok_or_else(VaultFailure::not_connected)
}

// ------------------------------------------------------------------- the core
//
// Every filesystem operation is a free function taking an explicit root, and
// every `#[tauri::command]` below is a two-line wrapper that supplies the root
// from state. That split is what lets `tests/filesystem.rs` drive the real
// thing against a real temporary directory: an integration test can call these
// without standing up an `AppHandle`, and there is no second implementation to
// keep in step, because the commands contain no logic of their own.

fn target(root: &Path, path: &str) -> Result<PathBuf, VaultFailure> {
    resolve_in_root(root, path).map_err(|rejection| VaultFailure::invalid(rejection, path))
}

pub fn read_in(root: &Path, path: &str) -> Result<String, VaultFailure> {
    let full = target(root, path)?;
    fs::read_to_string(&full).map_err(|error| translate(&error, "read", path))
}

/// The most text one PDF may contribute.
///
/// A bound rather than a guess. Extraction happens in this process, the result
/// crosses the bridge, and it is then stored and searched — so an unbounded
/// document is unbounded memory in three places at once. Roughly 150 pages of
/// dense prose, which is more than enough to search and far more than the AI
/// context layer will ever be shown.
pub const MAX_PDF_TEXT_CHARS: usize = 400_000;

/// A PDF's file size ceiling. Beyond this the file is reported, not parsed.
pub const MAX_PDF_BYTES: u64 = 64 * 1024 * 1024;

/// What extraction produced. Text only — the bytes never leave this process.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextDto {
    pub text: String,
    /// Characters actually returned, after any truncation.
    pub chars: usize,
    /// True when the document yielded no usable text at all.
    ///
    /// An image-only scan is the ordinary case, and it is reported rather than
    /// guessed at: there is no OCR here, and pretending otherwise would put
    /// invented content into a search index.
    pub empty: bool,
    /// True when `MAX_PDF_TEXT_CHARS` cut the text short.
    pub truncated: bool,
    /// The file's size on disk, for change detection and for the UI.
    pub bytes: u64,
}

/// Extracts a PDF's text layer.
///
/// Deliberately the only way PDF content can be obtained: the renderer receives
/// text, never bytes, and cannot ask for a file outside the vault because the
/// path goes through the same `target` check every other operation uses.
///
/// A PDF that cannot be parsed is not an error. A vault will contain encrypted
/// files, damaged files and pure scans, and one of them must not fail a scan of
/// the other ninety-nine — so an unreadable document comes back as `empty`.
pub fn read_pdf_text_in(root: &Path, path: &str) -> Result<PdfTextDto, VaultFailure> {
    let full = target(root, path)?;

    let metadata = fs::metadata(&full).map_err(|error| translate(&error, "read", path))?;
    if !metadata.is_file() {
        return Err(VaultFailure::new(
            "invalid-path",
            format!("\u{201c}{path}\u{201d} is not a file."),
            Some(path.to_string()),
        ));
    }

    let bytes_len = metadata.len();
    if bytes_len > MAX_PDF_BYTES {
        return Err(VaultFailure::new(
            "read-failed",
            "That PDF is too large to read.",
            Some(path.to_string()),
        ));
    }

    let bytes = fs::read(&full).map_err(|error| translate(&error, "read", path))?;

    // `pdf-extract` panics on some malformed documents rather than returning an
    // error. A panic here would take the whole command down, so it is caught and
    // reported as "no text" — the same answer a scanned page gives, which is the
    // honest one either way.
    let extracted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }))
    .unwrap_or_else(|_| Ok(String::new()))
    .unwrap_or_default();

    let cleaned = normalise_pdf_text(&extracted);
    let truncated = cleaned.chars().count() > MAX_PDF_TEXT_CHARS;
    let text: String = if truncated {
        cleaned.chars().take(MAX_PDF_TEXT_CHARS).collect()
    } else {
        cleaned
    };

    Ok(PdfTextDto {
        chars: text.chars().count(),
        empty: text.trim().is_empty(),
        truncated,
        bytes: bytes_len,
        text,
    })
}

/// Collapses extraction noise into something searchable.
///
/// Extractors emit long runs of blank lines where a page had images or ruled
/// paper, and trailing spaces on every line. Left alone, a mostly-blank scan
/// stores tens of thousands of newlines and a snippet search returns whitespace.
fn normalise_pdf_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut blank_run = 0usize;

    for line in raw.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            // One blank line survives, as a paragraph break. The rest are page
            // furniture.
            if blank_run > 1 {
                continue;
            }
            out.push('\n');
            continue;
        }
        blank_run = 0;
        out.push_str(trimmed);
        out.push('\n');
    }

    out.trim().to_string()
}

pub fn write_in(root: &Path, path: &str, contents: &str) -> Result<(), VaultFailure> {
    let full = target(root, path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|error| translate(&error, "write", path))?;
    }
    fs::write(&full, contents).map_err(|error| translate(&error, "write", path))
}

pub fn delete_in(root: &Path, path: &str) -> Result<(), VaultFailure> {
    let full = target(root, path)?;
    // Files only. A recursive directory removal is not an operation the vault
    // port has, and adding one here would be handing out a capability nothing
    // asked for.
    if full.is_dir() {
        return Err(VaultFailure::new(
            "invalid-path",
            format!("\u{201c}{path}\u{201d} is a folder, not a file."),
            Some(path.to_string()),
        ));
    }
    fs::remove_file(&full).map_err(|error| translate(&error, "delete", path))
}

pub fn exists_in(root: &Path, path: &str) -> Result<bool, VaultFailure> {
    Ok(target(root, path)?.is_file())
}

pub fn create_dir_in(root: &Path, path: &str) -> Result<(), VaultFailure> {
    let full = target(root, path)?;
    // Idempotent, matching the port contract: creating a directory that already
    // exists is not an error.
    fs::create_dir_all(&full).map_err(|error| translate(&error, "create", path))
}

pub fn list_in(root: &Path, path: Option<&str>) -> Result<Vec<VaultEntryDto>, VaultFailure> {
    let relative = path.unwrap_or_default();

    let (full, prefix) = if relative.is_empty() {
        (root.to_path_buf(), String::new())
    } else {
        let checked =
            check_relative(relative).map_err(|why| VaultFailure::invalid(why, relative))?;
        (target(root, relative)?, format!("{checked}/"))
    };

    let reader = fs::read_dir(&full).map_err(|error| translate(&error, "list", relative))?;

    let mut entries = Vec::new();
    for item in reader {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        let Ok(kind) = item.file_type() else { continue };

        entries.push(VaultEntryDto {
            path: format!("{prefix}{name}"),
            name,
            kind: if kind.is_dir() { "directory".into() } else { "file".into() },
        });
    }

    // The renderer sorts too (see `tauriVault.listDirectory`), so that both
    // runtimes agree; this only makes the native answer deterministic.
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Whether a folder is readable right now, as a permission string.
pub fn probe(root: &Path) -> String {
    if !root.is_dir() {
        return "denied".into();
    }
    match fs::read_dir(root) {
        Ok(_) => "granted".into(),
        Err(_) => "denied".into(),
    }
}

fn name_of(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "vault".to_string())
}

// --------------------------------------------------------------- connection

#[tauri::command]
pub async fn vault_connect(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Option<VaultConnectionDto>, VaultFailure> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);

    app.dialog()
        .file()
        .set_title("Choose your Obsidian vault")
        .pick_folder(move |chosen| {
            // Capacity 1, sent exactly once: this cannot fail, and a dropped
            // receiver is not worth propagating.
            let _ = tx.try_send(chosen);
        });

    let picked = rx.recv().await.flatten().and_then(|file| file.into_path().ok());

    let Some(root) = picked else {
        // The user closing the picker is a decision, not a failure — the same
        // `aborted` the browser adapter reports for a dismissed picker.
        return Err(VaultFailure::new("aborted", "No folder was chosen.", None));
    };

    if !root.is_dir() {
        return Err(VaultFailure::new(
            "not-found",
            "That folder could not be opened.",
            None,
        ));
    }

    state.set(Some(root.clone()));
    store::remember_vault(&app, Some(&root));

    Ok(Some(VaultConnectionDto { name: name_of(&root), restorable: true }))
}

#[tauri::command]
pub fn vault_disconnect(app: AppHandle, state: State<'_, VaultState>) {
    // Forgets where the vault is. Deliberately touches nothing inside it —
    // disconnecting is not deleting, and it does not reach application data
    // either: notes, tasks, goals and habits live in IndexedDB and are not
    // this process's business.
    state.set(None);
    store::remember_vault(&app, None);
}

#[tauri::command]
pub fn vault_current(state: State<'_, VaultState>) -> Option<VaultConnectionDto> {
    state
        .get()
        .map(|root| VaultConnectionDto { name: name_of(&root), restorable: true })
}

#[tauri::command]
pub fn vault_restore(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Option<VaultConnectionDto> {
    if let Some(existing) = state.get() {
        return Some(VaultConnectionDto { name: name_of(&existing), restorable: true });
    }

    let remembered = store::remembered_vault(&app)?;
    // A remembered folder that has since been moved, renamed or unmounted is
    // not a connection. Reporting one would let the UI claim "connected" and
    // then fail on the first read.
    if !remembered.is_dir() {
        return None;
    }

    state.set(Some(remembered.clone()));
    Some(VaultConnectionDto { name: name_of(&remembered), restorable: true })
}

/// Whether the vault is actually reachable right now.
///
/// A desktop app has no permission prompt to show, so this is a *liveness*
/// answer rather than a stored grant: the folder is read to find out. That is
/// what makes an unplugged drive or a folder deleted behind the app's back
/// report `denied` instead of a confident lie.
#[tauri::command]
pub fn vault_permission(state: State<'_, VaultState>) -> String {
    match state.get() {
        None => "prompt".into(),
        Some(root) => probe(&root),
    }
}

// --------------------------------------------------------------- operations

#[tauri::command]
pub fn vault_read(state: State<'_, VaultState>, path: String) -> Result<String, VaultFailure> {
    read_in(&root_of(&state)?, &path)
}

/// Text from one PDF inside the connected vault.
///
/// `async` and off the main thread, unlike every other vault command here, and
/// for a reason those do not have: parsing a PDF is *slow* — seconds for a few
/// megabytes — while reading or listing a file is not. A synchronous command is
/// executed on the thread that received the IPC message, which on macOS is the
/// main thread inside WebKit's URL-scheme handler; a three-second parse there
/// freezes the window, and that is exactly where the crash report placed the
/// abort this fix is for.
///
/// The vault root is resolved *before* the work is handed over, so the state
/// lock is never held across an await.
#[tauri::command]
pub async fn vault_read_pdf_text(
    state: State<'_, VaultState>,
    path: String,
) -> Result<PdfTextDto, VaultFailure> {
    // The root is resolved here, synchronously, so the state lock is never held
    // across an await. Everything after this point is testable without Tauri.
    let root = root_of(&state)?;
    read_pdf_text_off_thread(root, path).await
}

/// The body of `vault_read_pdf_text`, with the Tauri state already resolved.
///
/// Split out so the part that can actually go wrong — the hop onto a worker
/// thread, and what happens when the work on it dies — is reachable from a test.
/// The command itself is then a two-line wrapper with nothing left to get wrong,
/// which matters here: an untested wrapper around a guarded function is exactly
/// how the abort reached a shipped build.
pub async fn read_pdf_text_off_thread(
    root: PathBuf,
    path: String,
) -> Result<PdfTextDto, VaultFailure> {
    tauri::async_runtime::spawn_blocking(move || read_pdf_text_in(&root, &path))
        .await
        .unwrap_or_else(|_| {
            // The worker died rather than returning. With the guard inside
            // `read_pdf_text_in` that should be unreachable, so it is reported
            // as an ordinary read failure: one bad document costs one document,
            // even if the guard is one day moved or removed.
            Err(VaultFailure::new(
                "read-failed",
                "That PDF could not be read.",
                None,
            ))
        })
}

#[tauri::command]
pub fn vault_write(
    state: State<'_, VaultState>,
    path: String,
    contents: String,
) -> Result<(), VaultFailure> {
    write_in(&root_of(&state)?, &path, &contents)
}

#[tauri::command]
pub fn vault_delete(state: State<'_, VaultState>, path: String) -> Result<(), VaultFailure> {
    delete_in(&root_of(&state)?, &path)
}

#[tauri::command]
pub fn vault_exists(state: State<'_, VaultState>, path: String) -> Result<bool, VaultFailure> {
    exists_in(&root_of(&state)?, &path)
}

#[tauri::command]
pub fn vault_create_dir(state: State<'_, VaultState>, path: String) -> Result<(), VaultFailure> {
    create_dir_in(&root_of(&state)?, &path)
}

#[tauri::command]
pub fn vault_list(
    state: State<'_, VaultState>,
    path: Option<String>,
) -> Result<Vec<VaultEntryDto>, VaultFailure> {
    list_in(&root_of(&state)?, path.as_deref())
}

/// Everything a diagnostics panel is allowed to know about the native side.
#[derive(Serialize)]
pub struct RuntimeInfoDto {
    pub platform: String,
    pub arch: String,
    pub tauri_version: String,
    pub app_version: String,
}

#[tauri::command]
pub fn runtime_info(app: AppHandle) -> RuntimeInfoDto {
    RuntimeInfoDto {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        app_version: app.package_info().version.to_string(),
    }
}
