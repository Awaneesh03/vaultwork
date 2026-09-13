//! Vault path validation.
//!
//! The TypeScript side validates every path before it reaches the bridge
//! (`integrations/obsidian/vaultPath.ts`), and this module validates it again
//! on arrival. That duplication is deliberate: the Rust process is what
//! actually holds the filesystem capability, and a check that lives only in the
//! renderer is a check that a compromised or buggy renderer does not perform.
//!
//! The rule is the same one the browser adapter lives by — the connected vault
//! folder is the entire extent of the permission the user granted, and nothing
//! may resolve outside it.

use std::path::{Component, Path, PathBuf};

/// Why a path was refused. Maps 1:1 onto the TypeScript `VaultErrorKind`.
#[derive(Debug, PartialEq, Eq)]
pub enum PathRejection {
    Empty,
    Absolute,
    DriveLetter,
    Unc,
    Url,
    Traversal,
    RelativeSegment,
    EmptySegment,
    NullByte,
    EncodedTraversal,
}

impl PathRejection {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Empty => "the path is empty",
            Self::Absolute => "absolute paths are not vault paths",
            Self::DriveLetter => "a drive letter is not a vault path",
            Self::Unc => "a UNC path is not a vault path",
            Self::Url => "a URL is not a vault path",
            Self::Traversal => "the path leaves the vault",
            Self::RelativeSegment => "the path contains a \".\" segment",
            Self::EmptySegment => "the path contains an empty segment",
            Self::NullByte => "the path contains a NUL byte",
            Self::EncodedTraversal => "the path contains percent-encoded traversal",
        }
    }
}

/// Checks a vault-relative path and returns it normalised to forward slashes.
///
/// Directories and files share this check; the `.md` extension rule lives in
/// TypeScript because only *files* carry it, and `notes/dsa` is a legitimate
/// directory argument to `vault_list` and `vault_create_dir`.
pub fn check_relative(path: &str) -> Result<String, PathRejection> {
    if path.trim().is_empty() {
        return Err(PathRejection::Empty);
    }
    if path.contains('\0') {
        return Err(PathRejection::NullByte);
    }

    let lowered = path.to_ascii_lowercase();
    if lowered.contains("%2e%2e") {
        return Err(PathRejection::EncodedTraversal);
    }

    // A backslash separates on Windows, so it is judged as a separator here
    // rather than treated as an ordinary character a traversal could hide in.
    let candidate = path.replace('\\', "/");

    if candidate.starts_with("//") {
        return Err(PathRejection::Unc);
    }
    if candidate.starts_with('/') {
        return Err(PathRejection::Absolute);
    }
    if candidate.len() >= 2 && candidate.as_bytes()[1] == b':' {
        return Err(PathRejection::DriveLetter);
    }
    if candidate.contains("://") {
        return Err(PathRejection::Url);
    }

    for segment in candidate.split('/') {
        match segment {
            "" => return Err(PathRejection::EmptySegment),
            "." => return Err(PathRejection::RelativeSegment),
            ".." => return Err(PathRejection::Traversal),
            _ => {}
        }
    }

    Ok(candidate)
}

/// Joins a checked relative path onto the vault root.
///
/// The string check above rejects traversal syntactically; this adds the
/// structural guarantee by walking the joined components and refusing anything
/// the OS would interpret as a root, a prefix or a parent. A symlink inside the
/// vault can still point outside it — see the note in `vault.rs`.
pub fn resolve_in_root(root: &Path, relative: &str) -> Result<PathBuf, PathRejection> {
    let checked = check_relative(relative)?;
    let mut out = root.to_path_buf();

    for component in Path::new(&checked).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => return Err(PathRejection::RelativeSegment),
            Component::ParentDir => return Err(PathRejection::Traversal),
            Component::RootDir => return Err(PathRejection::Absolute),
            Component::Prefix(_) => return Err(PathRejection::DriveLetter),
        }
    }

    if !out.starts_with(root) {
        return Err(PathRejection::Traversal);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_vault_paths() {
        assert_eq!(check_relative("notes/binary-search.md").unwrap(), "notes/binary-search.md");
        assert_eq!(check_relative("notes/dsa").unwrap(), "notes/dsa");
        assert_eq!(check_relative("a.md").unwrap(), "a.md");
    }

    #[test]
    fn rejects_every_shape_of_escape() {
        for bad in [
            "",
            "   ",
            "../outside.md",
            "../../outside.md",
            "notes/../../outside.md",
            "/etc/passwd",
            "C:/Windows/system32",
            "//server/share/file.md",
            "file:///etc/passwd",
            "https://example.com/x.md",
            "notes//a.md",
            "notes/./a.md",
            "notes/%2e%2e/a.md",
            "notes/%2E%2E/a.md",
        ] {
            assert!(check_relative(bad).is_err(), "should have rejected {bad:?}");
        }
        assert_eq!(check_relative("a\0b.md"), Err(PathRejection::NullByte));
    }

    #[test]
    fn treats_a_backslash_as_a_separator() {
        assert_eq!(check_relative("notes\\..\\outside.md"), Err(PathRejection::Traversal));
        assert_eq!(check_relative("notes\\a.md").unwrap(), "notes/a.md");
    }

    #[test]
    fn resolves_only_inside_the_root() {
        let root = Path::new("/vault");
        assert_eq!(
            resolve_in_root(root, "notes/a.md").unwrap(),
            PathBuf::from("/vault/notes/a.md")
        );
        assert!(resolve_in_root(root, "../a.md").is_err());
        assert!(resolve_in_root(root, "/a.md").is_err());
    }
}
