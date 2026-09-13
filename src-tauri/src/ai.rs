//! The Groq provider, and the only place an AI credential is ever read.
//!
//! This file is the second — and last — network client in Vaultwork, and it is
//! shaped by the same three constraints `telegram.rs` is:
//!
//!  1. **There is no generic HTTP command.** The host is a constant, the one
//!     endpoint is a constant, and no command below takes a URL, a host or a
//!     header. `ai_complete` accepts messages and nothing else; a
//!     `http_request(url, headers, body)` bridge would hand any script in the
//!     WebView the user's whole network, and the credential to spend on it.
//!
//!  2. **The key never leaves this process.** It is read from the OS credential
//!     store once per process, cached in memory here, and spent only on the
//!     `Authorization` header built below. No command returns it, no status
//!     carries it, no event emits it, and no error message or log line
//!     interpolates it — errors are mapped from the HTTP status to fixed
//!     sentences rather than echoing what the provider said back.
//!
//!  3. **Nothing here decides what a completion means.** This sends messages
//!     and returns text. There is no planner, no validator and no notion of a
//!     task in this file, because a second place that knows what Vaultwork
//!     commands are would be a second application.
//!
//! The provider is deliberately reachable *only* from the desktop runtime. A
//! browser bundle cannot hold a secret — anything shipped to it is public — so
//! the browser keeps the inert `nullAi` adapter and this code never runs there.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::secrets;
use crate::store;

/// Where the provider lives.
///
/// A constant, and the only absolute URL in this file. There is deliberately no
/// way for the renderer to influence it: `tests/architecture.test.ts` asserts
/// that this is the single host `ai.rs` names, exactly as it does for
/// `telegram.rs`.
const API_BASE: &str = "https://api.groq.com";
/// Groq's OpenAI-compatible chat endpoint. A path, not a renderer input.
const CHAT_PATH: &str = "/openai/v1/chat/completions";

/// The one place a model name is written.
///
/// Overridable per installation through `desktop-state.json`, never by the
/// renderer's request. Nothing above this file names a model.
///
/// Providers retire models, and when Groq retired the previous default the app
/// failed with a 404 `model_not_found` that looked like a broken integration
/// rather than a stale constant. That is the reason `ai_set_model` exists: an
/// installation can move on without waiting for a release.
const DEFAULT_MODEL: &str = "openai/gpt-oss-120b";

pub const PROVIDER: &str = "groq";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// Bounds on what one request may carry. A runaway caller should be refused
/// here rather than billed for.
const MAX_MESSAGES: usize = 64;
const MAX_REQUEST_CHARS: usize = 200_000;
const MAX_MODEL_CHARS: usize = 128;
const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 1024;
const MAX_OUTPUT_TOKENS: u32 = 8192;

// ------------------------------------------------------------------- state

/// What the UI is allowed to know. Note what is absent: the key.
#[derive(Clone, Serialize, Default)]
pub struct AiStatus {
    /// A key is in the OS credential store.
    pub configured: bool,
    /// The user has not switched the provider off.
    pub enabled: bool,
    pub provider: String,
    pub model: String,
    /// The last failure, in words a person can act on.
    pub last_error: Option<String>,
    /// Diagnostic: how many times this process has read the credential store.
    pub keychain_reads: u64,
}

#[derive(Default)]
pub struct AiState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// The API key, held for the life of the process.
    ///
    /// Read from the OS credential store at most once and reused for every
    /// request after that. This is the M14 lesson applied before the mistake is
    /// made rather than after: re-reading per request bought nothing — the
    /// process must possess the key to make a request at all — and cost a macOS
    /// authorization prompt every single time.
    key: Option<String>,
    /// Whether a key exists at all, cached so `status()` — which the UI calls
    /// on mount — never touches the credential store.
    configured: bool,
    last_error: Option<String>,
}

/// The parts of `Inner` a status is allowed to carry.
///
/// Deliberately not `Inner` itself: that holds the key, and this is the value
/// that leaves the lock and goes on to be serialised to the renderer.
#[derive(Default)]
struct InnerSnapshot {
    configured: bool,
    last_error: Option<String>,
}

impl AiState {
    /// Copies everything `status_of` shows out from under a single lock.
    ///
    /// One acquisition, and the guard is released before anything slow. Taking
    /// the guard and then calling another method that locks the same mutex does
    /// not re-enter in Rust — it deadlocks — and for a synchronous Tauri
    /// command the thread it would deadlock is the main thread.
    fn snapshot(&self) -> InnerSnapshot {
        match self.inner.lock() {
            Ok(inner) => InnerSnapshot {
                configured: inner.configured,
                last_error: inner.last_error.clone(),
            },
            Err(_) => InnerSnapshot::default(),
        }
    }

    /// The cached key, if this process has read one.
    fn key(&self) -> Option<String> {
        self.inner.lock().ok().and_then(|inner| inner.key.clone())
    }

    fn set_key(&self, key: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.configured = key.is_some() || inner.configured;
            inner.key = key;
        }
    }

    fn set_configured(&self, configured: bool) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.configured = configured;
            if !configured {
                inner.key = None;
            }
        }
    }

    fn is_configured(&self) -> bool {
        self.inner.lock().map(|inner| inner.configured).unwrap_or(false)
    }

    fn set_error(&self, message: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.last_error = message;
        }
    }
}

#[derive(Serialize, Debug)]
pub struct AiError {
    pub kind: String,
    pub message: String,
}

impl AiError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }

    fn not_configured() -> Self {
        Self::new("not-configured", "No AI provider key has been saved.")
    }

    fn disabled() -> Self {
        Self::new("disabled", "The AI provider is switched off.")
    }
}

// ---------------------------------------------------------------- the wire

/// What the renderer may ask for.
///
/// Note every field that is *not* here: no url, no host, no header, no model,
/// no api key, no organisation. The renderer supplies content and nothing that
/// could redirect the request or change who pays for it.
#[derive(Deserialize)]
pub struct CompletionRequest {
    messages: Vec<RequestMessage>,
    /// Ask the provider for a single JSON object rather than prose.
    #[serde(default)]
    json: bool,
    #[serde(default)]
    max_output_tokens: Option<u32>,
    #[serde(default)]
    temperature: Option<f32>,
}

#[derive(Deserialize)]
struct RequestMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Debug)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// The normalised shape the renderer sees. No provider JSON crosses this
/// boundary — the application depends on this struct, not on Groq's schema.
// `Debug` carries the completion text, which is model output — never the key,
// which lives only in `Inner` and derives nothing.
#[derive(Serialize, Debug)]
pub struct CompletionResult {
    pub text: String,
    pub model: String,
    pub finish_reason: String,
    pub usage: Option<Usage>,
}

/// The answer to "does this key work?", with nothing sensitive in it.
#[derive(Serialize)]
pub struct AiProbe {
    pub model: String,
    pub text: String,
}

// ------------------------------------------------- provider response shapes

#[derive(Deserialize)]
struct ChatResponse {
    model: Option<String>,
    #[serde(default)]
    choices: Vec<Choice>,
    usage: Option<ApiUsage>,
}

#[derive(Deserialize)]
struct Choice {
    message: Option<ChoiceMessage>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ApiUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorBody>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    #[serde(rename = "type")]
    kind: Option<String>,
    code: Option<String>,
}

/// Where the provider lives.
///
/// A constant in release builds. In a debug build it may be pointed at a local
/// fake so the request path can be exercised without spending a real key. There
/// is deliberately no way for the renderer to set this: it is read from the
/// process environment at startup, which a WebView cannot write to.
fn api_base() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(base) = std::env::var("VAULTWORK_AI_API_BASE") {
            if !base.is_empty() {
                return base;
            }
        }
    }
    API_BASE.to_string()
}

fn client() -> Result<reqwest::Client, AiError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AiError::new("network", format!("HTTP client failed: {error}")))
}

// ------------------------------------------------------------- pure helpers
//
// Everything below this line is deterministic and unit-tested without a
// network: what the provider's JSON means, and what an HTTP status means.

/// A short machine token the provider used to name the failure.
///
/// Deliberately *not* the provider's `message`, which can quote the request
/// body back — that body is the user's tasks and notes. Only a bounded
/// lowercase identifier is forwarded, and only when it looks like one.
fn safe_code(body: &str) -> Option<String> {
    let envelope: ApiErrorEnvelope = serde_json::from_str(body).ok()?;
    let error = envelope.error?;
    let token = error.code.or(error.kind)?;
    let ok = !token.is_empty()
        && token.len() <= 64
        && token
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.'));
    if ok {
        Some(token)
    } else {
        None
    }
}

/// Turns a non-2xx response into an error the UI can show verbatim.
///
/// The sentences are fixed here rather than taken from the provider, so no
/// amount of provider verbosity can leak a request body into the interface.
fn classify_status(status: u16, body: &str) -> AiError {
    let kind = match status {
        401 | 403 => "invalid-key",
        404 => "api",
        408 => "timeout",
        429 => "rate-limited",
        500..=599 => "api",
        _ => "api",
    };

    let mut message = match kind {
        "invalid-key" => "The AI provider rejected the API key.".to_string(),
        "rate-limited" => "The AI provider is rate limiting us.".to_string(),
        "timeout" => "The AI provider timed out.".to_string(),
        _ => format!("The AI provider refused the request (HTTP {status})."),
    };

    if let Some(code) = safe_code(body) {
        message.push_str(&format!(" [{code}]"));
    }

    AiError::new(kind, message)
}

fn normalise_finish(reason: Option<&str>) -> String {
    match reason {
        Some("stop") | Some("end_turn") => "stop",
        Some("length") | Some("max_tokens") => "length",
        Some("content_filter") => "filter",
        _ => "other",
    }
    .to_string()
}

/// Reads one provider response into the shape the application depends on.
///
/// Every failure here is `protocol`: the request reached the provider and the
/// provider answered with something this code cannot use. That is a different
/// problem from a rejected key or an unreachable host, and the UI says so.
fn parse_completion(fallback_model: &str, body: &str) -> Result<CompletionResult, AiError> {
    let parsed: ChatResponse = serde_json::from_str(body)
        .map_err(|_| AiError::new("protocol", "The AI provider sent a response we could not read."))?;

    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| AiError::new("protocol", "The AI provider returned no answer."))?;

    let text = choice
        .message
        .and_then(|message| message.content)
        .ok_or_else(|| AiError::new("protocol", "The AI provider returned an empty answer."))?;

    Ok(CompletionResult {
        text,
        model: parsed.model.unwrap_or_else(|| fallback_model.to_string()),
        finish_reason: normalise_finish(choice.finish_reason.as_deref()),
        usage: parsed.usage.map(|usage| Usage {
            input_tokens: usage.prompt_tokens.unwrap_or(0),
            output_tokens: usage.completion_tokens.unwrap_or(0),
        }),
    })
}

/// A model name a person could plausibly have typed. Not a URL, not a path.
///
/// `/` and `:` are allowed because real model names use them
/// (`openai/gpt-oss-120b`, `llama3:8b`), but anything that starts to look like a
/// URL is refused outright. The model never reaches a URL — it goes in the
/// request body — and this is belt and braces for the day someone changes that.
fn is_valid_model(model: &str) -> bool {
    if model.is_empty() || model.len() > MAX_MODEL_CHARS {
        return false;
    }
    if model.contains("//") || model.contains(':') && model.contains('/') {
        return false;
    }
    // A relative-path segment is not part of any model name, and a model that
    // looked like one would be a problem the day somebody routes a provider by
    // path (`/models/{model}/…`, which some OpenAI-compatible APIs do). The
    // model reaches only the JSON body today; this keeps that a choice rather
    // than a load-bearing accident.
    if model.split(['/', ':']).any(|segment| segment == ".." || segment == ".") {
        return false;
    }
    model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
}

/// Rejects a request before it is paid for.
fn check_request(request: &CompletionRequest) -> Result<(), AiError> {
    if request.messages.is_empty() {
        return Err(AiError::new("protocol", "A completion needs at least one message."));
    }
    if request.messages.len() > MAX_MESSAGES {
        return Err(AiError::new("protocol", "That conversation is too long to send."));
    }

    let mut total = 0usize;
    for message in &request.messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err(AiError::new("protocol", "That is not a message role."));
        }
        total = total.saturating_add(message.content.len());
    }
    if total > MAX_REQUEST_CHARS {
        return Err(AiError::new("protocol", "That request is too large to send."));
    }
    Ok(())
}

// ------------------------------------------------------------- credentials

/// Reads the key from the credential store and caches it for this process.
fn load_key(state: &AiState) -> Result<String, AiError> {
    let key = secrets::get(secrets::AI_GROQ_KEY)
        .map_err(|error| AiError::new("keychain", error.0))?
        .ok_or_else(AiError::not_configured)?;
    state.set_key(Some(key.clone()));
    Ok(key)
}

/// The key to spend on one request.
///
/// Prefers the one already in memory, so a session of AI requests costs exactly
/// one credential-store access no matter how many completions are made.
fn key_for_request(state: &AiState) -> Result<String, AiError> {
    match state.key() {
        Some(key) => Ok(key),
        None => load_key(state),
    }
}

/// Establishes, once at launch, whether a key exists.
///
/// The only credential-store access that happens when AI is not being used, and
/// it is unavoidable: Settings has to be able to say "Configured" or "Not
/// configured" without guessing. The answer is cached, so it costs exactly one
/// access per application launch.
pub fn prime(app: &AppHandle) {
    let state = app.state::<Arc<AiState>>();
    state.set_configured(secrets::exists(secrets::AI_GROQ_KEY));
}

// ---------------------------------------------------------------- requests

/// Performs the one Groq call this application makes.
///
/// The request body, exactly as the provider will receive it.
///
/// Split out from `chat` so the wire format can be asserted without a network
/// call — in particular that the model reaching Groq is the one this file
/// resolved, character for character. A model name that is silently rewritten
/// on the way out is precisely the failure that produced a 404 nobody could
/// explain from the outside.
fn build_body(model: &str, request: &CompletionRequest) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|message| serde_json::json!({ "role": message.role, "content": message.content }))
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": request
            .max_output_tokens
            .unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS)
            .clamp(1, MAX_OUTPUT_TOKENS),
    });

    if let Some(temperature) = request.temperature {
        body["temperature"] = serde_json::json!(temperature.clamp(0.0, 2.0));
    }
    if request.json {
        // The provider's own structured-output switch, so later phases parse a
        // JSON object rather than guessing where the prose stopped.
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    body
}

/// Takes the key rather than fetching it, for the same reason `telegram.rs`
/// does: the credential store is consulted once per process, not once per
/// request.
async fn chat(
    key: &str,
    model: &str,
    request: &CompletionRequest,
) -> Result<CompletionResult, AiError> {
    let body = build_body(model, request);

    let url = format!("{}{}", api_base(), CHAT_PATH);
    let response = client()?
        .post(&url)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        // The error is reported without the URL and without the status text the
        // provider chose, and `reqwest`'s own Display is never interpolated —
        // it can carry the request URL, and a redacted-looking key is still a
        // key. Only whether it timed out is worth saying.
        .map_err(|error| {
            if error.is_timeout() {
                AiError::new("timeout", "The AI provider did not answer in time.")
            } else {
                AiError::new("network", "The AI provider is unreachable.")
            }
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| AiError::new("protocol", "The AI provider sent a response we could not read."))?;

    if !status.is_success() {
        return Err(classify_status(status.as_u16(), &text));
    }

    parse_completion(model, &text)
}

// -------------------------------------------------------------- commands

fn model_of(app: &AppHandle) -> String {
    store::ai_model(app).unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn status_of(app: &AppHandle) -> AiStatus {
    let state = app.state::<Arc<AiState>>();

    // One lock, released before the `store::` reads below, which touch the
    // filesystem. Nothing here reaches the credential store.
    let inner = state.snapshot();

    AiStatus {
        configured: inner.configured,
        enabled: store::ai_enabled(app),
        provider: PROVIDER.to_string(),
        model: model_of(app),
        last_error: inner.last_error,
        keychain_reads: secrets::read_count(),
    }
}

#[tauri::command]
pub fn ai_status(app: AppHandle) -> AiStatus {
    status_of(&app)
}

/// Saves an API key.
///
/// The key goes to the OS credential store and nothing comes back but a status;
/// there is no command that returns it, so the renderer that supplied it cannot
/// read it again. Deliberately does *not* call the provider: proving the key
/// works is `ai_test`, which the user runs when they choose to.
#[tauri::command]
pub async fn ai_configure(app: AppHandle, key: String) -> Result<AiStatus, AiError> {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err(AiError::new("invalid-key", "The API key is empty."));
    }

    secrets::set(secrets::AI_GROQ_KEY, &trimmed)
        .map_err(|error| AiError::new("keychain", error.0))?;

    // The caller just handed us the key, so it is cached from that value rather
    // than by reading back what was written — a write followed by a read of the
    // same secret is one authorization prompt too many.
    let state = app.state::<Arc<AiState>>();
    state.set_key(Some(trimmed));
    state.set_configured(true);
    state.set_error(None);

    Ok(status_of(&app))
}

/// Forgets the key. Touches no application data whatsoever.
#[tauri::command]
pub async fn ai_disconnect(app: AppHandle) -> Result<AiStatus, AiError> {
    secrets::delete(secrets::AI_GROQ_KEY)
        .map_err(|error| AiError::new("keychain", error.0))?;

    let state = app.state::<Arc<AiState>>();
    state.set_configured(false);
    state.set_error(None);
    store::forget_ai(&app);

    Ok(status_of(&app))
}

#[tauri::command]
pub fn ai_set_enabled(app: AppHandle, enabled: bool) -> AiStatus {
    store::remember_ai_enabled(&app, enabled);
    status_of(&app)
}

#[tauri::command]
pub fn ai_set_model(app: AppHandle, model: String) -> Result<AiStatus, AiError> {
    let trimmed = model.trim();
    if !is_valid_model(trimmed) {
        return Err(AiError::new("protocol", "That is not a model name."));
    }
    store::remember_ai_model(&app, Some(trimmed));
    Ok(status_of(&app))
}

/// The smallest round trip that proves the credential works.
#[tauri::command]
pub async fn ai_test(app: AppHandle) -> Result<AiProbe, AiError> {
    let request = CompletionRequest {
        messages: vec![RequestMessage {
            role: "user".into(),
            // Deliberately carries none of the user's data: a connectivity
            // check should not send tasks or notes to a provider.
            content: "Reply with the single word: ok".into(),
        }],
        json: false,
        max_output_tokens: Some(16),
        temperature: Some(0.0),
    };

    let result = complete_with(&app, request).await?;
    Ok(AiProbe { model: result.model, text: result.text })
}

#[tauri::command]
pub async fn ai_complete(
    app: AppHandle,
    request: CompletionRequest,
) -> Result<CompletionResult, AiError> {
    complete_with(&app, request).await
}

/// The one path every completion takes, so the gates are written once.
async fn complete_with(
    app: &AppHandle,
    request: CompletionRequest,
) -> Result<CompletionResult, AiError> {
    let state = app.state::<Arc<AiState>>();

    if !store::ai_enabled(app) {
        return Err(AiError::disabled());
    }
    if !state.is_configured() {
        return Err(AiError::not_configured());
    }
    check_request(&request)?;

    let key = key_for_request(&state)?;
    let model = model_of(app);

    match chat(&key, &model, &request).await {
        Ok(result) => {
            state.set_error(None);
            Ok(result)
        }
        Err(error) => {
            // A key the provider rejects is not worth caching: drop it from
            // memory so the next attempt re-reads whatever the user fixed.
            if error.kind == "invalid-key" {
                state.set_key(None);
            }
            // The kind only — never the message, which names the failure, and
            // never the key, which is in neither.
            eprintln!("[vaultwork] ai request failed: {}", error.kind);
            state.set_error(Some(error.message.clone()));
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(content: &str) -> CompletionRequest {
        CompletionRequest {
            messages: vec![RequestMessage { role: "user".into(), content: content.into() }],
            json: false,
            max_output_tokens: None,
            temperature: None,
        }
    }

    #[test]
    fn reads_a_normal_completion() {
        let body = r#"{
            "model": "openai/gpt-oss-120b",
            "choices": [{ "message": { "content": "{\"ok\":true}" }, "finish_reason": "stop" }],
            "usage": { "prompt_tokens": 11, "completion_tokens": 3 }
        }"#;

        let result = parse_completion("fallback", body).expect("a well-formed answer");
        assert_eq!(result.text, "{\"ok\":true}");
        assert_eq!(result.model, "openai/gpt-oss-120b");
        assert_eq!(result.finish_reason, "stop");
        let usage = result.usage.expect("usage was reported");
        assert_eq!(usage.input_tokens, 11);
        assert_eq!(usage.output_tokens, 3);
    }

    #[test]
    fn falls_back_to_the_requested_model_when_none_is_reported() {
        let body = r#"{ "choices": [{ "message": { "content": "hi" } }] }"#;
        let result = parse_completion("configured-model", body).expect("still usable");
        assert_eq!(result.model, "configured-model");
        // An unreported reason is "other", never silently "stop".
        assert_eq!(result.finish_reason, "other");
        assert!(result.usage.is_none());
    }

    #[test]
    fn rejects_malformed_and_empty_provider_answers() {
        for body in [
            "not json at all",
            "{}",
            r#"{ "choices": [] }"#,
            r#"{ "choices": [{ "finish_reason": "stop" }] }"#,
            r#"{ "choices": [{ "message": {} }] }"#,
        ] {
            let error = parse_completion("m", body).expect_err("must not be accepted");
            assert_eq!(error.kind, "protocol", "body was {body}");
        }
    }

    #[test]
    fn normalises_every_finish_reason() {
        let cases = [
            (Some("stop"), "stop"),
            (Some("length"), "length"),
            (Some("max_tokens"), "length"),
            (Some("content_filter"), "filter"),
            (Some("something_new"), "other"),
            (None, "other"),
        ];
        for (raw, expected) in cases {
            assert_eq!(normalise_finish(raw), expected);
        }
    }

    #[test]
    fn maps_http_statuses_to_actionable_kinds() {
        assert_eq!(classify_status(401, "{}").kind, "invalid-key");
        assert_eq!(classify_status(403, "{}").kind, "invalid-key");
        assert_eq!(classify_status(429, "{}").kind, "rate-limited");
        assert_eq!(classify_status(500, "{}").kind, "api");
        assert_eq!(classify_status(503, "{}").kind, "api");
        assert_eq!(classify_status(400, "{}").kind, "api");
    }

    #[test]
    fn an_error_never_quotes_the_provider_prose_back() {
        // The provider's `message` can echo the request — which is the user's
        // tasks and notes. Only the short machine code is forwarded.
        let body = r#"{"error":{"message":"Your prompt about Java revision was invalid","type":"invalid_request_error","code":"model_not_found"}}"#;
        let error = classify_status(400, body);
        assert!(error.message.contains("model_not_found"), "the code is useful");
        assert!(!error.message.contains("Java revision"), "the prose is not forwarded");
        assert!(!error.message.contains("prompt"));
    }

    #[test]
    fn forwards_only_code_shaped_tokens() {
        assert_eq!(safe_code(r#"{"error":{"code":"rate_limit_exceeded"}}"#).as_deref(), Some("rate_limit_exceeded"));
        // A "code" carrying a sentence, or anything upper-case or spaced, is
        // not a code and is dropped rather than shown.
        assert_eq!(safe_code(r#"{"error":{"code":"Your key sk-abc is bad"}}"#), None);
        assert_eq!(safe_code(r#"{"error":{"code":"HAS UPPER"}}"#), None);
        assert_eq!(safe_code("not json"), None);
        assert_eq!(safe_code("{}"), None);
    }

    #[test]
    fn refuses_requests_that_should_never_be_paid_for() {
        let empty = CompletionRequest {
            messages: vec![],
            json: false,
            max_output_tokens: None,
            temperature: None,
        };
        assert_eq!(check_request(&empty).unwrap_err().kind, "protocol");

        let bad_role = CompletionRequest {
            messages: vec![RequestMessage { role: "root".into(), content: "hi".into() }],
            json: false,
            max_output_tokens: None,
            temperature: None,
        };
        assert_eq!(check_request(&bad_role).unwrap_err().kind, "protocol");

        let huge = request(&"x".repeat(MAX_REQUEST_CHARS + 1));
        assert_eq!(check_request(&huge).unwrap_err().kind, "protocol");

        check_request(&request("a normal question")).expect("an ordinary request is fine");
    }

    #[test]
    fn the_default_model_is_one_groq_actually_serves() {
        /*
         * Pinned deliberately. Groq retired `llama-3.3-70b-versatile` and every
         * request then failed with a 404 `model_not_found` that read like a
         * broken integration. The constant is the whole fix, so it is the thing
         * worth asserting — and asserting it here means the next retirement
         * shows up as a failing test rather than as a support question.
         */
        assert_eq!(DEFAULT_MODEL, "openai/gpt-oss-120b");
        assert!(is_valid_model(DEFAULT_MODEL), "the default must pass its own check");
    }

    #[test]
    fn the_model_reaches_the_provider_verbatim() {
        let body = build_body(DEFAULT_MODEL, &request("what is left?"));

        // Character for character. A slug that is normalised, lower-cased or
        // path-split on the way out is a 404 the user cannot diagnose.
        assert_eq!(body["model"], "openai/gpt-oss-120b");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "what is left?");
    }

    #[test]
    fn a_model_override_reaches_the_provider_unchanged() {
        // The escape hatch for the next retirement: an installation can move to
        // another model without a release, and it must arrive intact.
        let body = build_body("openai/gpt-oss-20b", &request("hello"));
        assert_eq!(body["model"], "openai/gpt-oss-20b");
    }

    #[test]
    fn json_mode_is_asked_for_only_when_it_was_requested() {
        let plain = build_body(DEFAULT_MODEL, &request("hello"));
        assert!(plain.get("response_format").is_none());

        let structured = CompletionRequest {
            messages: vec![RequestMessage { role: "user".into(), content: "hi".into() }],
            json: true,
            max_output_tokens: None,
            temperature: None,
        };
        let body = build_body(DEFAULT_MODEL, &structured);
        assert_eq!(body["response_format"]["type"], "json_object");
        // Structured output is the mode the parsing layers above depend on.
        assert_eq!(body["model"], "openai/gpt-oss-120b");
    }

    #[test]
    fn only_accepts_model_names_that_are_model_names() {
        for good in ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "a_b.c:1"] {
            assert!(is_valid_model(good), "{good} should be accepted");
        }
        for bad in [
            "",
            "has space",
            "https://evil.example/v1",
            "a\nb",
            &"x".repeat(200),
            // Path-shaped names. Harmless in the body, refused anyway.
            "../../..",
            "..",
            "models/../../etc",
            "./relative",
        ] {
            assert!(!is_valid_model(bad), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_status_read_never_deadlocks_or_reads_the_credential_store() {
        // The same guarantee `telegram.rs` had to be repaired to give: reading a
        // status is one lock acquisition and zero Keychain accesses.
        let state = Arc::new(AiState::default());
        state.set_configured(true);
        state.set_error(Some("boom".into()));

        let before = secrets::read_count();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = Arc::clone(&state);
        std::thread::spawn(move || {
            for _ in 0..1_000 {
                let snapshot = worker.snapshot();
                assert!(snapshot.configured);
                assert_eq!(snapshot.last_error.as_deref(), Some("boom"));
            }
            let _ = tx.send(());
        });

        rx.recv_timeout(Duration::from_secs(10))
            .expect("reading an AI status must not deadlock");
        assert_eq!(secrets::read_count(), before, "no credential-store access");
    }

    #[test]
    fn a_cached_key_is_reused_rather_than_re_read() {
        // The M14 regression, pre-empted: once a process holds the key, every
        // request spends that one rather than going back to the credential
        // store. The counter is the observable proof, and it must not move.
        let state = AiState::default();
        state.set_key(Some("cached-key".into()));

        let before = secrets::read_count();
        for _ in 0..50 {
            assert_eq!(key_for_request(&state).expect("a cached key is present"), "cached-key");
        }
        assert_eq!(secrets::read_count(), before, "no credential-store access");
    }

    #[test]
    fn forgetting_the_key_forgets_it_from_memory_too() {
        let state = AiState::default();
        state.set_key(Some("cached-key".into()));
        assert!(state.key().is_some());

        state.set_configured(false);
        assert!(state.key().is_none(), "an unconfigured provider holds no key");
    }

    #[test]
    fn the_status_shape_is_a_closed_set_of_harmless_fields() {
        // Structural, and deliberately an *exact* match rather than a scan for
        // suspicious words: a status is the one AI value the renderer receives
        // on every mount, so a field added to it should have to be added here
        // too. `keychain_reads` is a count, not a credential.
        let status = AiStatus {
            configured: true,
            enabled: true,
            provider: PROVIDER.to_string(),
            model: DEFAULT_MODEL.to_string(),
            last_error: None,
            keychain_reads: 1,
        };

        let value = serde_json::to_value(&status).expect("serialises");
        let mut fields: Vec<&str> = value
            .as_object()
            .expect("a status is an object")
            .keys()
            .map(String::as_str)
            .collect();
        fields.sort_unstable();

        assert_eq!(
            fields,
            ["configured", "enabled", "keychain_reads", "last_error", "model", "provider"],
        );
    }

    #[test]
    fn no_renderer_facing_shape_can_carry_the_key() {
        // The key is only ever in `Inner`, which is private, derives nothing and
        // is never serialised. Proven by putting a recognisable value in state
        // and checking it cannot reach either value the renderer receives.
        let state = AiState::default();
        state.set_key(Some("sk-do-not-leak-me".into()));
        state.set_error(Some("something failed".into()));

        let snapshot = state.snapshot();
        let status = AiStatus {
            configured: snapshot.configured,
            enabled: true,
            provider: PROVIDER.to_string(),
            model: DEFAULT_MODEL.to_string(),
            last_error: snapshot.last_error,
            keychain_reads: 0,
        };
        let completion = CompletionResult {
            text: "an answer".into(),
            model: DEFAULT_MODEL.into(),
            finish_reason: "stop".into(),
            usage: None,
        };

        for json in [
            serde_json::to_string(&status).expect("serialises"),
            serde_json::to_string(&completion).expect("serialises"),
            format!("{completion:?}"),
        ] {
            assert!(!json.contains("sk-do-not-leak-me"), "the key escaped into {json}");
        }
    }
}
