//! The OS credential store.
//!
//! One rule governs this file: **a secret written here is never read back out
//! to the renderer.** `secret_set` returns nothing, there is no `secret_get`
//! command, and the only code that reads a value is Rust that immediately
//! spends it on an outbound request. The web layer can ask *whether* a secret
//! exists and can delete it; it can never learn what it is.
//!
//! That is the difference between "the token is in the Keychain" and "the token
//! is safe". A `secret_get` command would hand the token to any JavaScript
//! running in the WebView, which would make the Keychain an expensive way to
//! store a value in `localStorage`.
//!
//! Keys are an allowlist, not free text, so a compromised renderer cannot walk
//! the user's Keychain looking for other applications' credentials.

use std::sync::atomic::{AtomicU64, Ordering};

use keyring::Entry;

/// How many times this process has read a secret from the OS credential store.
///
/// A diagnostic, not a security control. Each read is a potential macOS
/// authorization prompt, so the number is the difference between "the Keychain
/// is consulted once when the worker starts" and "the Keychain is consulted on
/// every network request". It counts *reads only*, never values.
static READS: AtomicU64 = AtomicU64::new(0);

pub fn read_count() -> u64 {
    READS.load(Ordering::SeqCst)
}

const SERVICE: &str = "app.vaultwork.desktop";

/// Every secret this application is allowed to hold.
const KNOWN_KEYS: &[&str] = &["telegram.botToken", "ai.groq.apiKey"];

#[derive(Debug)]
pub struct SecretError(pub String);

impl SecretError {
    fn unknown(key: &str) -> Self {
        // Deliberately does not echo the key back into a message that might be
        // logged; the caller knows what it asked for.
        Self(format!("“{key}” is not a secret this application stores."))
    }
}

fn entry(key: &str) -> Result<Entry, SecretError> {
    if !KNOWN_KEYS.contains(&key) {
        return Err(SecretError::unknown(key));
    }
    Entry::new(SERVICE, key).map_err(|error| SecretError(format!("keychain unavailable: {error}")))
}

pub fn set(key: &str, value: &str) -> Result<(), SecretError> {
    entry(key)?
        .set_password(value)
        .map_err(|error| SecretError(format!("could not save to the keychain: {error}")))
}

/// Reads a secret. **Rust-internal only** — never exposed as a command.
pub fn get(key: &str) -> Result<Option<String>, SecretError> {
    READS.fetch_add(1, Ordering::SeqCst);
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(SecretError(format!("could not read the keychain: {error}"))),
    }
}

pub fn delete(key: &str) -> Result<(), SecretError> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting something that is not there is the state the caller wanted.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(SecretError(format!("could not clear the keychain: {error}"))),
    }
}

pub fn exists(key: &str) -> bool {
    matches!(get(key), Ok(Some(_)))
}

pub const TELEGRAM_TOKEN: &str = "telegram.botToken";
/// The AI provider credential. Namespaced by provider so a second provider is a
/// second allowlist entry rather than a shared slot two features fight over.
pub const AI_GROQ_KEY: &str = "ai.groq.apiKey";
