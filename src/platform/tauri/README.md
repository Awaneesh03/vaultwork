# platform/tauri

The desktop adapters. Landed in M13.

```
bridge.ts               the only file in Vaultwork that imports @tauri-apps/*
tauriVault.ts           VaultPort, backed by the native filesystem
tauriNotifications.ts   NotificationPort, backed by the OS notification centre
tauriMenu.ts            MenuPort, fed by the native menu bar
fakeBridge.ts           a stand-in for the native side, for tests
```

The shape is deliberate: **the adapters take a `TauriBridge` object rather than
importing `invoke` themselves.** That is what lets `tauriVault.ts` — where all
the logic lives — be unit-tested in Node against `fakeBridge`, while the part
that cannot be tested without a running desktop app is confined to `bridge.ts`,
which is a list of `invoke` calls with no logic in it at all.

`platform/index.ts` grew one branch in `resolvePlatform()`. No component, hook,
service, repository or schema changed to add the desktop runtime.

## Still to come

- `telegramPort.ts` — the long-poll `MessagePort` (M14); bot token in the OS
  keychain, single-chat allowlist, poll cursor advanced only after commit
- `claudeAi.ts` — the `AiPort` implementation (M15), API key never in the bundle
- a vault file watcher, so `capabilities.watchVault` can stop reporting `false`

## The Rust side

`src-tauri/` holds the shell and nothing else — no database, no note model, no
sync algorithm. Its filesystem commands are scoped to the one folder the user
picked, and `src-tauri/src/paths.rs` re-checks every path the renderer sends.
