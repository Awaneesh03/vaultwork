<div align="center">

<img src="branding/vaultwork-icon.svg" alt="Vaultwork" width="96" height="96" />

# Vaultwork

**A local-first personal productivity system — tasks, projects, goals, habits, notes and focus — with optional Obsidian sync and a read-only Claude Desktop (MCP) bridge.**

For students and individuals who want one calm place to plan their day, without
handing their data to a cloud service. No backend. No account. No cloud database.
Your data stays on your machine.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Tauri](https://img.shields.io/badge/Tauri-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![Dexie](https://img.shields.io/badge/Dexie_IndexedDB-1F6FEB?style=flat-square)
![Zustand](https://img.shields.io/badge/Zustand-443E38?style=flat-square)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Claude_Desktop-D97757?style=flat-square)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Features](#-features) · [Quick Start](#-quick-start) · [Platforms](#-platforms) · [User guide](docs/user-guide.md) · [Architecture](#-architecture) · [Quick Add](#-quick-add-syntax)

</div>

---

## ✨ Features

| Area | What you get |
|---|---|
| **Today · Upcoming · Inbox** | A daily plan, what's coming next, and a capture inbox |
| **Tasks** | Natural-language Quick Add, tags, priorities, estimates and a command palette |
| **Projects & Goals** | Group work into projects and tie them to longer-term goals |
| **Habits** | Daily habits with streaks |
| **Notes & Documents** | Markdown notes with frontmatter, linked to an **Obsidian** vault (with conflict detection) |
| **Calendar & Focus** | Calendar view, focus sessions, and read-only **Google Calendar & Gmail** integration (desktop) |
| **Time-aware dashboard** | The day at a glance under a hero that follows your clock — morning, afternoon, evening and night scenes, with an evening wrap-up layout |
| **Analytics** | See where your time and effort go |
| **Desktop app** | Native macOS app with **Tauri** (Rust) and system notifications. Windows and Linux are not yet built or tested. |
| **Telegram & Assistant** | Optional: capture and check tasks from a paired Telegram chat; an AI assistant whose every proposed change needs your confirmation |
| **Claude Desktop (MCP)** | A read-only MCP server so Claude can answer questions about your workspace — see [`docs/mcp.md`](docs/mcp.md) |

### Tech stack

| Layer | Technology |
|---|---|
| Interface | React 18, TypeScript 5, Vite 6, Tailwind CSS 4, React Router 7, Zustand 5, Lucide icons |
| Data | IndexedDB through Dexie 4 — versioned schema with migrations |
| Desktop | Tauri 2 (Rust) — native folder access, notifications, macOS Keychain |
| Tests | Vitest 2 + Testing Library + fake-indexeddb; `cargo test` for the Rust layer |
| Claude Desktop | Model Context Protocol SDK (stdio, read-only) |

### Engineering highlights

- **Strict layered architecture** — dependency direction enforced by ESLint *and* by tests
- **One command pipeline** for every task mutation (UI, Quick Add, palette, Telegram and the Assistant)
- **Tested** with Vitest (unit + pipeline + migration tests) and Rust tests for the desktop layer
- **Versioned IndexedDB schema** with migrations and seed data

## 🚀 Quick Start

You need **Node.js 22.18+**, and for the desktop app **Rust** (stable) and the
**Xcode Command Line Tools**. No account, API key or downloaded app is required.

```bash
git clone https://github.com/Awaneesh03/vaultwork.git
cd vaultwork
npm ci
npm run dev          # in your browser → http://localhost:5173
npm run desktop      # or the native macOS app (first run compiles Rust, ~1–2 min)
```

A fresh clone opens on a few example tasks, in its own database: the dev desktop
app runs as `app.vaultwork.desktop.dev`, so it never touches an installed
Vaultwork's data, vault or credentials. Integrations (Telegram, the Assistant,
Google) stay off until you add your own credentials, and the browser version
labels the features that need the desktop app.

- **Setting up from source, browser vs desktop, credentials:** [docs/developer-setup.md](docs/developer-setup.md)
- **Using the app, data, backups, integrations:** [docs/user-guide.md](docs/user-guide.md)

## ✅ Check It

```bash
npm run verify         # format + lint + typecheck + tests
npm run test:rust      # desktop (Rust) tests
npm run build          # production web build
npm run desktop:build  # Vaultwork.app + .dmg (unsigned)
npm run icons          # regenerate app icons from branding/vaultwork-icon.svg
```

CI runs the web checks and the Rust tests on pushes to `main` and on every pull request.

## 💻 Platforms

| Platform | Status |
|---|---|
| macOS (Apple Silicon) — desktop app | Tested: developed, built and run here |
| Browser — `npm run dev` | Tested in Chrome; Obsidian sync needs a Chromium-based browser |
| Windows, Linux — desktop app | Not built or tested. CI runs the test suite on Ubuntu, but no Linux or Windows app has been produced |

## 🔒 Your Data

- Everything lives on your machine, in the app's local IndexedDB database. There is no server and no sync service.
- Credentials you add (Telegram bot token, AI key, Google sign-in) go to the macOS Keychain — never into the database, a backup file or this repository.
- Back up from **Settings ▸ Storage ▸ Export JSON**; imports and restores take a safety snapshot first.

Integrations are optional and off until you supply your own credentials:

| Integration | Needs |
|---|---|
| Obsidian | A vault folder you choose |
| Telegram | Your own bot token from @BotFather, then a pairing code |
| Assistant (AI) | Your own Groq API key; every proposed change needs your confirmation |
| Google Calendar & Gmail | Your own Google OAuth desktop client, compiled into the build — read-only scopes |

Details: [docs/user-guide.md](docs/user-guide.md) and [docs/developer-setup.md](docs/developer-setup.md).

## ⚠️ Current Limitations

- The macOS app is **not code-signed or notarized**; macOS warns on first open (right-click ▸ Open).
- Windows and Linux desktop builds are untested.
- Telegram, the Assistant and Google do nothing until you configure your own credentials; Google additionally needs a rebuild.
- Data is local to one machine — there is no multi-device sync.

## 🏗 Architecture

```
src/app/           shell, router, global shortcuts
src/features/      vertical slices — one folder per section
src/components/    design system (ui/, layout/, feedback/) — nothing domain-aware
src/services/      business logic — no React, no Dexie
src/repositories/  the only layer that touches Dexie
src/db/            schema, migrations, seed
src/platform/      ports + adapters (clock, files, notifications, messages, AI)
src/integrations/  pure transforms (Obsidian M12, Telegram M14)
src/store/         Zustand — ephemeral UI state only
src/lib/           leaf utilities: ids, dates, hashing, errors
src/types/         entities, enums, backup format
```

The dependency direction is enforced by ESLint *and* by `tests/architecture.test.ts`:

```
components → hooks → services → repositories → Dexie → IndexedDB
```

A component may not import `db/`, `repositories/` or `dexie`. A service may not
import React, UI, Dexie, or anything under `integrations/telegram/`.

## ⚙️ The Command Layer

Every task mutation goes through one path, and only one:

```
producer text  →  commandRouter.parseCommand()  →  CommandIntent
               →  commandExecutor.execute()     →  taskService
               →  taskRepository               →  Dexie
               →  CommandResult (ok | ambiguous | not_found | error)
```

The producers are the web UI, Quick Add, the command palette, Telegram and the
Assistant. All of them emit the same `CommandIntent` type; each adds a
transport, not a second implementation. Which is why
`tests/commandPipeline.test.ts` drives `/add`, `/done` and `/delete` all the way
to IndexedDB with no React involved at all.

`src/features/tasks/` knows nothing about Telegram, and
`tests/architecture.test.ts` fails if that ever stops being true.

## ⚡ Quick Add Syntax

```
Study Java tomorrow at 7pm #college #java !high @DSA ~45m
```

| Token | Means |
| --- | --- |
| `today` `tomorrow` `mon`…`sun` `next week` `12 sep` `12/09` `in 3 days` | due date |
| `7pm` `19:00` `7.30pm` `noon` | due time |
| `#tag` | tag (created if new) |
| `@project` | project (matched, never invented) |
| `!none` `!low` `!med` `!high` `!urgent` | priority |
| `~30m` `~45m` `~2h` | estimate |
| `// text` | description |

Anything the parser does not recognise **stays in the title** and is reported
rather than silently dropped.

---

## 🐛 Bugs & Contributions

Found a bug or have an idea? [Open an issue](https://github.com/Awaneesh03/vaultwork/issues).
Pull requests are welcome — please run `npm run verify` (and `npm run test:rust`
if you touch `src-tauri/`) before opening one; CI runs the same checks.

## 📄 License

[MIT](LICENSE) © 2026 Awaneesh Gupta.

Third-party dependencies keep their own licenses — overwhelmingly MIT and
Apache-2.0, plus a few MPL-2.0 Rust crates pulled in by Tauri.

## 👤 Author

**Awaneesh Gupta** — B.Tech CSE (AI) @ Vedam School of Technology

[![GitHub](https://img.shields.io/badge/GitHub-Awaneesh03-181717?style=flat-square&logo=github)](https://github.com/Awaneesh03)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-awaneesh--gupta-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/awaneesh-gupta)

<p align="center"><sub>If you found this project useful, consider giving it a ⭐</sub></p>
