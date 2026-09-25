<div align="center">

# 🗄️ Vaultwork

**A local-first personal productivity system — tasks, projects, goals, habits, notes and focus — with an Obsidian vault as its home and an optional Claude Desktop (MCP) bridge.**

No backend. No account. No cloud database. Your data stays on your machine.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Tauri](https://img.shields.io/badge/Tauri-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![Dexie](https://img.shields.io/badge/Dexie_IndexedDB-1F6FEB?style=flat-square)
![Zustand](https://img.shields.io/badge/Zustand-443E38?style=flat-square)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Claude_Desktop-D97757?style=flat-square)

[Features](#-features) · [Run It](#-run-it) · [Architecture](#-architecture) · [Quick Add](#-quick-add-syntax)

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
| **Analytics & Dashboard** | See where your time and effort go |
| **Desktop app** | Native macOS/Windows/Linux build with **Tauri** (Rust) and system notifications |
| **Claude Desktop (MCP)** | A read-only MCP server so Claude can answer questions about your workspace — see [`docs/mcp.md`](docs/mcp.md) |

### Engineering highlights

- **Strict layered architecture** — dependency direction enforced by ESLint *and* by tests
- **One command pipeline** for every task mutation (UI, Quick Add, palette — and later Telegram / AI)
- **Tested** with Vitest (unit + pipeline + migration tests) and Rust tests for the desktop layer
- **Versioned IndexedDB schema** with migrations and seed data

## 🚀 Run It

```bash
git clone https://github.com/Awaneesh03/vaultwork.git
cd vaultwork
npm install
npm run dev        # web app → http://localhost:5173
npm run desktop    # desktop app (Tauri — needs Rust)
```

## ✅ Check It

```bash
npm run verify     # lint + typecheck + tests
npm run lint
npm run typecheck
npm test
npm run build
```

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

The producers today are the web UI, Quick Add and the command palette. Telegram
(M14) and the model (M15) join as producers of the same `CommandIntent` type —
they add a transport, not a second implementation. Which is why
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

## 👤 Author

**Awaneesh Gupta** — B.Tech CSE (AI) @ Vedam School of Technology

[![GitHub](https://img.shields.io/badge/GitHub-Awaneesh03-181717?style=flat-square&logo=github)](https://github.com/Awaneesh03)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-awaneesh--gupta-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/awaneesh-gupta)

<p align="center"><sub>If you found this project useful, consider giving it a ⭐</sub></p>
