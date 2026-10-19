# Developer setup

How to clone Vaultwork and run it from source. Nothing here needs an account,
an API key or a downloaded `.app`. Every command below was run on a fresh clone
(see [What was tested](#what-was-tested)).

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| macOS | Apple Silicon, tested on macOS 27 | the desktop app (Windows/Linux: see below) |
| Node.js | **22.18 or newer** (`.nvmrc` says 22) | everything |
| npm | 10 (ships with Node 22) | everything |
| Rust | stable, **1.77.2 or newer** | the desktop app and `npm run test:rust` |
| Xcode Command Line Tools | any current | compiling the desktop app |

Node 22.18 is the floor because the MCP server runs its TypeScript directly with
Node. The app itself may work on Node 20, but that is not tested.

Install whatever is missing:

```bash
xcode-select --install                 # Command Line Tools (skip if `xcode-select -p` prints a path)
nvm install && nvm use                 # reads .nvmrc; or install Node 22 any other way
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust via rustup
```

## Quick start

```bash
git clone https://github.com/Awaneesh03/vaultwork.git
cd vaultwork
npm ci
npm run dev          # browser: http://localhost:5173
npm run desktop      # or: the native desktop app (first run compiles Rust, ~1–2 min)
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app in your browser at `http://localhost:5173` |
| `npm run desktop` | Native desktop app in development mode, with hot reload |
| `npm run verify` | Formatting, lint, types and the full test suite (run before committing) |
| `npm test` | Tests only. One file: `npx vitest run tests/commandPipeline.test.ts` |
| `npm run test:rust` | Rust tests for the desktop layer |
| `npm run build` | Production web build into `dist/` |
| `npm run desktop:build` | `Vaultwork.app` and a `.dmg` in `src-tauri/target/release/bundle/` (unsigned) |
| `npm run icons` | Regenerate every app icon from `branding/vaultwork-icon.svg` |

Port 5173 must be free: the desktop window always opens that address, so the dev
server refuses to start on any other port rather than show you the wrong page.

## Your data while developing

A fresh clone starts with an empty database, filled with a few example tasks,
projects and habits. It never reads or changes anyone's real Vaultwork data:

- **`npm run dev`** stores data in your browser's IndexedDB for
  `http://localhost:5173`. It is separate from the desktop app's data.
- **`npm run desktop`** runs under its own identifier, `app.vaultwork.desktop.dev`
  (set in `src-tauri/tauri.dev.conf.json`). It has its own database, its own
  config folder (`~/Library/Application Support/app.vaultwork.desktop.dev/`) and
  its own Keychain entries. If you also have the Vaultwork app installed, the
  dev build can't see its vault, Telegram bot, API key or tasks.
- **`npm run desktop:build`** produces the real app, under the real identifier.
  Opening that build uses the same data as an installed Vaultwork.

To start the dev desktop app from scratch, quit it and delete
`~/Library/Application Support/app.vaultwork.desktop.dev/`.

## Integrations and credentials

None are needed to run, test or build Vaultwork. Each one stays unavailable until
you provide your own credentials, and nothing in this repository contains any.

| Integration | You provide | Where | Runtime |
| --- | --- | --- | --- |
| Obsidian | A vault folder | Obsidian ▸ Connect vault | Desktop; in the browser, Chromium-based browsers only |
| Telegram | A bot token from @BotFather | Settings ▸ Telegram, then the pairing code | Desktop only |
| Assistant (AI) | A Groq API key | Settings ▸ Assistant | Desktop only |
| Google Calendar & Gmail | Your own Google OAuth **desktop** client | Build time; see below | Desktop only |
| Claude Desktop (MCP) | Claude Desktop | See [mcp.md](mcp.md) | Desktop app writes the snapshot |

Tokens and keys you enter are stored in the macOS Keychain, never in the
repository, the database or a backup.

### Google: compiled in, not entered in the UI

Google needs an OAuth client (type **Desktop app**) from your own Google Cloud
project, with the Calendar API and Gmail API enabled. It is read when the Rust
code compiles:

```bash
cp src-tauri/google-oauth.local.example src-tauri/google-oauth.local
# put your client_id and client_secret in it (or paste the JSON Google gives you)
npm run desktop
```

`src-tauri/google-oauth.local` is git-ignored. As an alternative, set
`VAULTWORK_GOOGLE_CLIENT_ID` and `VAULTWORK_GOOGLE_CLIENT_SECRET` in the
environment before building. Without either, Settings ▸ Google says Google is
unavailable in this build, and everything else works.

## Browser mode

`npm run dev` is a complete, supported way to use and develop the app. These
features need the desktop runtime and say so in Settings when opened in a
browser:

- **Telegram, the Assistant and Google**: a browser tab cannot hold credentials
  or a long-running connection.
- **Launch at login** and the **Claude Desktop (MCP) snapshot**.
- **PDF text** in Documents.
- **Obsidian** works in a browser only where the File System Access API exists
  (Chrome, Edge, Arc), and the browser may ask you to pick the folder again
  after a reload.

Everything else is the same: tasks, projects, goals, habits, calendar, focus,
notes, analytics, search, backups and snapshots.

## Windows and Linux

Not tested. CI runs the web checks and the Rust tests on Ubuntu, after installing
`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
libsoup-3.0-dev libjavascriptcoregtk-4.1-dev`. No Linux or Windows desktop build
has been produced or run.

## What was tested

On a fresh clone, on macOS 27 (Apple Silicon), Node 22.23.3, npm 10.9.9 and
Rust 1.95.0:

- `nvm use` picked up `.nvmrc`.
- `npm ci`, `npm run verify` (147 test files, 3112 tests), `npm run build`, and
  `npm run test:rust` (109 tests, compiled from scratch in about a minute).
- `npm run desktop`. It compiled in about a minute and opened on example data in
  `app.vaultwork.desktop.dev`; the installed app's files were unchanged.
- `npm run dev` in a browser, with the desktop-only sections labelled.
- `npm run desktop:build` from scratch in about two minutes. `npm run icons`.

Not tested: installing Xcode Command Line Tools or Rust from nothing (both were
already present), Node 20, Intel Macs, Windows, Linux, and Google, Telegram or
the Assistant with real credentials.
