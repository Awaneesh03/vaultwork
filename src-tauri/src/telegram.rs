//! The Telegram Bot API client and polling worker.
//!
//! This is the only file in Vaultwork that makes a network request, and the
//! only one that can read the bot token. Three constraints shape it:
//!
//!  1. **There is no generic HTTP command.** The base URL is a constant, the
//!     three endpoints are named methods, and the renderer cannot influence the
//!     host it talks to. A `http_request(url, headers, body)` bridge would hand
//!     any script in the WebView the user's whole network.
//!
//!  2. **The token never leaves this process.** It is read from the Keychain
//!     immediately before a request and dropped after; it is not returned by
//!     any command, not emitted in any event, and not written to any log line.
//!
//!  3. **Nothing here decides what a message means.** The worker normalises an
//!     update and hands it to the renderer, which runs it through the same
//!     command layer the UI uses. There is no task model in this file, because
//!     a second place that knows what `/add` means is a second application.
//!
//! Authorization is enforced *here*, before an update is ever emitted: a
//! message from an unrecognised chat is answered and dropped, so it cannot
//! reach the command layer even if the renderer had a bug.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::secrets;
use crate::store;

const API_BASE: &str = "https://api.telegram.org";
/// Telegram holds the request open this long when there is nothing to send.
const LONG_POLL_SECONDS: u64 = 25;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(40);
/// Backoff bounds for a failing network or a rate limit.
const BACKOFF_START: Duration = Duration::from_secs(2);
const BACKOFF_MAX: Duration = Duration::from_secs(60);
/// Breathing room when updates arrive faster than they are acknowledged.
const IDLE_PAUSE: Duration = Duration::from_secs(1);

pub const UPDATE_EVENT: &str = "vaultwork://telegram-update";
pub const STATUS_EVENT: &str = "vaultwork://telegram-status";

// ------------------------------------------------------------------- state

/// What the UI is allowed to know. Note what is absent: the token.
#[derive(Clone, Serialize, Default)]
pub struct TelegramStatus {
    /// A token is in the Keychain.
    pub configured: bool,
    /// The poll worker is alive.
    pub running: bool,
    pub bot_username: Option<String>,
    pub authorized_chat_id: Option<String>,
    /// A chat that has messaged us but has not been approved.
    pub pending_chat_id: Option<String>,
    pub pending_chat_name: Option<String>,
    pub auto_start: bool,
    /// The last failure, in words a person can act on.
    pub last_error: Option<String>,
    /// Diagnostic: how many times this process has read the credential store.
    pub keychain_reads: u64,
}

#[derive(Default)]
pub struct TelegramState {
    running: AtomicBool,
    /// Generation counter: a worker whose generation is stale exits. This is
    /// what makes `start` idempotent — a second call cannot leave two loops
    /// polling the same bot and racing for the same updates.
    generation: AtomicI64,
    offset: AtomicI64,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    bot_username: Option<String>,
    pending_chat_id: Option<String>,
    pending_chat_name: Option<String>,
    last_error: Option<String>,
    /// The bot token, held for the lifetime of a worker session.
    ///
    /// Read from the OS credential store exactly once, when the worker starts,
    /// and dropped when it stops. Holding it here rather than re-reading is not
    /// a weakening: the process must possess the token to make a request at
    /// all, and the Keychain protects the secret *at rest* and *between
    /// applications*, not against the one process the user authorised to use
    /// it. Re-reading per request bought nothing and cost a macOS
    /// authorization prompt every time.
    token: Option<String>,
    /// Whether a token exists at all, cached so `status()` — which the UI calls
    /// often, and which the message loop calls per message — does not touch the
    /// credential store.
    configured: bool,
}

/// The parts of `Inner` a status is allowed to carry.
///
/// Deliberately not `Inner` itself: that holds the bot token, and this is the
/// value that leaves the lock and goes on to be serialised to the renderer.
#[derive(Default)]
struct InnerSnapshot {
    configured: bool,
    bot_username: Option<String>,
    pending_chat_id: Option<String>,
    pending_chat_name: Option<String>,
    last_error: Option<String>,
}

impl TelegramState {
    /// The session token, if a worker has loaded one.
    fn token(&self) -> Option<String> {
        self.inner.lock().ok().and_then(|inner| inner.token.clone())
    }

    fn set_token(&self, token: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.configured = token.is_some() || inner.configured;
            inner.token = token;
        }
    }

    /// Forgets the token held in memory. The credential store is untouched.
    fn clear_token(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.token = None;
        }
    }

    /// Copies everything `status_of` shows out from under a single lock.
    ///
    /// This exists so that reading a status is *one* lock acquisition. The
    /// previous shape took the guard and then called `is_configured()`, which
    /// locks `inner` again; a `std::sync::Mutex` does not re-enter, so that
    /// deadlocked the caller — and the caller of a synchronous command is the
    /// main thread.
    fn snapshot(&self) -> InnerSnapshot {
        match self.inner.lock() {
            Ok(inner) => InnerSnapshot {
                configured: inner.configured,
                bot_username: inner.bot_username.clone(),
                pending_chat_id: inner.pending_chat_id.clone(),
                pending_chat_name: inner.pending_chat_name.clone(),
                last_error: inner.last_error.clone(),
            },
            Err(_) => InnerSnapshot::default(),
        }
    }

    fn set_configured(&self, configured: bool) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.configured = configured;
            if !configured {
                inner.token = None;
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

    fn set_pending(&self, id: Option<String>, name: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending_chat_id = id;
            inner.pending_chat_name = name;
        }
    }
}

#[derive(Serialize, Debug)]
pub struct TelegramError {
    pub kind: String,
    pub message: String,
}

impl TelegramError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.into(), message: message.into() }
    }

    fn not_configured() -> Self {
        Self::new("not-configured", "No Telegram bot token has been saved.")
    }
}

// ---------------------------------------------------------------- the wire

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
    error_code: Option<i64>,
    parameters: Option<ApiParameters>,
}

#[derive(Deserialize)]
struct ApiParameters {
    retry_after: Option<u64>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct BotIdentity {
    pub id: i64,
    pub username: Option<String>,
    pub first_name: Option<String>,
}

#[derive(Deserialize)]
struct Update {
    update_id: i64,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    chat: Option<Chat>,
    from: Option<User>,
    text: Option<String>,
    date: Option<i64>,
}

#[derive(Deserialize)]
struct Chat {
    id: i64,
    first_name: Option<String>,
    username: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize)]
struct User {
    id: i64,
}

/// The normalised shape the renderer sees. No Telegram API types cross this
/// boundary — the application depends on this struct, not on Bot API JSON.
#[derive(Serialize, Clone)]
pub struct IncomingMessage {
    pub source: &'static str,
    /// Telegram's `update_id`, as a string. The deduplication identity.
    pub external_id: String,
    pub chat_id: String,
    pub sender_id: Option<String>,
    pub text: String,
    pub received_at: i64,
}

/// Where the Bot API lives.
///
/// A constant in release builds. In a debug build it may be pointed at a local
/// fake so the whole pipeline — polling, offsets, deduplication, replies — can
/// be exercised end to end without a real bot account. There is deliberately no
/// way for the renderer to set this: it is read from the process environment at
/// startup, which a WebView cannot write to.
fn api_base() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(base) = std::env::var("VAULTWORK_TELEGRAM_API_BASE") {
            if !base.is_empty() {
                return base;
            }
        }
    }
    API_BASE.to_string()
}

fn client() -> Result<reqwest::Client, TelegramError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| TelegramError::new("network", format!("HTTP client failed: {error}")))
}

/// Performs one Bot API call with a token the caller already holds.
///
/// Deliberately takes the token rather than fetching it. The credential store
/// is consulted once per worker session (`load_token`), not once per request —
/// see the note on `Inner::token`.
async fn call<T: for<'de> Deserialize<'de>>(
    token: &str,
    method: &str,
    body: serde_json::Value,
) -> Result<T, TelegramError> {
    let url = format!("{}/bot{}/{}", api_base(), token, method);
    let response = client()?
        .post(&url)
        .json(&body)
        .send()
        .await
        // The error is reported without the URL: it contains the token.
        .map_err(|error| {
            let kind = if error.is_timeout() { "timeout" } else { "network" };
            TelegramError::new(kind, format!("Telegram is unreachable ({kind}): {}", error.status().map(|s| s.to_string()).unwrap_or_else(|| "no response".into())))
        })?;

    let envelope: ApiEnvelope<T> = response
        .json()
        .await
        .map_err(|_| TelegramError::new("protocol", "Telegram sent a response we could not read."))?;

    if envelope.ok {
        return envelope
            .result
            .ok_or_else(|| TelegramError::new("protocol", "Telegram sent an empty result."));
    }

    let code = envelope.error_code.unwrap_or(0);
    let kind = match code {
        401 => "invalid-token",
        429 => "rate-limited",
        _ => "api",
    };
    let retry = envelope.parameters.and_then(|p| p.retry_after);
    let mut message = match kind {
        "invalid-token" => "Telegram rejected the bot token.".to_string(),
        "rate-limited" => "Telegram is rate limiting us.".to_string(),
        _ => envelope
            .description
            .unwrap_or_else(|| "Telegram refused the request.".into()),
    };
    if let Some(seconds) = retry {
        message.push_str(&format!(" Retry after {seconds}s."));
    }
    Err(TelegramError::new(kind, message))
}

async fn get_me(token: &str) -> Result<BotIdentity, TelegramError> {
    call(token, "getMe", serde_json::json!({})).await
}

async fn send_message(token: &str, chat_id: &str, text: &str) -> Result<(), TelegramError> {
    let _: serde_json::Value = call(
        token,
        "sendMessage",
        serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            // Plain text on purpose: Markdown would make a task title
            // containing an underscore a parse error the user cannot see.
            "disable_web_page_preview": true,
        }),
    )
    .await?;
    Ok(())
}

async fn get_updates(token: &str, offset: i64) -> Result<Vec<Update>, TelegramError> {
    call(
        token,
        "getUpdates",
        serde_json::json!({
            "offset": offset,
            "timeout": LONG_POLL_SECONDS,
            // Only what M14 handles. Telegram drops the rest server-side, so a
            // photo or a sticker never becomes an update we must skip.
            "allowed_updates": ["message"],
        }),
    )
    .await
}

// ------------------------------------------------------------- the worker

fn emit_status(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, status_of(app));
}

fn chat_name(chat: &Chat) -> Option<String> {
    chat.title
        .clone()
        .or_else(|| chat.username.clone())
        .or_else(|| chat.first_name.clone())
}

/// Turns one update into something to hand upward, or into a reason to drop it.
///
/// This is where authorization happens, and it happens before the renderer —
/// and therefore before the command layer — sees anything at all.
enum Disposition {
    Deliver(IncomingMessage),
    /// Answer the chat, but execute nothing.
    Reject { chat_id: String, text: String },
    Ignore,
}

fn classify(update: &Update, authorized: Option<&str>) -> Disposition {
    let Some(message) = &update.message else { return Disposition::Ignore };
    let Some(chat) = &message.chat else { return Disposition::Ignore };
    let Some(text) = message.text.as_ref().map(|t| t.trim().to_string()) else {
        return Disposition::Ignore;
    };
    if text.is_empty() {
        return Disposition::Ignore;
    }

    let chat_id = chat.id.to_string();

    match authorized {
        Some(allowed) if allowed == chat_id => Disposition::Deliver(IncomingMessage {
            source: "telegram",
            external_id: update.update_id.to_string(),
            chat_id,
            sender_id: message.from.as_ref().map(|user| user.id.to_string()),
            text,
            received_at: message.date.unwrap_or(0) * 1000,
        }),
        Some(_) => Disposition::Reject {
            chat_id,
            // Says nothing about who *is* authorized.
            text: "This chat is not authorized to control Vaultwork.".into(),
        },
        None => Disposition::Reject {
            chat_id,
            text: "Vaultwork is not authorized for this chat yet. Approve it in Vaultwork ▸ Settings ▸ Telegram.".into(),
        },
    }
}

/// Reads the token from the credential store. **Once per worker session.**
fn load_token(state: &TelegramState) -> Result<String, TelegramError> {
    let token = secrets::get(secrets::TELEGRAM_TOKEN)
        .map_err(|error| TelegramError::new("keychain", error.0))?
        .ok_or_else(TelegramError::not_configured)?;
    state.set_token(Some(token.clone()));
    Ok(token)
}

/// The token to spend on a one-off command, without starting a session.
///
/// Prefers the one a running worker already holds, so pressing "Test
/// connection" while polling costs no Keychain access at all.
fn token_for_command(state: &TelegramState) -> Result<String, TelegramError> {
    match state.token() {
        Some(token) => Ok(token),
        None => load_token(state),
    }
}

/// Establishes, once at launch, whether a token exists.
///
/// This is the only credential-store access that happens when Telegram is not
/// being used, and it is unavoidable: Settings has to be able to say
/// "Configured" or "Not configured" without guessing. The answer is cached, so
/// it costs exactly one access per application launch.
pub fn prime(app: &AppHandle) {
    let state = app.state::<Arc<TelegramState>>();
    state.set_configured(secrets::exists(secrets::TELEGRAM_TOKEN));
}

pub fn start_worker(app: AppHandle) {
    let state = app.state::<Arc<TelegramState>>().inner().clone();

    // The persisted cursor is loaded *here*, not at the call sites, because it
    // is the worker's own precondition. It used to live in `telegram_start`,
    // which meant the auto-start path began at offset 0 and asked Telegram to
    // resend everything it still held. The message log made that harmless, but
    // harmless is not the same as correct: a whole day of updates would be
    // replayed, answered with silence, and re-acknowledged on every launch.
    state
        .offset
        .store(store::telegram_offset(&app), Ordering::SeqCst);

    // A new generation retires any worker still running, so `start` twice
    // leaves exactly one loop alive rather than two racing for updates.
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.running.store(true, Ordering::SeqCst);
    state.set_error(None);

    tauri::async_runtime::spawn(async move {
        // One Keychain read for the whole session. Every request below reuses
        // this value; when the loop ends, the token is dropped.
        let token = match load_token(&state) {
            Ok(token) => token,
            Err(error) => {
                // A worker that cannot start must say why. The kind only —
                // never the message, and never the value it failed to read.
                eprintln!("[vaultwork] telegram worker could not start: {}", error.kind);
                state.set_error(Some(error.message.clone()));
                state.running.store(false, Ordering::SeqCst);
                emit_status(&app);
                return;
            }
        };

        let mut backoff = BACKOFF_START;

        loop {
            if state.generation.load(Ordering::SeqCst) != generation {
                state.clear_token();
                return;
            }
            if !state.running.load(Ordering::SeqCst) {
                state.clear_token();
                return;
            }

            let offset = state.offset.load(Ordering::SeqCst);
            match get_updates(&token, offset).await {
                Ok(updates) => {
                    backoff = BACKOFF_START;
                    state.set_error(None);

                    let delivered = updates.len();
                    let authorized = store::authorized_chat(&app);
                    for update in updates {
                        match classify(&update, authorized.as_deref()) {
                            Disposition::Deliver(message) => {
                                // The offset is NOT advanced here. The renderer
                                // acknowledges once the mutation and the
                                // message log are durable, and a crash before
                                // that simply means Telegram resends — which
                                // the message log makes harmless.
                                let _ = app.emit(UPDATE_EVENT, message);
                            }
                            Disposition::Reject { chat_id, text } => {
                                if authorized.is_none() {
                                    let name = update
                                        .message
                                        .as_ref()
                                        .and_then(|m| m.chat.as_ref())
                                        .and_then(chat_name);
                                    state.set_pending(Some(chat_id.clone()), name);
                                    emit_status(&app);
                                }
                                let _ = send_message(&token, &chat_id, &text).await;
                                // Nothing durable happened, so this update is
                                // finished: advance past it.
                                advance(&state, &app, update.update_id);
                            }
                            Disposition::Ignore => advance(&state, &app, update.update_id),
                        }
                    }

                    /*
                     * Never spin.
                     *
                     * `getUpdates` returns immediately whenever the cursor has
                     * not moved past what Telegram is holding — so if a batch
                     * was delivered and nothing acknowledged it (a wedged or
                     * not-yet-mounted renderer), the next poll returns the same
                     * batch instantly and the loop becomes a busy-loop against
                     * both Telegram and the credential store. Observed: 15,000
                     * iterations in half a minute. Pausing when the cursor did
                     * not move costs nothing in the healthy case, where the
                     * renderer acknowledges within milliseconds.
                     */
                    if delivered > 0 && state.offset.load(Ordering::SeqCst) == offset {
                        tokio::time::sleep(IDLE_PAUSE).await;
                    }
                }
                Err(error) => {
                    let fatal = error.kind == "invalid-token" || error.kind == "not-configured";
                    state.set_error(Some(error.message.clone()));
                    emit_status(&app);

                    if fatal {
                        // A bad token will not fix itself by being retried in a
                        // tight loop; stop and let Settings show why. The kind
                        // is logged — never the message, which could quote a
                        // chat, and never the token, which is not in it.
                        eprintln!("[vaultwork] telegram worker stopped: {}", error.kind);
                        state.running.store(false, Ordering::SeqCst);
                        state.clear_token();
                        emit_status(&app);
                        return;
                    }

                    // The kind and the delay only. Never the message (it can
                    // quote a chat) and never the token (it is not in either).
                    eprintln!(
                        "[vaultwork] telegram retrying after {}: {}s",
                        error.kind,
                        backoff.as_secs()
                    );
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(BACKOFF_MAX);
                }
            }
        }
    });
}

/// Moves the cursor past an update and persists it.
///
/// Telegram treats `offset = update_id + 1` as "I have finished with everything
/// up to here", so this is the only place the cursor moves forward.
fn advance(state: &TelegramState, app: &AppHandle, update_id: i64) {
    let next = update_id + 1;
    let current = state.offset.load(Ordering::SeqCst);
    if next > current {
        state.offset.store(next, Ordering::SeqCst);
        store::remember_telegram_offset(app, next);
    }
}

// -------------------------------------------------------------- commands

fn status_of(app: &AppHandle) -> TelegramStatus {
    let state = app.state::<Arc<TelegramState>>();

    // One lock, taken once, and released before anything slow happens.
    //
    // The cached fields are read through `snapshot()` rather than field by
    // field here, because the previous shape held the guard and *then* called
    // `is_configured()` — which locks `inner` again. A `std::sync::Mutex` does
    // not re-enter; it deadlocks. `telegram_status` is a synchronous command,
    // so the thread it deadlocked was the main thread, and the whole window
    // froze the moment Settings mounted and asked for a status.
    //
    // Releasing the guard before the `store::` reads below matters for a second
    // reason: those touch the filesystem, and the poll worker's `set_error`
    // should never wait on a JSON file being parsed.
    let inner = state.snapshot();

    TelegramStatus {
        // Cached, not read. `status` is called by Settings on mount, by every
        // status push, and by the message loop for each incoming message; a
        // credential-store access here was the single largest source of macOS
        // authorization prompts.
        configured: inner.configured,
        running: state.running.load(Ordering::SeqCst),
        bot_username: inner.bot_username,
        authorized_chat_id: store::authorized_chat(app),
        pending_chat_id: inner.pending_chat_id,
        pending_chat_name: inner.pending_chat_name,
        auto_start: store::telegram_auto_start(app),
        last_error: inner.last_error,
        keychain_reads: secrets::read_count(),
    }
}

#[tauri::command]
pub fn telegram_status(app: AppHandle) -> TelegramStatus {
    status_of(&app)
}

/// Saves a token and immediately proves it works.
///
/// The token goes to the Keychain and the identity comes back; the token itself
/// is never returned, so the renderer that supplied it cannot read it again.
#[tauri::command]
pub async fn telegram_configure(
    app: AppHandle,
    token: String,
) -> Result<BotIdentity, TelegramError> {
    let trimmed = token.trim().to_string();
    if trimmed.is_empty() {
        return Err(TelegramError::new("invalid-token", "The token is empty."));
    }

    secrets::set(secrets::TELEGRAM_TOKEN, &trimmed)
        .map_err(|error| TelegramError::new("keychain", error.0))?;

    // The caller just handed us the token, so it is verified with that value
    // rather than by reading back what was written — a write followed by a read
    // of the same secret is one authorization prompt too many.
    let state = app.state::<Arc<TelegramState>>();
    state.set_token(Some(trimmed.clone()));
    state.set_configured(true);

    match get_me(&trimmed).await {
        Ok(identity) => {
            let state = app.state::<Arc<TelegramState>>();
            if let Ok(mut inner) = state.inner.lock() {
                inner.bot_username = identity.username.clone();
                inner.last_error = None;
            }
            emit_status(&app);
            Ok(identity)
        }
        Err(error) => {
            // A token Telegram rejects is not worth keeping: leaving it in the
            // Keychain would make Settings claim "configured" forever.
            if error.kind == "invalid-token" {
                let _ = secrets::delete(secrets::TELEGRAM_TOKEN);
                state.set_configured(false);
            }
            emit_status(&app);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn telegram_test(app: AppHandle) -> Result<BotIdentity, TelegramError> {
    let state = app.state::<Arc<TelegramState>>();
    // Reuses the running worker's token when there is one; otherwise this is
    // the single read a one-off test is entitled to.
    let token = token_for_command(&state)?;
    let identity = get_me(&token).await?;
    if let Ok(mut inner) = state.inner.lock() {
        inner.bot_username = identity.username.clone();
    }
    emit_status(&app);
    Ok(identity)
}

#[tauri::command]
pub fn telegram_start(app: AppHandle) -> Result<TelegramStatus, TelegramError> {
    // The worker itself reads the token, and reports `not-configured` through
    // the status if there is none — so this does not pre-check by reading.
    let state = app.state::<Arc<TelegramState>>();
    if !state.is_configured() {
        return Err(TelegramError::not_configured());
    }
    start_worker(app.clone());
    let status = status_of(&app);
    let _ = app.emit(STATUS_EVENT, status.clone());
    Ok(status)
}

#[tauri::command]
pub fn telegram_stop(app: AppHandle) -> TelegramStatus {
    let state = app.state::<Arc<TelegramState>>();
    state.running.store(false, Ordering::SeqCst);
    // Stopping drops the token from memory. Starting again costs one read.
    state.clear_token();
    // Retires the in-flight worker: its generation is now stale, so it returns
    // after its current long poll rather than delivering one more batch.
    state.generation.fetch_add(1, Ordering::SeqCst);
    let status = status_of(&app);
    let _ = app.emit(STATUS_EVENT, status.clone());
    status
}

/// Approves the chat that is waiting. Explicit, and only ever for the pending
/// chat the user can see in Settings — never for an arbitrary id the renderer
/// invents.
#[tauri::command]
pub fn telegram_authorize(app: AppHandle, chat_id: String) -> Result<TelegramStatus, TelegramError> {
    let state = app.state::<Arc<TelegramState>>();
    let pending = state.inner.lock().ok().and_then(|inner| inner.pending_chat_id.clone());

    match pending {
        Some(waiting) if waiting == chat_id => {
            store::remember_authorized_chat(&app, Some(&chat_id));
            state.set_pending(None, None);
            let status = status_of(&app);
            let _ = app.emit(STATUS_EVENT, status.clone());
            Ok(status)
        }
        _ => Err(TelegramError::new(
            "no-pending-chat",
            "That chat is not waiting for approval.",
        )),
    }
}

#[tauri::command]
pub async fn telegram_send(
    app: AppHandle,
    chat_id: String,
    text: String,
) -> Result<(), TelegramError> {
    let state = app.state::<Arc<TelegramState>>();
    let token = token_for_command(&state)?;
    send_message(&token, &chat_id, &text).await
}

/// Confirms an update is durably handled, so the cursor may move past it.
#[tauri::command]
pub fn telegram_ack(app: AppHandle, update_id: String) -> Result<(), TelegramError> {
    let parsed: i64 = update_id
        .parse()
        .map_err(|_| TelegramError::new("protocol", "That is not an update id."))?;
    let state = app.state::<Arc<TelegramState>>();
    advance(&state, &app, parsed);
    Ok(())
}

#[tauri::command]
pub fn telegram_set_auto_start(app: AppHandle, enabled: bool) -> TelegramStatus {
    store::remember_telegram_auto_start(&app, enabled);
    let status = status_of(&app);
    let _ = app.emit(STATUS_EVENT, status.clone());
    status
}

/// Forgets the bot. Touches no application data whatsoever.
#[tauri::command]
pub fn telegram_disconnect(app: AppHandle) -> Result<TelegramStatus, TelegramError> {
    let state = app.state::<Arc<TelegramState>>();
    state.running.store(false, Ordering::SeqCst);
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.offset.store(0, Ordering::SeqCst);

    secrets::delete(secrets::TELEGRAM_TOKEN)
        .map_err(|error| TelegramError::new("keychain", error.0))?;
    state.set_configured(false);
    store::forget_telegram(&app);

    if let Ok(mut inner) = state.inner.lock() {
        inner.bot_username = None;
        inner.pending_chat_id = None;
        inner.pending_chat_name = None;
        inner.last_error = None;
    }

    let status = status_of(&app);
    let _ = app.emit(STATUS_EVENT, status.clone());
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(id: i64, chat: i64, text: &str) -> Update {
        Update {
            update_id: id,
            message: Some(Message {
                chat: Some(Chat { id: chat, first_name: None, username: None, title: None }),
                from: Some(User { id: chat }),
                text: Some(text.into()),
                date: Some(1_700_000_000),
            }),
        }
    }

    #[test]
    fn delivers_only_the_authorized_chat() {
        match classify(&update(1, 42, "/today"), Some("42")) {
            Disposition::Deliver(message) => {
                assert_eq!(message.external_id, "1");
                assert_eq!(message.chat_id, "42");
                assert_eq!(message.text, "/today");
                assert_eq!(message.source, "telegram");
            }
            _ => panic!("the authorized chat should be delivered"),
        }
    }

    #[test]
    fn refuses_another_chat_without_saying_who_is_allowed() {
        match classify(&update(2, 99, "/delete everything"), Some("42")) {
            Disposition::Reject { chat_id, text } => {
                assert_eq!(chat_id, "99");
                assert!(text.contains("not authorized"));
                assert!(!text.contains("42"));
            }
            _ => panic!("an unknown chat must never be delivered"),
        }
    }

    #[test]
    fn never_trusts_the_first_sender() {
        // No authorized chat yet: the message is answered, not obeyed.
        match classify(&update(3, 7, "/add take over"), None) {
            Disposition::Reject { text, .. } => assert!(text.contains("Settings")),
            _ => panic!("the first sender must not be trusted automatically"),
        }
    }

    #[test]
    fn ignores_updates_with_nothing_to_run() {
        let blank = Update { update_id: 4, message: None };
        assert!(matches!(classify(&blank, Some("42")), Disposition::Ignore));

        let mut empty = update(5, 42, "");
        empty.message.as_mut().unwrap().text = Some("   ".into());
        assert!(matches!(classify(&empty, Some("42")), Disposition::Ignore));

        let mut chatless = update(6, 42, "hi");
        chatless.message.as_mut().unwrap().chat = None;
        assert!(matches!(classify(&chatless, Some("42")), Disposition::Ignore));
    }

    #[test]
    fn carries_unicode_through_unharmed() {
        match classify(&update(7, 42, "/add café ☕ 日本語 — done"), Some("42")) {
            Disposition::Deliver(message) => assert_eq!(message.text, "/add café ☕ 日本語 — done"),
            _ => panic!("unicode should survive normalisation"),
        }
    }

    #[test]
    fn a_session_token_is_reused_rather_than_re_read() {
        // The invariant behind the fix: once a session holds a token, a command
        // spends that one rather than going back to the credential store. The
        // counter is the observable proof, and it must not move.
        let state = TelegramState::default();
        state.set_token(Some("session-token".into()));

        let before = secrets::read_count();
        for _ in 0..50 {
            let token = token_for_command(&state).expect("a session token is present");
            assert_eq!(token, "session-token");
        }
        assert_eq!(secrets::read_count(), before, "no credential-store access");
    }

    #[test]
    fn stopping_drops_the_token_from_memory() {
        let state = TelegramState::default();
        state.set_token(Some("session-token".into()));
        assert!(state.token().is_some());

        state.clear_token();
        assert!(state.token().is_none(), "a stopped worker holds no token");
    }

    #[test]
    fn configured_is_cached_so_status_reads_nothing() {
        let state = TelegramState::default();
        assert!(!state.is_configured());

        state.set_configured(true);
        let before = secrets::read_count();
        for _ in 0..50 {
            assert!(state.is_configured());
        }
        assert_eq!(secrets::read_count(), before);

        // Turning it off also forgets the token: "not configured" must not
        // leave a usable secret behind in memory.
        state.set_token(Some("x".into()));
        state.set_configured(false);
        assert!(state.token().is_none());
    }

    /// Runs `body` on a worker and fails if it has not finished in time.
    ///
    /// Every test that reads a status goes through this. A re-entrant lock does
    /// not panic — it blocks forever — so without a deadline a reintroduced
    /// deadlock would hang the whole suite with no output instead of failing
    /// one named test. That is exactly how this bug reached a release build.
    fn with_deadline(what: &str, body: impl FnOnce() + Send + 'static) {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            body();
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("{what} did not finish: it deadlocked"));
    }

    #[test]
    fn reading_a_status_never_deadlocks() {
        // The M14 regression, in one test.
        //
        // `status_of` used to take the `inner` guard and then call
        // `is_configured()`, which locks `inner` a second time. A
        // `std::sync::Mutex` does not re-enter — it blocks forever — and
        // because `telegram_status` is a synchronous Tauri command, the thread
        // it blocked was the main thread. Settings asked for a status on mount,
        // the main thread stopped, and the window never painted again.
        let state = Arc::new(TelegramState::default());
        state.set_configured(true);
        state.set_pending(Some("42".into()), Some("Ada".into()));
        state.set_error(Some("boom".into()));

        with_deadline("reading a status", move || {
            for _ in 0..1_000 {
                let snapshot = state.snapshot();
                assert!(snapshot.configured);
                assert_eq!(snapshot.pending_chat_id.as_deref(), Some("42"));
                assert_eq!(snapshot.pending_chat_name.as_deref(), Some("Ada"));
                assert_eq!(snapshot.last_error.as_deref(), Some("boom"));
            }
        });
    }

    #[test]
    fn a_status_snapshot_costs_no_credential_store_access() {
        // Settings calls this on mount and the worker pushes it on every
        // change. If it ever reached the Keychain again, macOS would prompt.
        with_deadline("snapshotting a status", || {
            let state = TelegramState::default();
            state.set_token(Some("session-token".into()));

            let before = secrets::read_count();
            for _ in 0..50 {
                assert!(state.snapshot().configured);
            }
            assert_eq!(secrets::read_count(), before, "no credential-store access");
        });
    }

    #[test]
    fn a_status_does_not_wait_on_the_polling_worker() {
        // A status is a pure read of cached state. Proven by taking every
        // *other* lock the worker takes, in a loop, from a second thread while
        // statuses are read — the reads must still complete.
        let state = Arc::new(TelegramState::default());
        state.set_configured(true);

        let churn = Arc::clone(&state);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let handle = std::thread::spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                churn.set_error(Some("transient".into()));
                churn.set_pending(Some("7".into()), None);
                let _ = churn.token();
                churn.set_error(None);
            }
        });

        with_deadline("reading a status while the worker churns", move || {
            for _ in 0..5_000 {
                assert!(state.snapshot().configured);
            }
        });

        stop.store(true, Ordering::SeqCst);
        handle.join().expect("the churn thread should finish");
    }

    #[test]
    fn only_known_secret_keys_are_reachable() {
        assert!(secrets::get("some.other.app").is_err());
        assert!(secrets::set("../../etc/passwd", "x").is_err());
    }
}
