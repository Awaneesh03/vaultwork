//! The MCP snapshot file (M18.1).
//!
//! One command, one destination, one direction: the renderer hands over a JSON
//! document and Rust writes it to a fixed file in the application-config
//! directory. That is the whole native surface of the MCP integration.
//!
//! What this is deliberately *not*:
//!
//!  - not a file-write command. The renderer names no path, so it cannot reach
//!    anything but this one file. A `write_file(path, contents)` would have
//!    handed the WebView the filesystem, which is precisely what
//!    `capabilities/default.json` refuses to grant it.
//!  - not a reader. Nothing here returns the snapshot, so a compromised
//!    renderer cannot use this module to read back what another process wrote.
//!
//! The MCP server reads the file directly with its own OS permissions. It never
//! talks to this process, which is why M18.1 needs no socket, no port and no
//! token: the file, at `0600`, is the whole interface.

use std::fs;
use std::io;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Same directory as `desktop-state.json`, by the same helper Tauri gives every
/// platform. Machine-local state belongs together, and inventing a second
/// config location would mean two answers to "where does Vaultwork keep this?".
const FILE: &str = "mcp-snapshot.json";

/// What a development build publishes instead.
///
/// Both builds share one bundle identifier, so they share one config directory
/// — but they do *not* share a WebView, and therefore do not share a database:
/// `npm run desktop` stores under the binary name, the packaged app under the
/// identifier. Before this split, whichever ran last owned the single snapshot,
/// so starting the dev build replaced a real day with seeded fixtures and the
/// MCP server answered from those. Which build wrote a file is something only
/// the build knows, so the choice is made here rather than passed in — the
/// renderer still names nothing.
const DEV_FILE: &str = "mcp-snapshot.dev.json";

const fn file_name() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_FILE
    } else {
        FILE
    }
}

/// A ceiling on what one snapshot may be.
///
/// The renderer already bounds every collection it projects, so this is the
/// backstop for a bug on that side rather than the primary limit: a snapshot
/// that has grown past a quarter-megabyte is a projection that stopped
/// projecting, and writing it would quietly turn a bounded export into a
/// database dump.
const MAX_BYTES: usize = 256 * 1024;

/// A failure the renderer can render, in the shape M14 established for
/// Telegram: a stable `kind` to branch on and a sentence a person can read.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpError {
    pub kind: String,
    pub message: String,
}

impl McpError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }
}

/// Everything about the payload that can be judged without touching the disk.
///
/// Split out so the rules are testable without an `AppHandle`: the command is
/// then only the part that needs Tauri.
pub fn check(contents: &str) -> Result<(), McpError> {
    if contents.len() > MAX_BYTES {
        return Err(McpError::new(
            "too-large",
            format!("The snapshot is larger than the {MAX_BYTES} byte ceiling."),
        ));
    }
    // Parsed, not merely non-empty. A half-written snapshot must fail here
    // rather than at the far end, where the MCP server would have to explain a
    // truncated file to whoever is reading it.
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|_| McpError::new("not-json", "The snapshot is not valid JSON."))?;
    Ok(())
}

fn file_of(app: &AppHandle) -> Result<PathBuf, McpError> {
    let unavailable =
        || McpError::new("no-config-dir", "The application config directory is unavailable.");
    let dir = app.path().app_config_dir().map_err(|_| unavailable())?;
    fs::create_dir_all(&dir).map_err(|_| unavailable())?;
    Ok(dir.join(file_name()))
}

/// Writes the file with owner-only permissions.
///
/// The mode is set through `OpenOptions` rather than after the fact, so the
/// snapshot is never briefly world-readable between creation and `chmod` —
/// a window that matters here because the content is the user's own day.
fn write_private(path: &PathBuf, contents: &str) -> io::Result<()> {
    use io::Write as _;

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }

    let mut file = options.open(path)?;
    file.write_all(contents.as_bytes())?;
    // An existing file keeps the mode it was created with, so re-assert it:
    // a snapshot written before this rule existed must not stay readable.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    file.sync_all()
}

/// Replaces the snapshot. Returns nothing but success or a reason.
///
/// Note the absence of the contents in every error: a failure here is reported
/// by kind, never by echoing the user's day into a log line.
#[tauri::command]
pub fn mcp_snapshot_write(app: AppHandle, contents: String) -> Result<(), McpError> {
    check(&contents)?;
    let path = file_of(&app)?;
    write_private(&path, &contents)
        .map_err(|_| McpError::new("write-failed", "The snapshot could not be written."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_development_build_never_writes_over_the_real_snapshot() {
        // The test binary is itself a debug build, so this is the dev answer.
        assert_eq!(file_name(), DEV_FILE);
        assert_ne!(DEV_FILE, FILE, "the two builds must not share one file");
    }

    #[test]
    fn rejects_a_payload_that_is_not_json() {
        assert_eq!(check("not json at all").unwrap_err().kind, "not-json");
        assert_eq!(check("{\"schemaVersion\":1").unwrap_err().kind, "not-json");
    }

    #[test]
    fn rejects_a_payload_past_the_ceiling() {
        let huge = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_BYTES));
        assert_eq!(check(&huge).unwrap_err().kind, "too-large");
    }

    #[test]
    fn accepts_a_bounded_json_document() {
        assert!(check("{\"schemaVersion\":1,\"tasks\":[]}").is_ok());
    }

    #[test]
    fn writes_owner_only_and_replaces_rather_than_appends() {
        let dir = std::env::temp_dir().join("vaultwork-mcp-snapshot-test");
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join(file_name());

        write_private(&path, "{\"schemaVersion\":1,\"first\":true}").expect("first write");
        write_private(&path, "{\"schemaVersion\":1}").expect("second write");

        let written = fs::read_to_string(&path).expect("read back");
        assert_eq!(written, "{\"schemaVersion\":1}", "a rewrite truncates");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "the snapshot is owner-only");
        }

        let _ = fs::remove_dir_all(&dir);
    }
}
