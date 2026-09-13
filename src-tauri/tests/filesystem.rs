//! The native vault against a real filesystem.
//!
//! The TypeScript adapter tests drive `tauriVault` through a fake bridge, which
//! proves the translation layer. These prove the other half: that the Rust
//! functions actually behave that way when `std::fs` is doing the work — that a
//! traversing path really cannot escape the directory, that a missing file
//! really produces `not-found`, that `create_dir` really is idempotent.
//!
//! They run against a temporary directory created per test, so they exercise
//! the real macOS/Linux/Windows filesystem rather than a model of one.

use std::fs;
use std::path::{Path, PathBuf};

use vaultwork_lib::vault::{
    create_dir_in, delete_in, exists_in, list_in, probe, read_in, read_pdf_text_in,
    read_pdf_text_off_thread, write_in, MAX_PDF_TEXT_CHARS,
};

/// A throwaway directory, removed when the test ends.
struct TempVault {
    root: PathBuf,
}

impl TempVault {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "vaultwork-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("could not create the temporary vault");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
    }
}

impl Drop for TempVault {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn writes_reads_and_deletes_a_real_file() {
    let vault = TempVault::new("roundtrip");

    write_in(vault.path(), "notes/binary-search.md", "# Binary Search\n").unwrap();

    // Really on disk, not merely reported as written.
    let on_disk = fs::read_to_string(vault.path().join("notes/binary-search.md")).unwrap();
    assert_eq!(on_disk, "# Binary Search\n");

    assert_eq!(read_in(vault.path(), "notes/binary-search.md").unwrap(), "# Binary Search\n");
    assert!(exists_in(vault.path(), "notes/binary-search.md").unwrap());

    delete_in(vault.path(), "notes/binary-search.md").unwrap();
    assert!(!exists_in(vault.path(), "notes/binary-search.md").unwrap());
    assert!(!vault.path().join("notes/binary-search.md").exists());
}

#[test]
fn creates_missing_parents_on_write() {
    let vault = TempVault::new("parents");

    write_in(vault.path(), "notes/dsa/deep/nested.md", "x").unwrap();
    assert!(vault.path().join("notes/dsa/deep").is_dir());
}

#[test]
fn creating_a_directory_is_idempotent() {
    let vault = TempVault::new("mkdir");

    create_dir_in(vault.path(), "notes/dsa").unwrap();
    // The port contract says creating a directory that exists is not an error.
    create_dir_in(vault.path(), "notes/dsa").unwrap();
    assert!(vault.path().join("notes/dsa").is_dir());
}

#[test]
fn lists_a_directory_with_vault_relative_paths() {
    let vault = TempVault::new("list");

    write_in(vault.path(), "notes/a.md", "a").unwrap();
    write_in(vault.path(), "notes/dsa/b.md", "b").unwrap();
    write_in(vault.path(), "README.md", "r").unwrap();

    let root = list_in(vault.path(), None).unwrap();
    let names: Vec<&str> = root.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(names, vec!["README.md", "notes"]);
    assert_eq!(root[1].kind, "directory");

    let inside = list_in(vault.path(), Some("notes")).unwrap();
    let paths: Vec<&str> = inside.iter().map(|entry| entry.path.as_str()).collect();
    // Never absolute: the port has promised vault-relative paths since M10.
    assert_eq!(paths, vec!["notes/a.md", "notes/dsa"]);
}

#[test]
fn a_missing_file_is_not_found_rather_than_an_io_error() {
    let vault = TempVault::new("missing");

    let failure = read_in(vault.path(), "notes/nope.md").unwrap_err();
    assert_eq!(failure.kind, "not-found");
    assert_eq!(failure.path.as_deref(), Some("notes/nope.md"));

    // The user must never see "No such file or directory (os error 2)", nor the
    // absolute path of their own home directory.
    assert!(!failure.message.contains("os error"));
    assert!(!failure.message.contains(vault.path().to_string_lossy().as_ref()));
}

#[test]
fn deleting_a_directory_is_refused() {
    let vault = TempVault::new("rmdir");
    create_dir_in(vault.path(), "notes/dsa").unwrap();

    let failure = delete_in(vault.path(), "notes/dsa").unwrap_err();
    assert_eq!(failure.kind, "invalid-path");
    // Still there: a recursive removal is not a capability this bridge grants.
    assert!(vault.path().join("notes/dsa").is_dir());
}

#[test]
fn exists_is_false_for_a_directory() {
    let vault = TempVault::new("existsdir");
    create_dir_in(vault.path(), "notes").unwrap();

    // `exists` answers about *files*, matching the port.
    assert!(!exists_in(vault.path(), "notes").unwrap());
}

#[test]
fn no_path_can_escape_the_vault() {
    let vault = TempVault::new("escape");
    let outside = vault.path().parent().unwrap().join("vaultwork-escape-canary.md");
    let _ = fs::remove_file(&outside);

    for path in [
        "../vaultwork-escape-canary.md",
        "../../etc/passwd",
        "notes/../../vaultwork-escape-canary.md",
        "/etc/passwd",
        "/tmp/vaultwork-escape-canary.md",
        "C:/Windows/system32/config",
        "//server/share/a.md",
        "file:///etc/passwd",
        "notes//a.md",
        "notes/./a.md",
        "notes/%2e%2e/a.md",
        "..\\vaultwork-escape-canary.md",
        "",
    ] {
        let write = write_in(vault.path(), path, "escaped");
        assert!(write.is_err(), "write should have refused {path:?}");
        assert_eq!(write.unwrap_err().kind, "invalid-path", "for {path:?}");

        assert!(read_in(vault.path(), path).is_err(), "read should have refused {path:?}");
        assert!(delete_in(vault.path(), path).is_err(), "delete should have refused {path:?}");
        assert!(exists_in(vault.path(), path).is_err(), "exists should have refused {path:?}");
        assert!(
            create_dir_in(vault.path(), path).is_err(),
            "create_dir should have refused {path:?}"
        );
    }

    // The decisive assertion: nothing was written outside the folder the user
    // picked. The checks above could all pass while a single one leaked.
    assert!(!outside.exists(), "a path escaped the vault");
}

#[test]
fn a_nul_byte_cannot_truncate_a_path() {
    let vault = TempVault::new("nul");

    let failure = write_in(vault.path(), "notes/a.md\0.txt", "x").unwrap_err();
    assert_eq!(failure.kind, "invalid-path");
}

#[test]
fn probe_reports_a_reachable_folder_as_granted() {
    let vault = TempVault::new("probe");
    assert_eq!(probe(vault.path()), "granted");
}

#[test]
fn probe_reports_a_folder_that_has_gone_away_as_denied() {
    let vault = TempVault::new("gone");
    let path = vault.path().to_path_buf();
    fs::remove_dir_all(&path).unwrap();

    // An unplugged drive or a folder deleted behind the app's back must not
    // report "granted" and then fail on the first read.
    assert_eq!(probe(&path), "denied");
}

#[test]
fn a_file_written_outside_vaultwork_is_read_back_verbatim() {
    let vault = TempVault::new("external");
    fs::create_dir_all(vault.path().join("notes")).unwrap();

    // As if Obsidian had written it: M11's whole external-change flow depends
    // on reading back exactly what another editor left.
    let contents = "---\nid: abc\n---\n\n# Written in Obsidian\n\nWith an accent: café.\n";
    fs::write(vault.path().join("notes/external.md"), contents).unwrap();

    assert_eq!(read_in(vault.path(), "notes/external.md").unwrap(), contents);
}

#[test]
fn a_write_replaces_rather_than_appends() {
    let vault = TempVault::new("replace");

    write_in(vault.path(), "notes/a.md", "first").unwrap();
    write_in(vault.path(), "notes/a.md", "second").unwrap();

    assert_eq!(read_in(vault.path(), "notes/a.md").unwrap(), "second");
}

// ------------------------------------------------------------------ PDFs
//
// A PDF is read for its text and nothing else: the bytes never leave this
// process. These prove that against real files on a real filesystem, including
// the two cases a vault will genuinely contain — a document with no text layer,
// and a file that is not a PDF at all despite its name.

/// The smallest structurally valid PDF that carries a text layer.
fn tiny_pdf(text: &str) -> Vec<u8> {
    let content = format!("BT /F1 24 Tf 72 700 Td ({text}) Tj ET");
    let mut objects: Vec<String> = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".into());
    objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into());
    objects.push(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),
    );
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into());
    objects.push(format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()));

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{body}\nendobj\n", index + 1));
    }

    let xref_at = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1));
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

#[test]
fn extracts_the_text_layer_of_a_real_pdf() {
    let vault = TempVault::new("pdf-text");
    fs::write(vault.path().join("paper.pdf"), tiny_pdf("System Design Basics")).unwrap();

    let result = read_pdf_text_in(vault.path(), "paper.pdf").expect("a readable PDF");

    assert!(result.text.contains("System Design Basics"), "got {:?}", result.text);
    assert!(!result.empty);
    assert!(!result.truncated);
    assert!(result.bytes > 0, "the file size is recorded for change detection");
    assert_eq!(result.chars, result.text.chars().count());
}

#[test]
fn reports_a_pdf_with_no_text_rather_than_inventing_some() {
    let vault = TempVault::new("pdf-empty");
    // Not a PDF at all — the same answer an image-only scan gives. There is no
    // OCR here, and claiming text was found would put fiction in a search index.
    fs::write(vault.path().join("scan.pdf"), b"not really a pdf").unwrap();

    let result = read_pdf_text_in(vault.path(), "scan.pdf").expect("still a document");

    assert!(result.empty, "an unreadable PDF is empty, not an error");
    assert_eq!(result.text, "");
    assert!(result.bytes > 0);
}

#[test]
fn a_pdf_cannot_be_read_from_outside_the_vault() {
    let vault = TempVault::new("pdf-escape");
    fs::write(vault.path().join("inside.pdf"), tiny_pdf("inside")).unwrap();

    for escape in ["../outside.pdf", "/etc/passwd", "a/../../outside.pdf"] {
        let failure = read_pdf_text_in(vault.path(), escape).expect_err("must be refused");
        assert_eq!(failure.kind, "invalid-path", "{escape} should not resolve");
    }
}

#[test]
fn a_directory_named_like_a_pdf_is_not_a_document() {
    let vault = TempVault::new("pdf-dir");
    fs::create_dir(vault.path().join("folder.pdf")).unwrap();

    let failure = read_pdf_text_in(vault.path(), "folder.pdf").expect_err("not a file");
    assert_eq!(failure.kind, "invalid-path");
}

#[test]
fn a_missing_pdf_is_not_found_rather_than_an_io_error() {
    let vault = TempVault::new("pdf-missing");
    let failure = read_pdf_text_in(vault.path(), "gone.pdf").expect_err("nothing there");
    assert_eq!(failure.kind, "not-found");
}

#[test]
fn extraction_is_bounded() {
    // The ceiling is a real bound, not a comment: an unbounded document would be
    // unbounded memory in the process, over the bridge, and in the database.
    assert!(MAX_PDF_TEXT_CHARS > 0);
    assert!(MAX_PDF_TEXT_CHARS <= 1_000_000, "the bound must actually bound");

    let vault = TempVault::new("pdf-bound");
    fs::write(vault.path().join("small.pdf"), tiny_pdf("short")).unwrap();
    let result = read_pdf_text_in(vault.path(), "small.pdf").unwrap();
    assert!(result.chars <= MAX_PDF_TEXT_CHARS);
}

/// A PDF whose content stream carries a `w` (line-width) operator with **no
/// operand**.
///
/// This is the exact shape that crashed the application: `pdf-extract` reads
/// `operation.operands[0]` for `w` without checking that the vector has one,
/// and panics with "index out of bounds: the len is 0 but the index is 0".
/// Generated rather than committed as a binary — 600 bytes of PDF that says
/// what it is beats an opaque blob, and it cannot rot into something that no
/// longer reproduces the fault.
fn pdf_with_operandless_operator() -> Vec<u8> {
    build_pdf("BT /F1 12 Tf 60 700 Td (hello) Tj ET\nw\n")
}

fn build_pdf(content: &str) -> Vec<u8> {
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
    ];

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{body}\nendobj\n", index + 1));
    }
    let xref_at = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1));
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

#[test]
fn a_pdf_that_panics_the_parser_is_reported_not_fatal() {
    /*
     * The regression. One of six real PDFs in the author's own vault contains
     * an operand-less operator, `pdf-extract` panics on it, and the shipped
     * build turned that panic into SIGABRT on the main thread — the whole
     * application gone the moment Sync Center scanned the folder.
     *
     * The guard inside `read_pdf_text_in` was always there; what was missing was
     * a build in which it could run. See the release profile in Cargo.toml.
     */
    let vault = TempVault::new("pdf-panic");
    fs::write(vault.path().join("hostile.pdf"), pdf_with_operandless_operator()).unwrap();

    let result = read_pdf_text_in(vault.path(), "hostile.pdf").expect("a panic is not an error");

    // One bad document costs one document, and says so honestly.
    assert!(result.empty, "a parser panic reads as no text, not as a crash");
    assert_eq!(result.text, "");
    assert!(result.bytes > 0, "it is still a file we saw");
}

#[test]
fn one_hostile_pdf_does_not_cost_the_others() {
    // The property that matters for a scan: the walk must get past it.
    let vault = TempVault::new("pdf-panic-batch");
    fs::write(vault.path().join("a-good.pdf"), tiny_pdf("First document")).unwrap();
    fs::write(vault.path().join("b-hostile.pdf"), pdf_with_operandless_operator()).unwrap();
    fs::write(vault.path().join("c-good.pdf"), tiny_pdf("Third document")).unwrap();

    let mut seen = Vec::new();
    for entry in list_in(vault.path(), None).unwrap() {
        let out = read_pdf_text_in(vault.path(), &entry.path).expect("never fatal");
        seen.push((entry.name, out.empty));
    }

    assert_eq!(
        seen,
        vec![
            ("a-good.pdf".to_string(), false),
            ("b-hostile.pdf".to_string(), true),
            ("c-good.pdf".to_string(), false),
        ]
    );
}

#[test]
fn the_release_profile_can_actually_run_its_own_guards() {
    /*
     * The test that would have caught this, and the reason it is written as a
     * file assertion rather than a behavioural one.
     *
     * `panic = "abort"` makes `catch_unwind` a no-op — but cargo forces
     * `panic = "unwind"` for *test* targets, even under `--release`. So there is
     * no test configuration in which the shipped panic strategy is exercised,
     * and every guard in this crate passed while doing nothing in the product.
     *
     * Reading the manifest is therefore the only way to assert it from a test.
     * If someone adds `panic = "abort"` back for binary size, they have to come
     * here and decide what happens to a PDF that panics the parser.
     */
    let manifest = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
    )
    .expect("the crate manifest");

    let release = manifest
        .split("[profile.release]")
        .nth(1)
        .expect("a release profile");
    // Only the next section's worth, so a later profile cannot mask this.
    let release = release.split("\n[").next().unwrap_or(release);

    let sets_abort = release
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim())
        .any(|line| line.starts_with("panic") && line.contains("abort"));

    assert!(
        !sets_abort,
        "panic = \"abort\" makes catch_unwind inert in the shipped binary, and a \
         PDF that panics pdf-extract then aborts the whole application"
    );
}

// --------------------------------------------------- the off-thread wrapper
//
// What the renderer actually reaches. `vault_read_pdf_text` resolves the vault
// root and then calls this, so these cover the hop onto a worker thread and the
// error conversion — the half the crash report implicated and the half that had
// no test of its own.

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

#[test]
fn the_off_thread_read_returns_text_like_the_direct_one() {
    let vault = TempVault::new("offthread-ok");
    fs::write(vault.path().join("paper.pdf"), tiny_pdf("System Design Basics")).unwrap();

    let result = block_on(read_pdf_text_off_thread(
        vault.path().to_path_buf(),
        "paper.pdf".into(),
    ))
    .expect("a readable PDF");

    assert!(result.text.contains("System Design Basics"));
    assert!(!result.empty);
}

#[test]
fn the_off_thread_read_survives_a_pdf_that_panics_the_parser() {
    /*
     * The whole crash, at the layer the renderer talks to. Before the fix this
     * did not return at all — the process aborted with SIGABRT, on the main
     * thread, the moment a scan reached such a file.
     */
    let vault = TempVault::new("offthread-hostile");
    fs::write(vault.path().join("hostile.pdf"), pdf_with_operandless_operator()).unwrap();

    let result = block_on(read_pdf_text_off_thread(
        vault.path().to_path_buf(),
        "hostile.pdf".into(),
    ))
    .expect("an answer, not a dead process");

    assert!(result.empty);
    assert_eq!(result.text, "");
}

#[test]
fn the_off_thread_read_keeps_working_after_a_hostile_document() {
    // The scan case across the real boundary: the worker thread is reusable and
    // one bad document does not poison the next call.
    let vault = TempVault::new("offthread-mixed");
    fs::write(vault.path().join("bad.pdf"), pdf_with_operandless_operator()).unwrap();
    fs::write(vault.path().join("good.pdf"), tiny_pdf("Still here")).unwrap();

    let root = vault.path().to_path_buf();
    for _ in 0..3 {
        let bad = block_on(read_pdf_text_off_thread(root.clone(), "bad.pdf".into())).unwrap();
        assert!(bad.empty);
        let good = block_on(read_pdf_text_off_thread(root.clone(), "good.pdf".into())).unwrap();
        assert!(good.text.contains("Still here"));
    }
}

#[test]
fn the_off_thread_read_still_refuses_an_escaping_path() {
    // Moving the work to another thread must not move it outside the vault.
    let vault = TempVault::new("offthread-escape");
    for escape in ["../outside.pdf", "/etc/passwd", "a/../../outside.pdf"] {
        let failure = block_on(read_pdf_text_off_thread(
            vault.path().to_path_buf(),
            escape.into(),
        ))
        .expect_err("must be refused");
        assert_eq!(failure.kind, "invalid-path", "{escape}");
    }
}

#[test]
fn the_off_thread_read_reports_a_missing_file_readably() {
    let vault = TempVault::new("offthread-missing");
    let failure = block_on(read_pdf_text_off_thread(
        vault.path().to_path_buf(),
        "gone.pdf".into(),
    ))
    .expect_err("nothing there");

    assert_eq!(failure.kind, "not-found");
    // No absolute path reaches the renderer.
    assert!(!failure.message.contains(vault.path().to_str().unwrap()));
}
