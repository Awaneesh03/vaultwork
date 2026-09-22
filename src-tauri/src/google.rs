//! Google account (M19.2): read-only Calendar and Gmail, and the only place a
//! Google credential is ever read.
//!
//! The third network client in Vaultwork, and shaped by the same constraints as
//! `ai.rs` and `telegram.rs`:
//!
//!  1. **There is no generic HTTP or OAuth command.** Every host, endpoint,
//!     scope and query below is a constant or is built from one. No command
//!     takes a URL, a path, a scope, a redirect or a token; the renderer can ask
//!     for "calendar events between two instants" and "a few important emails",
//!     and nothing that could point a request anywhere else.
//!
//!  2. **No credential leaves this process.** The refresh token is read from the
//!     OS credential store once per launch and held here; the access token and
//!     its expiry exist only in memory; the authorization code, the PKCE
//!     verifier and the OAuth state never leave the connect flow. No status,
//!     DTO, event or error carries any of them, and every error is one of a
//!     fixed set of kinds with a fixed sentence — never Google's own words.
//!
//!  3. **Read-only, by scope and by construction.** The two scopes are the
//!     narrowest that serve M19.1's ports, and there is no request here that
//!     writes, sends, moves, deletes or marks anything.
//!
//! The consent screen opens in the user's own browser (Google refuses embedded
//! webviews) and returns to a one-shot listener on the loopback address, which
//! is the redirect Google documents for desktop applications.

use std::future::Future;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::secrets;
use crate::store;

// --------------------------------------------------------------- constants

/// Google's documented endpoints. The only absolute URLs in this file, together
/// with the two scopes and the loopback redirect base; `tests/architecture.test.ts`
/// holds the exact list.
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3";
const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1";

/// The redirect: an IP literal rather than `localhost`, as Google recommends.
const LOOPBACK: &str = "http://127.0.0.1";
const CALLBACK_PATH: &str = "/callback";

/// Events on calendars the user owns — the primary calendar — read-only.
pub const SCOPE_CALENDAR: &str = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
/// Message metadata: labels and headers. Google withholds bodies from it.
pub const SCOPE_GMAIL: &str = "https://www.googleapis.com/auth/gmail.metadata";
const SCOPES: [&str; 2] = [SCOPE_CALENDAR, SCOPE_GMAIL];

/// The installed-app client, compiled in from the local build configuration
/// (`build.rs`). Google treats a desktop client as public — its secret "is
/// obviously not treated as a secret" — but neither value is ever sent to the
/// WebView or written to the repository. A build without them is a build
/// without Google, and says so.
const CLIENT_ID: Option<&str> = option_env!("VAULTWORK_GOOGLE_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("VAULTWORK_GOOGLE_CLIENT_SECRET");

const CONNECT_LIMIT: Duration = Duration::from_secs(5 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// An access token this close to expiry is refreshed rather than spent.
const REFRESH_MARGIN: Duration = Duration::from_secs(60);
const DEFAULT_TOKEN_LIFETIME: u64 = 3600;

const DAY_MS: i64 = 86_400_000;
const MAX_WINDOW_MS: i64 = 8 * DAY_MS;
const MAX_EVENTS: usize = 50;
const MAX_SIGNALS: u32 = 8;

const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const MAX_CODE_CHARS: usize = 2048;
const MAX_ID_CHARS: usize = 200;
const TITLE_CHARS: usize = 200;
const SENDER_CHARS: usize = 120;
const SNIPPET_CHARS: usize = 160;
const ACCOUNT_CHARS: usize = 254;

fn client_id() -> Option<&'static str> {
    CLIENT_ID.filter(|value| !value.is_empty())
}

fn client_secret() -> Option<&'static str> {
    CLIENT_SECRET.filter(|value| !value.is_empty())
}

/// Whether this binary was built with a Google client at all.
pub fn configured_in_build() -> bool {
    client_id().is_some()
}

// ------------------------------------------------------------------ errors

/// The closed set of things that can go wrong, as far as the renderer knows.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// Google refused the credential, or the user declined consent.
    Auth,
    /// Google refused the request for want of permission.
    Scope,
    Network,
    Timeout,
    Quota,
    /// Google answered with something this file does not accept.
    Protocol,
    /// This build has no Google client.
    Unavailable,
    NotConnected,
    /// The user did not grant this service when they connected.
    NotGranted,
    Cancelled,
    /// A connection attempt is already waiting for the browser.
    Busy,
    Keychain,
}

/// An error as the renderer receives it: a kind and a sentence chosen by kind.
///
/// There is no constructor that takes text, so nothing Google says — and
/// nothing a request URL or a token could smuggle into a message — can reach
/// the WebView through an error.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct GoogleError {
    pub kind: Kind,
    pub message: &'static str,
}

impl GoogleError {
    fn new(kind: Kind) -> Self {
        Self { kind, message: message_for(kind) }
    }
}

fn message_for(kind: Kind) -> &'static str {
    match kind {
        Kind::Auth => "Google did not accept this connection. Reconnect to continue.",
        Kind::Scope => "Google did not allow that request with the access granted.",
        Kind::Network => "Google could not be reached.",
        Kind::Timeout => "Google did not answer in time.",
        Kind::Quota => "Google is limiting requests right now. Try again later.",
        Kind::Protocol => "Google sent an answer Vaultwork could not use.",
        Kind::Unavailable => "Google is not included in this build.",
        Kind::NotConnected => "No Google account is connected.",
        Kind::NotGranted => "That access was not granted when Google was connected.",
        Kind::Cancelled => "Connecting to Google was cancelled.",
        Kind::Busy => "Vaultwork is already waiting for your browser.",
        Kind::Keychain => "The macOS keychain could not be used.",
    }
}

/// Why a token could not be had.
#[derive(Debug, PartialEq, Eq)]
enum TokenFailure {
    NoCredential,
    /// The grant was revoked or expired: only a new consent can fix it.
    InvalidGrant,
    Failed(GoogleError),
}

/// Why an API call failed: a 401 is worth one refresh, nothing else is.
#[derive(Debug, PartialEq, Eq)]
enum CallError {
    Unauthorized,
    Failed(GoogleError),
}

// ------------------------------------------------------------------- state

/// What the renderer is allowed to know. Note what is absent: every credential.
#[derive(Clone, Serialize, Default, Debug, PartialEq, Eq)]
pub struct GoogleStatus {
    pub configured_in_build: bool,
    /// A refresh token is held. Not proof it works — `last_checked_at` is.
    pub authorized: bool,
    pub connecting: bool,
    pub reconnect_required: bool,
    pub calendar: bool,
    pub gmail: bool,
    pub account: Option<String>,
    pub connected_at: Option<i64>,
    /// The last successful round trip to Google, this session.
    pub last_checked_at: Option<i64>,
    pub last_error: Option<Kind>,
    /// Diagnostic: how many times this process has read the credential store.
    pub keychain_reads: u64,
}

struct Access {
    value: String,
    expires_at: Instant,
}

/// The credentials, behind an async lock that is held across a refresh — which
/// is what makes a refresh single-flight: a second caller waits for the first
/// one's token instead of spending the refresh token again.
#[derive(Default)]
struct Tokens {
    refresh: Option<String>,
    access: Option<Access>,
}

/// Everything a status shows, behind its own plain lock so a status read never
/// waits on a network call.
#[derive(Default)]
struct Info {
    authorized: bool,
    reconnect_required: bool,
    last_checked_at: Option<i64>,
    last_error: Option<Kind>,
    /// Set while a connect flow is waiting; flipping it ends the wait.
    cancel: Option<Arc<AtomicBool>>,
}

#[derive(Default)]
pub struct GoogleState {
    tokens: tokio::sync::Mutex<Tokens>,
    info: Mutex<Info>,
}

impl GoogleState {
    fn with_info<T>(&self, apply: impl FnOnce(&mut Info) -> T) -> Option<T> {
        self.info.lock().ok().map(|mut info| apply(&mut info))
    }

    fn succeeded(&self) {
        self.with_info(|info| {
            info.last_checked_at = Some(now_ms());
            info.last_error = None;
        });
    }

    fn failed(&self, kind: Kind) {
        self.with_info(|info| info.last_error = Some(kind));
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

// ------------------------------------------------------------ PKCE & state

fn random_bytes<const N: usize>() -> Result<[u8; N], GoogleError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| GoogleError::new(Kind::Protocol))?;
    Ok(bytes)
}

/// A PKCE code verifier: 48 random bytes, base64url — 64 unreserved characters.
fn new_verifier() -> Result<String, GoogleError> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<48>()?))
}

/// The S256 challenge for a verifier (RFC 7636 §4.2).
fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// 32 random bytes: the value the callback must hand back unchanged.
fn new_state() -> Result<String, GoogleError> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<32>()?))
}

/// Compares without an early exit, so timing reveals nothing about the prefix.
fn constant_time_eq(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    if left.len() != right.len() {
        return false;
    }
    left.iter().zip(right).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

// -------------------------------------------------------------- URL helpers

fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn query(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Percent-decoding for the callback's query. `None` for anything malformed.
fn decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = bytes.get(index + 1..index + 3)?;
                let text = std::str::from_utf8(hex).ok()?;
                out.push(u8::from_str_radix(text, 16).ok()?);
                index += 3;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn redirect_uri(port: u16) -> String {
    format!("{LOOPBACK}:{port}{CALLBACK_PATH}")
}

/// The consent URL — every part a constant or this attempt's own OAuth state.
fn authorization_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let scopes = SCOPES.join(" ");
    format!(
        "{AUTH_ENDPOINT}?{}",
        query(&[
            ("client_id", client_id),
            ("redirect_uri", redirect),
            ("response_type", "code"),
            ("scope", &scopes),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("state", state),
            // A refresh token, and a fresh consent screen that shows both
            // permissions every time, so a reconnect can restore one the user
            // unticked before.
            ("access_type", "offline"),
            ("prompt", "consent"),
        ])
    )
}

// ---------------------------------------------------------------- callback

#[derive(Debug, PartialEq, Eq)]
enum Callback {
    Code(String),
    /// Google reported an error — usually the user declining.
    Denied,
    StateMismatch,
    /// Not a request for the callback at all: a favicon, a stray probe.
    NotOurs,
    Malformed,
}

/// Judges one HTTP request line. The state is checked before anything else.
fn parse_callback(request_line: &str, expected_state: &str) -> Callback {
    let mut parts = request_line.split(' ');
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Malformed;
    };
    if method != "GET" {
        return Callback::NotOurs;
    }
    let (path, raw_query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Callback::NotOurs;
    }

    let (mut code, mut state, mut error) = (None, None, None);
    for pair in raw_query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let Some(value) = decode(value) else { return Callback::Malformed };
        let slot = match key {
            "code" => &mut code,
            "state" => &mut state,
            "error" => &mut error,
            _ => continue,
        };
        // A repeated parameter is an ambiguity an attacker could exploit.
        if slot.replace(value).is_some() {
            return Callback::Malformed;
        }
    }

    match state {
        Some(state) if constant_time_eq(&state, expected_state) => {}
        _ => return Callback::StateMismatch,
    }
    if error.is_some() {
        return Callback::Denied;
    }
    match code {
        Some(code)
            if !code.is_empty()
                && code.len() <= MAX_CODE_CHARS
                && code.bytes().all(|byte| byte.is_ascii_graphic()) =>
        {
            Callback::Code(code)
        }
        _ => Callback::Malformed,
    }
}

/// The request line of what arrived, or `None` when it was empty, oversized or
/// not text. Reads no further than the end of the headers.
fn request_line_of(raw: &[u8]) -> Option<&str> {
    if raw.len() > MAX_CALLBACK_BYTES {
        return None;
    }
    let text = std::str::from_utf8(raw).ok()?;
    let line = text.split("\r\n").next()?;
    (!line.is_empty()).then_some(line)
}

const PAGE_DONE: &str = "Vaultwork is connected to Google. You can close this tab.";
const PAGE_FAILED: &str = "Vaultwork was not connected to Google. You can close this tab.";

fn respond(stream: &mut TcpStream, status: &str, text: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Vaultwork</title>\
         <p style=\"font:16px system-ui;margin:3em\">{text}</p>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
}

fn read_request(stream: &mut TcpStream) -> Vec<u8> {
    let mut raw = Vec::new();
    let mut chunk = [0u8; 1024];
    while raw.len() <= MAX_CALLBACK_BYTES {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => raw.extend_from_slice(&chunk[..count]),
        }
        if raw.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    raw
}

/// Waits for the one callback this attempt expects, on a blocking thread.
fn await_callback(
    listener: TcpListener,
    expected_state: &str,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<String, GoogleError> {
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(GoogleError::new(Kind::Cancelled));
        }
        if Instant::now() >= deadline {
            return Err(GoogleError::new(Kind::Timeout));
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let raw = read_request(&mut stream);
                let Some(line) = request_line_of(&raw) else {
                    // An empty preconnect or an oversized request: not ours.
                    respond(&mut stream, "400 Bad Request", PAGE_FAILED);
                    continue;
                };
                match parse_callback(line, expected_state) {
                    Callback::NotOurs => respond(&mut stream, "404 Not Found", ""),
                    Callback::Code(code) => {
                        respond(&mut stream, "200 OK", PAGE_DONE);
                        return Ok(code);
                    }
                    // Fail closed: a callback that is wrong in any way ends
                    // this attempt rather than waiting for a better one.
                    Callback::Denied => {
                        respond(&mut stream, "200 OK", PAGE_FAILED);
                        return Err(GoogleError::new(Kind::Auth));
                    }
                    Callback::StateMismatch | Callback::Malformed => {
                        respond(&mut stream, "400 Bad Request", PAGE_FAILED);
                        return Err(GoogleError::new(Kind::Protocol));
                    }
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err(GoogleError::new(Kind::Network)),
        }
    }
}

// ------------------------------------------------------------------ tokens

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct Granted {
    calendar: bool,
    gmail: bool,
}

/// Which of the two scopes a token response says were granted. Exact matches
/// only: a scope that merely *contains* one of ours is not ours.
fn granted_of(scope: &str) -> Granted {
    let scopes: Vec<&str> = scope.split_whitespace().collect();
    Granted { calendar: scopes.contains(&SCOPE_CALENDAR), gmail: scopes.contains(&SCOPE_GMAIL) }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
    token_type: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct Grant {
    access: String,
    expires_in: Duration,
    refresh: Option<String>,
    /// `None` when the response did not say — a refresh may omit it.
    granted: Option<Granted>,
}

fn parse_token_response(body: &str) -> Result<Grant, GoogleError> {
    let protocol = || GoogleError::new(Kind::Protocol);
    let raw: TokenResponse = serde_json::from_str(body).map_err(|_| protocol())?;
    let access = raw.access_token.filter(|token| !token.is_empty()).ok_or_else(protocol)?;
    if let Some(kind) = &raw.token_type {
        if !kind.eq_ignore_ascii_case("bearer") {
            return Err(protocol());
        }
    }
    let lifetime = raw.expires_in.unwrap_or(DEFAULT_TOKEN_LIFETIME).clamp(60, 86_400);
    Ok(Grant {
        access,
        expires_in: Duration::from_secs(lifetime),
        refresh: raw.refresh_token.filter(|token| !token.is_empty()),
        granted: raw.scope.as_deref().map(granted_of),
    })
}

#[derive(Deserialize)]
struct TokenErrorBody {
    error: Option<String>,
}

/// The token endpoint's refusal, by its error *code* only.
fn classify_token_error(status: u16, body: &str) -> TokenFailure {
    let code = serde_json::from_str::<TokenErrorBody>(body).ok().and_then(|raw| raw.error);
    match (status, code.as_deref()) {
        (_, Some("invalid_grant")) => TokenFailure::InvalidGrant,
        (429, _) => TokenFailure::Failed(GoogleError::new(Kind::Quota)),
        (500..=599, _) => TokenFailure::Failed(GoogleError::new(Kind::Network)),
        // `invalid_client` and friends: a build configuration problem.
        _ => TokenFailure::Failed(GoogleError::new(Kind::Protocol)),
    }
}

fn is_fresh(expires_at: Instant, now: Instant) -> bool {
    expires_at > now + REFRESH_MARGIN
}

/// A usable access token: the cached one if it has more than a minute left,
/// otherwise a new one from `refresh`, which runs while the lock is held.
async fn current_token<R, F>(
    cache: &tokio::sync::Mutex<Tokens>,
    now: Instant,
    refresh: &R,
) -> Result<String, TokenFailure>
where
    R: Fn(String) -> F,
    F: Future<Output = Result<Grant, TokenFailure>>,
{
    let mut tokens = cache.lock().await;
    if let Some(access) = &tokens.access {
        if is_fresh(access.expires_at, now) {
            return Ok(access.value.clone());
        }
    }
    let Some(refresh_token) = tokens.refresh.clone() else {
        return Err(TokenFailure::NoCredential);
    };
    match refresh(refresh_token).await {
        Ok(grant) => {
            tokens.access =
                Some(Access { value: grant.access.clone(), expires_at: now + grant.expires_in });
            Ok(grant.access)
        }
        Err(TokenFailure::InvalidGrant) => {
            // Dead on Google's side; keeping it would only repeat the refusal.
            tokens.refresh = None;
            tokens.access = None;
            Err(TokenFailure::InvalidGrant)
        }
        Err(other) => Err(other),
    }
}

/// Drops a token Google just refused — unless another caller already replaced it.
async fn invalidate(cache: &tokio::sync::Mutex<Tokens>, rejected: &str) {
    let mut tokens = cache.lock().await;
    if tokens.access.as_ref().is_some_and(|access| access.value == rejected) {
        tokens.access = None;
    }
}

/// Runs `op` with a token, and once more with a refreshed one after a 401.
async fn authorized_call<T, N, R, RF, O, OF>(
    cache: &tokio::sync::Mutex<Tokens>,
    now: &N,
    refresh: &R,
    op: &O,
) -> Result<T, TokenFailure>
where
    N: Fn() -> Instant,
    R: Fn(String) -> RF,
    RF: Future<Output = Result<Grant, TokenFailure>>,
    O: Fn(String) -> OF,
    OF: Future<Output = Result<T, CallError>>,
{
    let token = current_token(cache, now(), refresh).await?;
    match op(token.clone()).await {
        Ok(value) => Ok(value),
        Err(CallError::Failed(error)) => Err(TokenFailure::Failed(error)),
        Err(CallError::Unauthorized) => {
            invalidate(cache, &token).await;
            let token = current_token(cache, now(), refresh).await?;
            match op(token).await {
                Ok(value) => Ok(value),
                Err(CallError::Unauthorized) => {
                    Err(TokenFailure::Failed(GoogleError::new(Kind::Auth)))
                }
                Err(CallError::Failed(error)) => Err(TokenFailure::Failed(error)),
            }
        }
    }
}

// ---------------------------------------------------------------- the wire

fn client() -> Result<reqwest::Client, GoogleError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| GoogleError::new(Kind::Network))
}

/// Only whether it timed out. `reqwest`'s own message can carry the URL.
fn transport(error: reqwest::Error) -> GoogleError {
    GoogleError::new(if error.is_timeout() { Kind::Timeout } else { Kind::Network })
}

async fn post_token(form: &[(&str, &str)]) -> Result<Grant, TokenFailure> {
    let response = client()
        .map_err(TokenFailure::Failed)?
        .post(TOKEN_ENDPOINT)
        .form(form)
        .send()
        .await
        .map_err(|error| TokenFailure::Failed(transport(error)))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|_| TokenFailure::Failed(GoogleError::new(Kind::Protocol)))?;
    if !(200..300).contains(&status) {
        return Err(classify_token_error(status, &body));
    }
    parse_token_response(&body).map_err(TokenFailure::Failed)
}

async fn exchange_code(code: &str, verifier: &str, redirect: &str) -> Result<Grant, TokenFailure> {
    let client_id = client_id().ok_or(TokenFailure::Failed(GoogleError::new(Kind::Unavailable)))?;
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret() {
        form.push(("client_secret", secret));
    }
    post_token(&form).await
}

async fn refresh_access(refresh_token: String) -> Result<Grant, TokenFailure> {
    let client_id = client_id().ok_or(TokenFailure::Failed(GoogleError::new(Kind::Unavailable)))?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret() {
        form.push(("client_secret", secret));
    }
    post_token(&form).await
}

/// Best effort. A failed revoke never keeps a local credential alive.
async fn revoke(token: &str) -> Result<(), GoogleError> {
    let response = client()?
        .post(REVOKE_ENDPOINT)
        .form(&[("token", token)])
        .send()
        .await
        .map_err(transport)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(GoogleError::new(Kind::Protocol))
    }
}

#[derive(Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorBody>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    status: Option<String>,
    #[serde(default)]
    errors: Vec<ApiErrorReason>,
}

#[derive(Deserialize)]
struct ApiErrorReason {
    reason: Option<String>,
}

/// An API refusal, by status and Google's machine-readable reason only.
fn classify_api(status: u16, body: &str) -> CallError {
    let rate_limited = || {
        let Ok(ApiErrorEnvelope { error: Some(error) }) = serde_json::from_str(body) else {
            return false;
        };
        error.status.as_deref() == Some("RESOURCE_EXHAUSTED")
            || error.errors.iter().any(|entry| {
                entry.reason.as_deref().is_some_and(|reason| {
                    reason.contains("RateLimitExceeded")
                        || reason.contains("rateLimitExceeded")
                        || reason == "quotaExceeded"
                })
            })
    };
    match status {
        401 => CallError::Unauthorized,
        429 => CallError::Failed(GoogleError::new(Kind::Quota)),
        403 if rate_limited() => CallError::Failed(GoogleError::new(Kind::Quota)),
        403 => CallError::Failed(GoogleError::new(Kind::Scope)),
        500..=599 => CallError::Failed(GoogleError::new(Kind::Network)),
        _ => CallError::Failed(GoogleError::new(Kind::Protocol)),
    }
}

async fn get_json(url: String, token: String) -> Result<String, CallError> {
    let response = client()
        .map_err(CallError::Failed)?
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| CallError::Failed(transport(error)))?;
    let status = response.status().as_u16();
    let body =
        response.text().await.map_err(|_| CallError::Failed(GoogleError::new(Kind::Protocol)))?;
    if (200..300).contains(&status) {
        Ok(body)
    } else {
        Err(classify_api(status, &body))
    }
}

// ------------------------------------------------------------------- dates

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let month_index = (month + 9) % 12;
    let doy = (153 * month_index + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Epoch milliseconds as RFC 3339 in UTC, to the second.
fn to_rfc3339(ms: i64) -> String {
    let seconds = ms.div_euclid(1000);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn digits(text: &str) -> Option<i64> {
    (!text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())
        .flatten()
}

/// `YYYY-MM-DD`, checked for a real day of a real month.
fn valid_date(text: &str) -> Option<(i64, i64, i64)> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let (year, month, day) = (digits(&text[0..4])?, digits(&text[5..7])?, digits(&text[8..10])?);
    if !(1..=12).contains(&month) || day < 1 {
        return None;
    }
    // Round-tripping through the day count rejects 31 April and 30 February.
    (civil_from_days(days_from_civil(year, month, day)) == (year, month, day))
        .then_some((year, month, day))
}

/// RFC 3339 date-time with an offset, as Google's Calendar API sends it.
fn parse_rfc3339(text: &str) -> Option<i64> {
    if text.len() < 20 || !text.is_ascii() {
        return None;
    }
    let (year, month, day) = valid_date(&text[0..10])?;
    if !matches!(text.as_bytes()[10], b'T' | b't') {
        return None;
    }
    let time = &text[11..];
    if time.len() < 9 || &time[2..3] != ":" || &time[5..6] != ":" {
        return None;
    }
    let (hour, minute, second) = (digits(&time[0..2])?, digits(&time[3..5])?, digits(&time[6..8])?);
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &time[8..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let end = fraction.find(|c: char| !c.is_ascii_digit()).unwrap_or(fraction.len());
        if end == 0 {
            return None;
        }
        let padded = format!("{:0<3}", &fraction[..end.min(3)]);
        millis = digits(&padded)?;
        rest = &fraction[end..];
    }
    let offset_minutes = match rest {
        "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes().first()? {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            if rest.len() != 6 || &rest[3..4] != ":" {
                return None;
            }
            let (hours, minutes) = (digits(&rest[1..3])?, digits(&rest[4..6])?);
            if hours > 23 || minutes > 59 {
                return None;
            }
            sign * (hours * 60 + minutes)
        }
    };
    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3600 + minute * 60 + second.min(59) - offset_minutes * 60;
    Some(seconds * 1000 + millis)
}

/// The window asked for, bounded: never more than eight days, never backwards.
fn clamp_window(from: i64, to: i64) -> Option<(i64, i64)> {
    let from = from.max(0);
    let to = to.min(from.saturating_add(MAX_WINDOW_MS));
    (to > from).then_some((from, to))
}

// ------------------------------------------------------------------- text

/// One line, bounded. Control characters become spaces; runs of space collapse.
fn clip(text: &str, max: usize) -> String {
    let spaced: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// Gmail's snippets are HTML-escaped. Only the entities it actually uses.
fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// An identifier Google minted, fit to be a path segment: nothing but
/// letters, digits, `_` and `-`. Anything else is not trusted into a URL.
fn safe_id(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_ID_CHARS
        && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

// ---------------------------------------------------------------- calendar

/// When an event happens: an instant, or — for an all-day event — a date,
/// which the renderer turns into its own local midnight.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EventTime {
    At { ms: i64 },
    Day { date: String },
}

/// One event as the renderer receives it. Nothing else of Google's crosses.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct CalendarEventDto {
    pub id: String,
    pub title: String,
    pub start: EventTime,
    pub end: Option<EventTime>,
    pub all_day: bool,
    pub status: String,
}

#[derive(Deserialize)]
struct EventsResponse {
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

fn time_of(value: Option<&serde_json::Value>) -> Option<EventTime> {
    let raw: RawTime = serde_json::from_value(value?.clone()).ok()?;
    if let Some(stamp) = raw.date_time {
        return parse_rfc3339(&stamp).map(|ms| EventTime::At { ms });
    }
    let date = raw.date?;
    valid_date(&date).map(|_| EventTime::Day { date })
}

fn normalize_event(item: &serde_json::Value) -> Option<CalendarEventDto> {
    let id = item.get("id")?.as_str()?;
    if !safe_id(id) {
        return None;
    }
    let status = match item.get("status").and_then(|value| value.as_str()) {
        Some(status @ ("confirmed" | "tentative")) => status,
        // Cancelled, or anything unknown: not a meeting to show.
        _ => return None,
    };
    let start = time_of(item.get("start"))?;
    let end = time_of(item.get("end"));
    match (&start, &end) {
        (EventTime::At { ms: from }, Some(EventTime::At { ms: to })) if to < from => return None,
        (EventTime::Day { date: from }, Some(EventTime::Day { date: to })) if to < from => {
            return None
        }
        // An all-day start with a timed end, or the reverse: not a real event.
        (EventTime::At { .. }, Some(EventTime::Day { .. }))
        | (EventTime::Day { .. }, Some(EventTime::At { .. })) => return None,
        _ => {}
    }
    let title = item.get("summary").and_then(|value| value.as_str()).unwrap_or("");
    Some(CalendarEventDto {
        id: id.to_string(),
        title: clip(title, TITLE_CHARS),
        all_day: matches!(start, EventTime::Day { .. }),
        start,
        end,
        status: status.to_string(),
    })
}

/// Google's events, validated one by one and capped. Pure.
fn normalize_events(body: &str) -> Result<Vec<CalendarEventDto>, GoogleError> {
    let raw: EventsResponse =
        serde_json::from_str(body).map_err(|_| GoogleError::new(Kind::Protocol))?;
    Ok(raw.items.iter().filter_map(normalize_event).take(MAX_EVENTS).collect())
}

fn events_url(from: i64, to: i64) -> String {
    let (time_min, time_max) = (to_rfc3339(from), to_rfc3339(to));
    let max = MAX_EVENTS.to_string();
    format!(
        "{CALENDAR_API}/calendars/primary/events?{}",
        query(&[
            ("timeMin", &time_min),
            ("timeMax", &time_max),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", &max),
            ("fields", "items(id,summary,start,end,status)"),
        ])
    )
}

/// The primary calendar's title, which Google sets to the account's address.
fn calendar_account_url() -> String {
    format!(
        "{CALENDAR_API}/calendars/primary/events?{}",
        query(&[("maxResults", "1"), ("fields", "summary")])
    )
}

// ------------------------------------------------------------------- gmail

/// One important email as the renderer receives it. There is no body field.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct EmailSignalDto {
    pub id: String,
    pub subject: String,
    pub sender: String,
    pub received_at: i64,
    pub important: bool,
    /// Empty when Google does not provide one under the metadata scope.
    pub snippet: String,
}

#[derive(Deserialize)]
struct MessageList {
    #[serde(default)]
    messages: Vec<MessageRef>,
}

#[derive(Deserialize)]
struct MessageRef {
    id: Option<String>,
}

/// Only what `EmailSignalDto` needs is even deserialised: a body or an
/// attachment in the response would have nowhere to land.
#[derive(Deserialize)]
struct RawMessage {
    id: Option<String>,
    #[serde(rename = "labelIds", default)]
    label_ids: Vec<String>,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    snippet: Option<String>,
    payload: Option<RawPayload>,
}

#[derive(Deserialize)]
struct RawPayload {
    #[serde(default)]
    headers: Vec<RawHeader>,
}

#[derive(Deserialize)]
struct RawHeader {
    name: Option<String>,
    value: Option<String>,
}

fn message_ids(body: &str, limit: usize) -> Result<Vec<String>, GoogleError> {
    let raw: MessageList =
        serde_json::from_str(body).map_err(|_| GoogleError::new(Kind::Protocol))?;
    Ok(raw
        .messages
        .into_iter()
        .filter_map(|entry| entry.id)
        .filter(|id| safe_id(id))
        .take(limit)
        .collect())
}

/// `"Ada Lovelace" <ada@example.com>` → `Ada Lovelace`; a bare address stays.
fn sender_of(from: &str) -> String {
    let name = match from.rfind('<') {
        Some(start) if !from[..start].trim().is_empty() => from[..start].trim(),
        Some(start) => from[start + 1..].trim_end_matches('>').trim(),
        None => from.trim(),
    };
    clip(name.trim_matches('"'), SENDER_CHARS)
}

fn normalize_message(body: &str) -> Option<EmailSignalDto> {
    let raw: RawMessage = serde_json::from_str(body).ok()?;
    let id = raw.id.filter(|id| safe_id(id))?;
    let received_at = raw.internal_date.as_deref().and_then(digits)?;
    let header = |wanted: &str| {
        raw.payload.as_ref().and_then(|payload| {
            payload.headers.iter().find_map(|header| {
                let name = header.name.as_deref()?;
                name.eq_ignore_ascii_case(wanted).then(|| header.value.clone()).flatten()
            })
        })
    };
    Some(EmailSignalDto {
        id,
        subject: clip(&header("Subject").unwrap_or_default(), TITLE_CHARS),
        sender: sender_of(&header("From").unwrap_or_default()),
        received_at,
        important: raw.label_ids.iter().any(|label| label == "IMPORTANT"),
        snippet: clip(&unescape(raw.snippet.as_deref().unwrap_or("")), SNIPPET_CHARS),
    })
}

fn clamp_limit(limit: u32) -> u32 {
    limit.clamp(1, MAX_SIGNALS)
}

fn messages_url(limit: u32) -> String {
    let max = limit.to_string();
    format!(
        "{GMAIL_API}/users/me/messages?{}",
        query(&[
            ("labelIds", "IMPORTANT"),
            ("labelIds", "INBOX"),
            ("maxResults", &max),
            ("fields", "messages(id)"),
        ])
    )
}

fn message_url(id: &str) -> Option<String> {
    safe_id(id).then(|| {
        format!(
            "{GMAIL_API}/users/me/messages/{id}?{}",
            query(&[
                ("format", "metadata"),
                ("metadataHeaders", "From"),
                ("metadataHeaders", "Subject"),
                ("fields", "id,labelIds,internalDate,snippet,payload/headers"),
            ])
        )
    })
}

fn profile_url() -> String {
    format!("{GMAIL_API}/users/me/profile?{}", query(&[("fields", "emailAddress")]))
}

/// An address fit to show as "connected as": one line, plausibly an address.
fn account_of(text: Option<&str>) -> Option<String> {
    let text = text?.trim();
    let plausible = text.contains('@')
        && text.len() <= ACCOUNT_CHARS
        && !text.chars().any(|c| c.is_control() || c.is_whitespace());
    plausible.then(|| text.to_string())
}

// ----------------------------------------------------------------- commands

fn keychain_error(_: secrets::SecretError) -> GoogleError {
    GoogleError::new(Kind::Keychain)
}

/// The only place this file reads the credential store: once per launch.
fn load_refresh_token() -> Result<Option<String>, GoogleError> {
    secrets::get(secrets::GOOGLE_REFRESH_TOKEN).map_err(keychain_error)
}

/// Establishes, once at launch, whether a Google account is connected — and
/// holds the refresh token from then on, so no request reads the keychain.
pub fn prime(app: &AppHandle) {
    if !configured_in_build() {
        return;
    }
    let state = app.state::<Arc<GoogleState>>();
    let token = load_refresh_token().ok().flatten();
    let authorized = token.is_some();
    if let Ok(mut tokens) = state.tokens.try_lock() {
        tokens.refresh = token;
    }
    let reconnect = store::google_record(app).reconnect_required;
    state.with_info(|info| {
        info.authorized = authorized;
        info.reconnect_required = reconnect && !authorized;
    });
}

fn status_of(app: &AppHandle) -> GoogleStatus {
    let state = app.state::<Arc<GoogleState>>();
    let record = store::google_record(app);
    let snapshot = state
        .with_info(|info| {
            (
                info.authorized,
                info.cancel.is_some(),
                info.reconnect_required,
                info.last_checked_at,
                info.last_error,
            )
        })
        .unwrap_or_default();
    let (authorized, connecting, reconnect_required, last_checked_at, last_error) = snapshot;
    GoogleStatus {
        configured_in_build: configured_in_build(),
        authorized,
        connecting,
        reconnect_required,
        calendar: authorized && record.calendar,
        gmail: authorized && record.gmail,
        account: if authorized { record.account } else { None },
        connected_at: if authorized { record.connected_at } else { None },
        last_checked_at,
        last_error,
        keychain_reads: secrets::read_count(),
    }
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> GoogleStatus {
    status_of(&app)
}

/// Starts the consent flow in the user's browser and waits for its answer.
#[tauri::command]
pub async fn google_connect(app: AppHandle) -> Result<GoogleStatus, GoogleError> {
    let Some(client_id) = client_id() else { return Err(GoogleError::new(Kind::Unavailable)) };
    let state = app.state::<Arc<GoogleState>>().inner().clone();

    let cancel = Arc::new(AtomicBool::new(false));
    let claimed = state
        .with_info(|info| {
            if info.cancel.is_some() {
                return false;
            }
            info.cancel = Some(Arc::clone(&cancel));
            true
        })
        .unwrap_or(false);
    if !claimed {
        return Err(GoogleError::new(Kind::Busy));
    }

    let outcome = connect_flow(&app, &state, client_id, cancel).await;
    state.with_info(|info| info.cancel = None);
    match outcome {
        Ok(()) => Ok(status_of(&app)),
        Err(error) => {
            if error.kind != Kind::Cancelled {
                eprintln!("[vaultwork] google connect failed: {:?}", error.kind);
            }
            Err(error)
        }
    }
}

async fn connect_flow(
    app: &AppHandle,
    state: &Arc<GoogleState>,
    client_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), GoogleError> {
    let verifier = new_verifier()?;
    let expected_state = new_state()?;

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|_| GoogleError::new(Kind::Network))?;
    listener.set_nonblocking(true).map_err(|_| GoogleError::new(Kind::Network))?;
    let port = listener.local_addr().map_err(|_| GoogleError::new(Kind::Network))?.port();
    let redirect = redirect_uri(port);

    let url = authorization_url(client_id, &redirect, &challenge_of(&verifier), &expected_state);
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| GoogleError::new(Kind::Protocol))?;

    let deadline = Instant::now() + CONNECT_LIMIT;
    let code = tauri::async_runtime::spawn_blocking(move || {
        await_callback(listener, &expected_state, &cancel, deadline)
    })
    .await
    .map_err(|_| GoogleError::new(Kind::Protocol))??;

    let grant = exchange_code(&code, &verifier, &redirect).await.map_err(|failure| match failure {
        TokenFailure::Failed(error) => error,
        _ => GoogleError::new(Kind::Auth),
    })?;
    let Some(refresh_token) = grant.refresh.clone() else {
        return Err(GoogleError::new(Kind::Protocol));
    };
    let granted = grant.granted.unwrap_or_default();
    if !granted.calendar && !granted.gmail {
        let _ = revoke(&refresh_token).await;
        return Err(GoogleError::new(Kind::NotGranted));
    }

    secrets::set(secrets::GOOGLE_REFRESH_TOKEN, &refresh_token).map_err(keychain_error)?;
    let replaced = {
        let mut tokens = state.tokens.lock().await;
        let previous = tokens.refresh.replace(refresh_token.clone());
        tokens.access = Some(Access {
            value: grant.access.clone(),
            expires_at: Instant::now() + grant.expires_in,
        });
        previous.filter(|old| *old != refresh_token)
    };
    state.with_info(|info| {
        info.authorized = true;
        info.reconnect_required = false;
        info.last_error = None;
    });
    store::remember_google(
        app,
        store::GoogleRecord {
            calendar: granted.calendar,
            gmail: granted.gmail,
            account: None,
            connected_at: Some(now_ms()),
            reconnect_required: false,
        },
    );

    // A round trip that names the account — and proves the connection works.
    let account = if granted.gmail {
        fetch_account(app, state, profile_url(), "emailAddress").await
    } else {
        fetch_account(app, state, calendar_account_url(), "summary").await
    };
    if account.is_some() {
        store::remember_google_account(app, account.as_deref());
    }
    // The grant this one replaced is no longer used; tell Google so.
    if let Some(old) = replaced {
        let _ = revoke(&old).await;
    }
    Ok(())
}

async fn fetch_account(
    app: &AppHandle,
    state: &Arc<GoogleState>,
    url: String,
    field: &'static str,
) -> Option<String> {
    let body = call(app, state, url).await.ok()?;
    let value: serde_json::Value = serde_json::from_str(&body).ok()?;
    account_of(value.get(field).and_then(|value| value.as_str()))
}

/// Ends a waiting connect flow. Harmless when none is waiting.
#[tauri::command]
pub fn google_cancel_connect(app: AppHandle) -> GoogleStatus {
    let state = app.state::<Arc<GoogleState>>();
    state.with_info(|info| {
        if let Some(cancel) = &info.cancel {
            cancel.store(true, Ordering::SeqCst);
        }
    });
    status_of(&app)
}

/// Forgets the account locally first, then asks Google to revoke the grant.
#[tauri::command]
pub async fn google_disconnect(app: AppHandle) -> Result<GoogleStatus, GoogleError> {
    let state = app.state::<Arc<GoogleState>>().inner().clone();
    let result = disconnect_with(
        &state,
        || secrets::delete(secrets::GOOGLE_REFRESH_TOKEN).map_err(keychain_error),
        || store::forget_google(&app),
        |token| async move { revoke(&token).await },
    )
    .await;
    result.map(|()| status_of(&app))
}

/// The disconnect order, separated from the keychain, the store and the
/// network so it can be tested: memory, keychain, settings, then Google.
async fn disconnect_with<D, S, R, RF>(
    state: &GoogleState,
    delete_secret: D,
    forget_settings: S,
    revoke_remote: R,
) -> Result<(), GoogleError>
where
    D: FnOnce() -> Result<(), GoogleError>,
    S: FnOnce(),
    R: FnOnce(String) -> RF,
    RF: Future<Output = Result<(), GoogleError>>,
{
    let token = {
        let mut tokens = state.tokens.lock().await;
        tokens.access = None;
        tokens.refresh.take()
    };
    state.with_info(|info| {
        info.authorized = false;
        info.reconnect_required = false;
        info.last_checked_at = None;
        info.last_error = None;
    });
    let deleted = delete_secret();
    forget_settings();
    if let Some(token) = token {
        // Local disconnect has already happened; this cannot undo it.
        let _ = revoke_remote(token).await;
    }
    deleted
}

/// One authorized GET, with the refresh, retry and reconnect rules applied and
/// the outcome recorded for the status. Every API request goes through here.
async fn call(
    app: &AppHandle,
    state: &Arc<GoogleState>,
    url: String,
) -> Result<String, GoogleError> {
    let refresh = |token: String| refresh_access(token);
    let op = |token: String| get_json(url.clone(), token);
    let outcome = authorized_call(&state.tokens, &Instant::now, &refresh, &op).await;
    match outcome {
        Ok(body) => {
            state.succeeded();
            Ok(body)
        }
        Err(TokenFailure::NoCredential) => Err(GoogleError::new(Kind::NotConnected)),
        Err(TokenFailure::InvalidGrant) => {
            // Revoked or expired on Google's side: the stored token is dead.
            let _ = secrets::delete(secrets::GOOGLE_REFRESH_TOKEN);
            store::mark_google_reconnect_required(app);
            state.with_info(|info| {
                info.authorized = false;
                info.reconnect_required = true;
                info.last_error = Some(Kind::Auth);
            });
            Err(GoogleError::new(Kind::Auth))
        }
        Err(TokenFailure::Failed(error)) => {
            state.failed(error.kind);
            eprintln!("[vaultwork] google request failed: {:?}", error.kind);
            Err(error)
        }
    }
}

/// The gate every read passes: built, connected, and granted this service.
fn ready_for(app: &AppHandle, wants_calendar: bool) -> Result<Arc<GoogleState>, GoogleError> {
    if !configured_in_build() {
        return Err(GoogleError::new(Kind::Unavailable));
    }
    let status = status_of(app);
    if status.reconnect_required {
        return Err(GoogleError::new(Kind::Auth));
    }
    if !status.authorized {
        return Err(GoogleError::new(Kind::NotConnected));
    }
    let granted = if wants_calendar { status.calendar } else { status.gmail };
    if !granted {
        return Err(GoogleError::new(Kind::NotGranted));
    }
    Ok(app.state::<Arc<GoogleState>>().inner().clone())
}

/// Events on the primary calendar between two instants — at most eight days.
#[tauri::command]
pub async fn google_calendar_events(
    app: AppHandle,
    from: i64,
    to: i64,
) -> Result<Vec<CalendarEventDto>, GoogleError> {
    let state = ready_for(&app, true)?;
    let Some((from, to)) = clamp_window(from, to) else { return Ok(Vec::new()) };
    let body = call(&app, &state, events_url(from, to)).await?;
    normalize_events(&body)
}

/// A few recent important inbox messages: headers and labels, never a body.
#[tauri::command]
pub async fn google_email_signals(
    app: AppHandle,
    limit: u32,
) -> Result<Vec<EmailSignalDto>, GoogleError> {
    let state = ready_for(&app, false)?;
    let limit = clamp_limit(limit);
    let list = call(&app, &state, messages_url(limit)).await?;
    let ids = message_ids(&list, limit as usize)?;

    // ponytail: sequential — at most eight small requests. Bounded fan-out if
    // latency ever matters.
    let mut signals = Vec::with_capacity(ids.len());
    let mut first_error = None;
    for id in &ids {
        let Some(url) = message_url(id) else { continue };
        match call(&app, &state, url).await {
            // One unreadable message is dropped; it does not sink the rest.
            Ok(body) => signals.extend(normalize_message(&body)),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    match first_error {
        Some(error) if signals.is_empty() => Err(error),
        _ => Ok(signals),
    }
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_time().build().expect("a runtime")
    }

    fn grant(access: &str) -> Grant {
        Grant {
            access: access.into(),
            expires_in: Duration::from_secs(3600),
            refresh: None,
            granted: None,
        }
    }

    fn tokens_with(
        refresh: Option<&str>,
        access: Option<(&str, Instant)>,
    ) -> tokio::sync::Mutex<Tokens> {
        tokio::sync::Mutex::new(Tokens {
            refresh: refresh.map(String::from),
            access: access.map(|(value, expires_at)| Access { value: value.into(), expires_at }),
        })
    }

    // ---------------------------------------------------------- PKCE, state

    #[test]
    fn pkce_matches_the_rfc_7636_vector() {
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_meet_the_rfc_constraints_and_are_never_reused() {
        let first = new_verifier().unwrap();
        let second = new_verifier().unwrap();
        for verifier in [&first, &second] {
            assert!((43..=128).contains(&verifier.len()), "length {}", verifier.len());
            assert!(verifier
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')));
        }
        assert_ne!(first, second);
    }

    #[test]
    fn states_are_long_random_and_url_safe() {
        let first = new_state().unwrap();
        let second = new_state().unwrap();
        assert_eq!(first.len(), 43, "32 bytes of entropy");
        assert!(first.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(first, second);
    }

    #[test]
    fn constant_time_comparison_rejects_every_difference() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
        assert!(!constant_time_eq("", "a"));
        assert!(constant_time_eq("", ""));
    }

    // -------------------------------------------------------- the auth URL

    #[test]
    fn the_authorization_url_is_built_from_constants_and_this_attempts_state() {
        let url = authorization_url("client-123", &redirect_uri(51234), "CHAL", "STATE");
        let (base, raw_query) = url.split_once('?').unwrap();
        assert_eq!(base, AUTH_ENDPOINT);

        let pairs: Vec<(String, String)> = raw_query
            .split('&')
            .map(|pair| {
                let (key, value) = pair.split_once('=').unwrap();
                (key.to_string(), decode(value).unwrap())
            })
            .collect();
        let keys: Vec<&str> = pairs.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "client_id",
                "redirect_uri",
                "response_type",
                "scope",
                "code_challenge",
                "code_challenge_method",
                "state",
                "access_type",
                "prompt"
            ]
        );
        let get = |key: &str| pairs.iter().find(|(k, _)| k == key).unwrap().1.clone();
        assert_eq!(get("redirect_uri"), "http://127.0.0.1:51234/callback");
        assert_eq!(get("scope"), format!("{SCOPE_CALENDAR} {SCOPE_GMAIL}"));
        assert_eq!(get("code_challenge_method"), "S256");
        assert_eq!(get("response_type"), "code");
        assert_eq!(get("state"), "STATE");
    }

    #[test]
    fn the_scopes_are_exactly_the_two_read_only_ones() {
        assert_eq!(
            SCOPES,
            [
                "https://www.googleapis.com/auth/calendar.events.owned.readonly",
                "https://www.googleapis.com/auth/gmail.metadata"
            ]
        );
    }

    // ----------------------------------------------------------- callback

    const STATE: &str = "expected-state";

    #[test]
    fn a_callback_on_another_path_or_method_is_not_ours() {
        for line in [
            "GET /favicon.ico HTTP/1.1",
            "GET / HTTP/1.1",
            "GET /callback/extra?code=a&state=expected-state HTTP/1.1",
            "POST /callback?code=a&state=expected-state HTTP/1.1",
        ] {
            assert_eq!(parse_callback(line, STATE), Callback::NotOurs, "{line}");
        }
    }

    #[test]
    fn a_callback_must_carry_the_exact_state() {
        assert_eq!(
            parse_callback("GET /callback?code=abc&state=expected-state HTTP/1.1", STATE),
            Callback::Code("abc".into())
        );
        for line in [
            "GET /callback?code=abc HTTP/1.1",
            "GET /callback?code=abc&state=other HTTP/1.1",
            "GET /callback?code=abc&state=expected-stat HTTP/1.1",
            "GET /callback?code=abc&state= HTTP/1.1",
        ] {
            assert_eq!(parse_callback(line, STATE), Callback::StateMismatch, "{line}");
        }
    }

    #[test]
    fn an_oauth_error_is_a_refusal_but_only_with_the_right_state() {
        assert_eq!(
            parse_callback(
                "GET /callback?error=access_denied&state=expected-state HTTP/1.1",
                STATE
            ),
            Callback::Denied
        );
        assert_eq!(
            parse_callback("GET /callback?error=access_denied&state=forged HTTP/1.1", STATE),
            Callback::StateMismatch
        );
    }

    #[test]
    fn duplicate_malformed_or_oversized_callbacks_are_refused() {
        for line in [
            "GET /callback?code=a&code=b&state=expected-state HTTP/1.1",
            "GET /callback?code=a&state=expected-state&state=expected-state HTTP/1.1",
            "GET /callback?code=%ZZ&state=expected-state HTTP/1.1",
            "GET /callback?state=expected-state HTTP/1.1",
            "GET /callback?code=has%20space&state=expected-state HTTP/1.1",
            "garbage",
        ] {
            assert_eq!(parse_callback(line, STATE), Callback::Malformed, "{line}");
        }
        let long =
            format!("GET /callback?code={}&state=expected-state HTTP/1.1", "a".repeat(3000));
        assert_eq!(parse_callback(&long, STATE), Callback::Malformed);

        assert!(request_line_of(&vec![b'a'; MAX_CALLBACK_BYTES + 1]).is_none());
        assert!(request_line_of(b"").is_none());
        assert_eq!(
            request_line_of(b"GET /x HTTP/1.1\r\nHost: a\r\n\r\n"),
            Some("GET /x HTTP/1.1")
        );
    }

    #[test]
    fn a_real_loopback_callback_is_accepted_once_and_answers_the_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = AtomicBool::new(false);

        let browser = std::thread::spawn(move || {
            let mut favicon = TcpStream::connect(("127.0.0.1", port)).unwrap();
            favicon.write_all(b"GET /favicon.ico HTTP/1.1\r\n\r\n").unwrap();
            let mut ignored = String::new();
            let _ = favicon.read_to_string(&mut ignored);

            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream
                .write_all(b"GET /callback?code=the-code&state=expected-state HTTP/1.1\r\n\r\n")
                .unwrap();
            let mut page = String::new();
            stream.read_to_string(&mut page).unwrap();
            (ignored, page)
        });

        let code =
            await_callback(listener, STATE, &cancel, Instant::now() + Duration::from_secs(10));
        let (favicon, page) = browser.join().unwrap();
        assert_eq!(code.unwrap(), "the-code");
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains(PAGE_DONE));
        assert!(!page.contains("the-code"), "the code is never echoed");
    }

    #[test]
    fn a_waiting_callback_ends_on_cancel_or_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let cancel = AtomicBool::new(true);
        let far = Instant::now() + Duration::from_secs(60);
        assert_eq!(
            await_callback(listener, STATE, &cancel, far).unwrap_err().kind,
            Kind::Cancelled
        );

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let cancel = AtomicBool::new(false);
        assert_eq!(
            await_callback(listener, STATE, &cancel, Instant::now()).unwrap_err().kind,
            Kind::Timeout
        );
    }

    // ------------------------------------------------------------- tokens

    #[test]
    fn granted_scopes_are_parsed_exactly_including_partial_grants() {
        let both = format!("{SCOPE_CALENDAR} {SCOPE_GMAIL}");
        assert_eq!(granted_of(&both), Granted { calendar: true, gmail: true });
        assert_eq!(granted_of(SCOPE_CALENDAR), Granted { calendar: true, gmail: false });
        assert_eq!(granted_of(SCOPE_GMAIL), Granted { calendar: false, gmail: true });
        assert_eq!(granted_of(""), Granted::default());
        // A lookalike is not ours.
        let spoof = format!("{SCOPE_GMAIL}.extra {SCOPE_CALENDAR}x");
        assert_eq!(granted_of(&spoof), Granted::default());
    }

    #[test]
    fn token_responses_are_validated() {
        let ok = parse_token_response(&format!(
            r#"{{"access_token":"ya29.a","expires_in":3599,"refresh_token":"1//r","scope":"{SCOPE_GMAIL}","token_type":"Bearer"}}"#
        ))
        .unwrap();
        assert_eq!(ok.access, "ya29.a");
        assert_eq!(ok.refresh.as_deref(), Some("1//r"));
        assert_eq!(ok.expires_in, Duration::from_secs(3599));
        assert_eq!(ok.granted, Some(Granted { calendar: false, gmail: true }));

        let short = parse_token_response(r#"{"access_token":"a","expires_in":5}"#).unwrap();
        assert_eq!(short.expires_in, Duration::from_secs(60), "clamped");
        assert_eq!(short.granted, None);

        for bad in
            ["", "{}", r#"{"access_token":""}"#, r#"{"access_token":"a","token_type":"mac"}"#]
        {
            assert_eq!(parse_token_response(bad).unwrap_err().kind, Kind::Protocol, "{bad}");
        }
    }

    #[test]
    fn token_endpoint_refusals_are_classified_by_code_alone() {
        assert_eq!(
            classify_token_error(
                400,
                r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#
            ),
            TokenFailure::InvalidGrant
        );
        assert_eq!(
            classify_token_error(401, r#"{"error":"invalid_client"}"#),
            TokenFailure::Failed(GoogleError::new(Kind::Protocol))
        );
        assert_eq!(
            classify_token_error(503, "down"),
            TokenFailure::Failed(GoogleError::new(Kind::Network))
        );
        assert_eq!(
            classify_token_error(429, "{}"),
            TokenFailure::Failed(GoogleError::new(Kind::Quota))
        );
    }

    #[test]
    fn a_fresh_token_is_reused_and_a_nearly_expired_one_is_refreshed() {
        let runtime = runtime();
        let now = Instant::now();
        let refreshes = AtomicUsize::new(0);
        let refresh = |_: String| {
            refreshes.fetch_add(1, Ordering::SeqCst);
            async { Ok(grant("new")) }
        };

        let fresh = tokens_with(Some("r"), Some(("old", now + Duration::from_secs(600))));
        assert_eq!(runtime.block_on(current_token(&fresh, now, &refresh)).unwrap(), "old");
        assert_eq!(refreshes.load(Ordering::SeqCst), 0);

        let stale = tokens_with(Some("r"), Some(("old", now + Duration::from_secs(30))));
        assert_eq!(runtime.block_on(current_token(&stale, now, &refresh)).unwrap(), "new");
        assert_eq!(refreshes.load(Ordering::SeqCst), 1, "within 60 seconds is refreshed");

        let none = tokens_with(None, None);
        assert_eq!(
            runtime.block_on(current_token(&none, now, &refresh)),
            Err(TokenFailure::NoCredential)
        );
    }

    #[test]
    fn invalid_grant_forgets_the_credential() {
        let runtime = runtime();
        let cache = tokens_with(Some("dead"), None);
        let refresh = |_: String| async { Err::<Grant, _>(TokenFailure::InvalidGrant) };
        assert_eq!(
            runtime.block_on(current_token(&cache, Instant::now(), &refresh)),
            Err(TokenFailure::InvalidGrant)
        );
        let tokens = runtime.block_on(cache.lock());
        assert!(tokens.refresh.is_none() && tokens.access.is_none());
    }

    #[test]
    fn a_401_is_retried_once_with_a_refreshed_token() {
        let runtime = runtime();
        let now = Instant::now();
        let cache =
            tokens_with(Some("r"), Some(("stale-but-unexpired", now + Duration::from_secs(600))));
        let refreshes = AtomicUsize::new(0);
        let refresh = |_: String| {
            refreshes.fetch_add(1, Ordering::SeqCst);
            async { Ok(grant("renewed")) }
        };
        let seen = Mutex::new(Vec::new());
        let op = |token: String| {
            seen.lock().unwrap().push(token.clone());
            async move {
                if token == "renewed" {
                    Ok("body")
                } else {
                    Err(CallError::Unauthorized)
                }
            }
        };
        let result = runtime.block_on(authorized_call(&cache, &|| now, &refresh, &op));
        assert_eq!(result.unwrap(), "body");
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(*seen.lock().unwrap(), ["stale-but-unexpired", "renewed"]);

        // Refused twice: an auth failure, and no third attempt.
        let cache = tokens_with(Some("r"), None);
        let calls = AtomicUsize::new(0);
        let always = |_: String| {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err::<&str, _>(CallError::Unauthorized) }
        };
        let result = runtime.block_on(authorized_call(&cache, &|| now, &refresh, &always));
        assert_eq!(result, Err(TokenFailure::Failed(GoogleError::new(Kind::Auth))));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn concurrent_callers_share_one_refresh() {
        let runtime = runtime();
        let cache = Arc::new(tokens_with(Some("r"), None));
        let refreshes = Arc::new(AtomicUsize::new(0));
        runtime.block_on(async {
            let local = tokio::task::LocalSet::new();
            local
                .run_until(async {
                    let mut handles = Vec::new();
                    for _ in 0..8 {
                        let cache = Arc::clone(&cache);
                        let refreshes = Arc::clone(&refreshes);
                        handles.push(tokio::task::spawn_local(async move {
                            let refresh = |_: String| {
                                let refreshes = Arc::clone(&refreshes);
                                async move {
                                    refreshes.fetch_add(1, Ordering::SeqCst);
                                    tokio::task::yield_now().await;
                                    Ok(grant("shared"))
                                }
                            };
                            current_token(&cache, Instant::now(), &refresh).await
                        }));
                    }
                    for handle in handles {
                        assert_eq!(handle.await.unwrap().unwrap(), "shared");
                    }
                })
                .await;
        });
        assert_eq!(refreshes.load(Ordering::SeqCst), 1, "one refresh, eight callers");
    }

    #[test]
    fn a_cached_credential_costs_no_keychain_read() {
        let runtime = runtime();
        let cache = tokens_with(Some("r"), None);
        let refresh = |_: String| async { Ok(grant("a")) };
        let before = secrets::read_count();
        for _ in 0..20 {
            runtime.block_on(current_token(&cache, Instant::now(), &refresh)).unwrap();
        }
        assert_eq!(secrets::read_count(), before);
    }

    // ---------------------------------------------------------- disconnect

    #[test]
    fn disconnect_clears_everything_locally_even_when_revoke_fails() {
        let runtime = runtime();
        let state = GoogleState::default();
        runtime.block_on(async {
            let mut tokens = state.tokens.lock().await;
            tokens.refresh = Some("refresh".into());
            tokens.access = Some(Access { value: "access".into(), expires_at: Instant::now() });
        });
        state.with_info(|info| {
            info.authorized = true;
            info.last_checked_at = Some(1);
        });

        let deleted = AtomicBool::new(false);
        let forgot = AtomicBool::new(false);
        let revoked_with = Mutex::new(None);
        let result = runtime.block_on(disconnect_with(
            &state,
            || {
                deleted.store(true, Ordering::SeqCst);
                Ok(())
            },
            || forgot.store(true, Ordering::SeqCst),
            |token| {
                *revoked_with.lock().unwrap() = Some(token);
                async { Err(GoogleError::new(Kind::Network)) }
            },
        ));

        assert!(result.is_ok(), "a failed revoke is still a local disconnect");
        assert!(deleted.load(Ordering::SeqCst) && forgot.load(Ordering::SeqCst));
        assert_eq!(revoked_with.lock().unwrap().as_deref(), Some("refresh"));
        let tokens = runtime.block_on(state.tokens.lock());
        assert!(tokens.refresh.is_none() && tokens.access.is_none());
        assert!(!state.with_info(|info| info.authorized).unwrap());
    }

    // ------------------------------------------------------------ calendar

    #[test]
    fn calendar_events_are_normalised_and_everything_else_dropped() {
        let body = r#"{ "items": [
            { "id": "timed1", "summary": "Standup", "status": "confirmed",
              "start": { "dateTime": "2026-09-22T09:30:00+05:30" },
              "end": { "dateTime": "2026-09-22T10:00:00+05:30" },
              "description": "secret agenda", "attendees": [{"email":"a@b.c"}], "htmlLink": "https://x" },
            { "id": "allday", "summary": "Holiday", "status": "tentative",
              "start": { "date": "2026-09-24" }, "end": { "date": "2026-09-25" } },
            { "id": "gone", "summary": "Cancelled", "status": "cancelled", "start": { "date": "2026-09-24" } },
            { "id": "nostart", "summary": "x", "status": "confirmed" },
            { "id": "backwards", "status": "confirmed",
              "start": { "dateTime": "2026-09-22T11:00:00Z" }, "end": { "dateTime": "2026-09-22T10:00:00Z" } },
            { "id": "../evil", "status": "confirmed", "start": { "date": "2026-09-24" } },
            { "id": "baddate", "status": "confirmed", "start": { "date": "2026-02-30" } },
            { "id": "mixed", "status": "confirmed", "start": { "date": "2026-09-24" }, "end": { "dateTime": "2026-09-24T10:00:00Z" } },
            "not an object"
        ] }"#;
        let events = normalize_events(body).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0],
            CalendarEventDto {
                id: "timed1".into(),
                title: "Standup".into(),
                start: EventTime::At { ms: parse_rfc3339("2026-09-22T04:00:00Z").unwrap() },
                end: Some(EventTime::At { ms: parse_rfc3339("2026-09-22T04:30:00Z").unwrap() }),
                all_day: false,
                status: "confirmed".into(),
            }
        );
        assert!(events[1].all_day);
        assert_eq!(events[1].start, EventTime::Day { date: "2026-09-24".into() });
        let json = serde_json::to_string(&events).unwrap();
        assert!(!json.contains("secret agenda"));
        assert!(!json.contains("a@b.c"));
        assert!(!json.contains("https://x"));
    }

    #[test]
    fn calendar_titles_are_one_bounded_line_and_results_are_capped() {
        let item = |i: usize| {
            format!(
                r#"{{"id":"e{i}","summary":"Line\none\u0007{}","status":"confirmed","start":{{"date":"2026-09-24"}}}}"#,
                "x".repeat(400)
            )
        };
        let body =
            format!(r#"{{"items":[{}]}}"#, (0..80).map(item).collect::<Vec<_>>().join(","));
        let events = normalize_events(&body).unwrap();
        assert_eq!(events.len(), MAX_EVENTS);
        assert_eq!(events[0].title.chars().count(), TITLE_CHARS);
        assert!(events[0].title.starts_with("Line one "));
        assert!(!events[0].title.chars().any(char::is_control));
        assert_eq!(normalize_events("not json").unwrap_err().kind, Kind::Protocol);
    }

    #[test]
    fn rfc3339_is_parsed_and_formatted_exactly() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2026-09-22T00:00:00.250Z"), Some(1_790_035_200_250));
        assert_eq!(parse_rfc3339("2026-09-22T05:30:00+05:30"), Some(1_790_035_200_000));
        assert_eq!(parse_rfc3339("2026-09-21T20:00:00-04:00"), Some(1_790_035_200_000));
        for bad in [
            "",
            "2026-09-22",
            "2026-13-01T00:00:00Z",
            "2026-09-22T25:00:00Z",
            "2026-09-22T00:00:00",
            "2026-09-22T00:00:00+0530",
        ] {
            assert_eq!(parse_rfc3339(bad), None, "{bad}");
        }
        assert_eq!(to_rfc3339(1_790_035_200_000), "2026-09-22T00:00:00Z");
        assert_eq!(to_rfc3339(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn the_calendar_window_is_clamped_to_eight_days() {
        let from = 1_790_035_200_000;
        assert_eq!(clamp_window(from, from + 7 * DAY_MS), Some((from, from + 7 * DAY_MS)));
        assert_eq!(clamp_window(from, from + 400 * DAY_MS), Some((from, from + MAX_WINDOW_MS)));
        assert_eq!(clamp_window(from, from), None);
        assert_eq!(clamp_window(from, from - 1), None);
        assert_eq!(clamp_window(-5, DAY_MS), Some((0, DAY_MS)));
    }

    #[test]
    fn the_events_request_is_fixed_to_the_primary_calendar_and_five_fields() {
        let url = events_url(0, DAY_MS);
        assert!(url
            .starts_with("https://www.googleapis.com/calendar/v3/calendars/primary/events?"));
        let decoded = decode(url.split_once('?').unwrap().1).unwrap();
        assert!(decoded.contains("singleEvents=true"));
        assert!(decoded.contains("orderBy=startTime"));
        assert!(decoded.contains("maxResults=50"));
        assert!(decoded.contains("fields=items(id,summary,start,end,status)"));
        assert!(decoded.contains("timeMin=1970-01-01T00:00:00Z"));
    }

    // --------------------------------------------------------------- gmail

    #[test]
    fn gmail_metadata_is_normalised_without_a_body() {
        let body = r#"{
            "id": "18c2f3a", "labelIds": ["INBOX", "IMPORTANT", "UNREAD"],
            "internalDate": "1790035200000",
            "snippet": "Please review &amp; sign &#39;today&#39;",
            "payload": { "headers": [
                { "name": "From", "value": "\"HR Team\" <hr@example.com>" },
                { "name": "subject", "value": "Offer letter\r\nBcc: injected" }
            ], "body": { "data": "RlVMTCBCT0RZ" }, "parts": [{ "body": { "data": "QVRUQUNI" } }] }
        }"#;
        let signal = normalize_message(body).unwrap();
        assert_eq!(
            signal,
            EmailSignalDto {
                id: "18c2f3a".into(),
                subject: "Offer letter Bcc: injected".into(),
                sender: "HR Team".into(),
                received_at: 1_790_035_200_000,
                important: true,
                snippet: "Please review & sign 'today'".into(),
            }
        );
        let json = serde_json::to_string(&signal).unwrap();
        assert!(!json.contains("RlVMTCBCT0RZ") && !json.contains("QVRUQUNI"));
    }

    #[test]
    fn gmail_messages_without_a_snippet_or_with_bad_fields_degrade_or_drop() {
        let bare = normalize_message(
            r#"{"id":"a1","internalDate":"5","payload":{"headers":[{"name":"From","value":"ada@example.com"}]}}"#,
        )
        .unwrap();
        assert_eq!(bare.snippet, "");
        assert_eq!(bare.sender, "ada@example.com");
        assert!(!bare.important);

        assert!(normalize_message(r#"{"id":"a1"}"#).is_none(), "undated");
        assert!(normalize_message(r#"{"id":"a1","internalDate":"yesterday"}"#).is_none());
        assert!(normalize_message(r#"{"id":"../x","internalDate":"5"}"#).is_none());
        assert!(normalize_message("not json").is_none());
    }

    #[test]
    fn senders_are_display_names_when_there_is_one() {
        assert_eq!(sender_of("Ada Lovelace <ada@example.com>"), "Ada Lovelace");
        assert_eq!(sender_of("<ada@example.com>"), "ada@example.com");
        assert_eq!(sender_of("ada@example.com"), "ada@example.com");
        assert_eq!(
            sender_of(&format!("{} <a@b.c>", "n".repeat(500))).chars().count(),
            SENDER_CHARS
        );
    }

    #[test]
    fn message_ids_are_bounded_and_safe_to_put_in_a_path() {
        let body = r#"{"messages":[{"id":"a1"},{"id":"../../profile"},{"id":"b2?x=1"},{"id":"c3"},{}]}"#;
        assert_eq!(message_ids(body, 8).unwrap(), ["a1", "c3"]);
        assert_eq!(message_ids(body, 1).unwrap(), ["a1"]);
        assert_eq!(message_ids("{}", 8).unwrap(), Vec::<String>::new());
        assert!(message_url("../x").is_none());
    }

    #[test]
    fn the_gmail_requests_are_fixed_and_metadata_only() {
        assert_eq!(clamp_limit(0), 1);
        assert_eq!(clamp_limit(500), MAX_SIGNALS);
        let list = decode(messages_url(8).split_once('?').unwrap().1).unwrap();
        assert_eq!(list, "labelIds=IMPORTANT&labelIds=INBOX&maxResults=8&fields=messages(id)");
        let one = message_url("a1").unwrap();
        assert!(one.starts_with("https://gmail.googleapis.com/gmail/v1/users/me/messages/a1?"));
        let decoded = decode(one.split_once('?').unwrap().1).unwrap();
        assert!(decoded
            .starts_with("format=metadata&metadataHeaders=From&metadataHeaders=Subject&"));
        assert!(!decoded.contains("format=full") && !decoded.contains("format=raw"));
        assert!(!decoded.contains("q="), "the metadata scope forbids search");
    }

    // -------------------------------------------------------------- errors

    #[test]
    fn api_failures_map_to_fixed_kinds_and_never_carry_googles_words() {
        let secret_body = r#"{"error":{"code":403,"message":"insufficient scopes token=SECRET","status":"PERMISSION_DENIED","errors":[{"reason":"insufficientPermissions"}]}}"#;
        assert_eq!(classify_api(401, "{}"), CallError::Unauthorized);
        assert_eq!(
            classify_api(403, secret_body),
            CallError::Failed(GoogleError::new(Kind::Scope))
        );
        assert_eq!(
            classify_api(403, r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#),
            CallError::Failed(GoogleError::new(Kind::Quota))
        );
        assert_eq!(classify_api(429, ""), CallError::Failed(GoogleError::new(Kind::Quota)));
        assert_eq!(classify_api(503, ""), CallError::Failed(GoogleError::new(Kind::Network)));
        assert_eq!(classify_api(404, ""), CallError::Failed(GoogleError::new(Kind::Protocol)));

        for kind in
            [Kind::Auth, Kind::Scope, Kind::Network, Kind::Timeout, Kind::Quota, Kind::Protocol]
        {
            let json = serde_json::to_string(&GoogleError::new(kind)).unwrap();
            assert!(!json.contains("SECRET") && !json.contains("token"), "{json}");
        }
        assert_eq!(
            serde_json::to_string(&GoogleError::new(Kind::NotGranted)).unwrap(),
            r#"{"kind":"not-granted","message":"That access was not granted when Google was connected."}"#
        );
    }

    #[test]
    fn the_status_shape_is_a_closed_set_of_harmless_fields() {
        let json = serde_json::to_value(GoogleStatus::default()).unwrap();
        let mut keys: Vec<&String> = json.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "account",
                "authorized",
                "calendar",
                "configured_in_build",
                "connected_at",
                "connecting",
                "gmail",
                "keychain_reads",
                "last_checked_at",
                "last_error",
                "reconnect_required"
            ]
        );
    }

    #[test]
    fn accounts_are_shown_only_when_they_look_like_an_address() {
        assert_eq!(account_of(Some("ada@example.com")).as_deref(), Some("ada@example.com"));
        assert_eq!(account_of(Some("My calendar")), None);
        assert_eq!(account_of(Some("a@b\nc")), None);
        assert_eq!(account_of(None), None);
    }
}
