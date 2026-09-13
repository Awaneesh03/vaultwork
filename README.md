# Vaultwork

A local-first personal productivity system. No backend, no auth, no cloud
database — everything lives in this browser's IndexedDB, and later in a Tauri
desktop app talking to an Obsidian vault.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

## Check it

```bash
npm run verify     # lint + typecheck + tests
npm run lint
npm run typecheck
npm test
npm run build
```

## Where things live

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

## Status

Milestones 1–3 are complete: project setup, the data layer, and the task system
with its command layer. Milestone 4 (projects and goals) is next.

## The command layer

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

## Quick Add syntax

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
