fn main() {
    google_client();
    tauri_build::build()
}

/// M19.2: compiles the Google desktop OAuth client into the native binary.
///
/// The client comes from `google-oauth.local` — the JSON file Google Cloud
/// Console downloads for a "Desktop app" client, saved under that name next to
/// this file — or from the `VAULTWORK_GOOGLE_CLIENT_ID` and
/// `VAULTWORK_GOOGLE_CLIENT_SECRET` environment variables. The file is ignored
/// by git (`*.local`), the values reach only `google.rs` via `option_env!`, and
/// the WebView bundle never sees them. Without either, the build succeeds and
/// Google reports itself as not included in this build.
fn google_client() {
    const FILE: &str = "google-oauth.local";
    const ID: &str = "VAULTWORK_GOOGLE_CLIENT_ID";
    const SECRET: &str = "VAULTWORK_GOOGLE_CLIENT_SECRET";
    println!("cargo:rerun-if-changed={FILE}");
    println!("cargo:rerun-if-env-changed={ID}");
    println!("cargo:rerun-if-env-changed={SECRET}");

    if std::env::var(ID).is_ok() {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(FILE) else { return };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        println!("cargo:warning={FILE} is not valid JSON; building without Google.");
        return;
    };
    let client = json.get("installed").unwrap_or(&json);
    // Only characters a Google client value contains, so nothing in the file
    // can inject another directive into this script's output.
    let safe = |value: &str| {
        !value.is_empty()
            && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    };
    let field = |name: &str| client.get(name).and_then(|value| value.as_str()).filter(|v| safe(v));
    let Some(id) = field("client_id") else {
        println!("cargo:warning={FILE} has no usable client_id; building without Google.");
        return;
    };
    println!("cargo:rustc-env={ID}={id}");
    if let Some(secret) = field("client_secret") {
        println!("cargo:rustc-env={SECRET}={secret}");
    }
}
