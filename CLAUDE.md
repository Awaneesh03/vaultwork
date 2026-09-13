# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Vaultwork is a local-first personal productivity system (tasks, projects, goals, habits, notes). No backend, no auth — everything lives in IndexedDB (browser) with a Tauri desktop app for native features. React + TypeScript frontend, Rust backend (Tauri).

## Commands

```bash
npm run dev          # Vite dev server at localhost:5173
npm run build        # tsc + vite build
npm run verify       # lint + typecheck + tests (run before committing)
npm run lint         # ESLint
npm run typecheck    # tsc -b
npm test             # vitest (TZ=Asia/Kolkata)
npm run test:watch   # vitest in watch mode
npm run desktop      # tauri dev (launches native app)
npm run desktop:build
npm run test:rust    # cargo test for src-tauri
```

Tests run with `TZ=Asia/Kolkata` to catch UTC-based date bugs. Tests use `fake-indexeddb`, not mocks — real IndexedDB semantics are under test.

To run a single test file: `npx vitest run tests/commandPipeline.test.ts`

## Architecture — layered with enforced boundaries

The `@` alias maps to `src/`. Path: `vite.config.ts` and `tsconfig.app.json`.

### Layer stack (dependency flows downward only)

```
src/app/           → shell, router, global shortcuts
src/features/      → vertical slices per section (tasks, projects, goals, etc.)
src/components/    → design system (ui/, layout/, feedback/) — no domain logic
src/store/         → Zustand — ephemeral UI state only
  ↓
src/hooks/         → glue layer; only place dexie-react-hooks is allowed
  ↓
src/services/      → business logic — no React, no Dexie, no Telegram (except telegramService.ts)
src/ai/            → AI layer — stricter than services: no repos, no Dexie, data only via services/commands
  ↓
src/repositories/  → only layer that touches Dexie
  ↓
src/db/            → schema, migrations, seed — depends on nothing above
```

Leaf modules (`src/lib/`, `src/types/`) may not import from any layer above.
`src/platform/` — ports + adapters (clock, files, notifications). No React.
`src/integrations/` — pure transforms (Obsidian, Telegram). No I/O, no persistence.

**These boundaries are enforced by both ESLint (`eslint.config.js`) and `tests/architecture.test.ts`.** A component cannot import `db/`, `repositories/`, or `dexie`. A service cannot import React or Telegram. The AI layer can only reach data through services and the command layer.

### The command layer

Every mutation flows through one path:

```
producer → commandRouter.parseCommand() → CommandIntent
         → commandExecutor.execute()    → service → repository → Dexie
         → CommandResult (ok | ambiguous | not_found | error)
```

Producers (UI, Quick Add, command palette, Telegram, AI) all emit `CommandIntent` — they add a transport, not a second implementation. `tests/commandPipeline.test.ts` drives commands all the way to IndexedDB with no React.

### Test conventions

- Tests live in `tests/` (integration) and colocated as `*.test.ts` in `src/` (unit)
- `*.dom.test.{ts,tsx}` files get jsdom environment; everything else runs in node
- `tests/setup.ts` provides fake-indexeddb and cleanup
- `tests/factories.ts` has test data builders
- `tests/architecture.test.ts` is the architectural boundary enforcer

### TypeScript strictness

`tsconfig.app.json` enables maximum strictness: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, among others. Do not weaken these.

### Tauri (src-tauri/)

Rust desktop backend. The library crate (`vaultwork_lib`) is what both the binary and integration tests link against. Bot token stored in OS keychain via `keyring`. Uses `rustls-tls` (no OpenSSL dependency). `panic = "abort"` is deliberately removed from release profile to allow `catch_unwind` for PDF extraction recovery.

### Quick Add syntax

```
Study Java tomorrow at 7pm #college #java !high @DSA ~45m // description
```

Tokens: date words, time, `#tag`, `@project`, `!priority`, `~estimate`, `// description`. Unrecognized tokens stay in the title.
