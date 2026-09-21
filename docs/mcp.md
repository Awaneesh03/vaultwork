# M18.1 — read-only MCP for Claude Desktop

Claude Desktop can read a bounded snapshot of your Vaultwork workspace. That is
the whole of M18.1.

**It is read-only.** There is no tool that creates, edits, completes or deletes
anything, and no code path from the MCP server back into Vaultwork's database.
Writing is a later phase; so are the daily briefing, scheduling, notifications
and Telegram delivery.

## Why a snapshot, and not a connection

Vaultwork keeps everything in IndexedDB *inside the WebView*. A process that
Claude Desktop launches cannot open that database — not through Rust, not
through the filesystem, not without shipping a second implementation of the
whole data layer.

So the half of the application that can read the data publishes it:

```
WebView (services → repositories → Dexie)
   → buildMcpSnapshot()         bounded projection, hand-written DTOs
   → mcp_snapshot_write         one Tauri command, Rust owns the path
   → ~/Library/Application Support/app.vaultwork.desktop/mcp-snapshot.json   (0600)
   → vaultwork-mcp (stdio)      reads, validates, bounds
   → Claude Desktop
```

No socket, no port, no token, no HTTP. The file — owner-readable only — is the
entire interface, which is also why Claude can still answer from the last
snapshot when Vaultwork is closed.

## Snapshot location and schema

`~/Library/Application Support/app.vaultwork.desktop/mcp-snapshot.json` on macOS
(the same directory Tauri gives `desktop-state.json`; Windows and Linux resolve
through the same platform helper). Mode `0600`, rewritten in place.

**A development build writes `mcp-snapshot.dev.json` instead.** The two builds
share a config directory but not a database — `npm run desktop` stores its
IndexedDB under the binary name, the packaged app under the bundle identifier —
so a single shared file meant that starting the dev build replaced your real day
with seeded fixtures, and the MCP server then answered from those. The build
itself picks the filename; nothing about the security model changes, because the
renderer still names no path.

To point the MCP server at the dev snapshot while developing:

```bash
VAULTWORK_MCP_SNAPSHOT=~/Library/Application\ Support/app.vaultwork.desktop/mcp-snapshot.dev.json \
  node mcp/src/server.ts
```

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-20T09:00:00.000Z",   // ISO 8601
  "today": {
    "date": "2026-09-20",
    "dueTodayCount": 4,
    "overdueCount": 2,
    "habits": { "scheduled": 3, "completed": 1, "remaining": 2, "percent": 33,
                "items": [{ "name": "Read", "completed": false }] },
    "focus": { "active": null, "completedToday": 2, "minutesToday": 50 }
  },
  "tasks": {                                   // Vaultwork's own views, each capped at 40
    "today": [{ "id": "…", "title": "Study trees", "status": "todo", "priority": "high",
                "dueDate": "2026-09-20", "dueTime": "19:00", "estimateMin": 45,
                "projectId": "…", "projectName": "DSA Mastery", "tags": ["java"] }],
    "overdue": [], "upcoming": [], "active": []
  },
  "projects": [{ "id": "…", "name": "DSA Mastery", "status": "active", "deadline": null,
                 "total": 12, "completed": 5, "remaining": 7, "overdue": 1,
                 "dueToday": 2, "progress": 41, "nextDueDate": "2026-09-21" }]
}
```

Limits come from `AI_CONTEXT_LIMITS` — the same numbers that bound what the
in-app assistant may see: 40 tasks per view, 20 projects, 20 habits, 8 tags per
task, 10 focus sessions.

## The three tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `vaultwork_get_today` | none | today's date, due-today and overdue counts, up to 40 tasks due today, up to 40 overdue tasks, habit progress, focus time |
| `vaultwork_get_tasks` | `filter`: `today` \| `overdue` \| `upcoming` \| `active` (default `today`), `limit` (optional) | tasks from that one view, default 20, hard maximum 40 |
| `vaultwork_get_projects` | `limit` (optional), `includeArchived` (default `false`) | projects with counts and progress, default 10, hard maximum 20 |

Every result carries `freshness`: `generatedAt`, `ageSeconds`, and `stale`
(true past 15 minutes), plus a sentence telling Claude the data may not be
current. Stale data is labelled, never passed off as live.

## Freshness

The snapshot is rewritten:

1. at start-up, once the database has opened (`useBootstrap`), and
2. after any mutation — every write already announces itself on the existing
   event bus — debounced by 3 seconds, so a burst of edits costs one write.

Only the desktop build writes it. A browser tab has nowhere to put it and skips
the work.

## What the MCP server cannot reach

- Dexie, IndexedDB, or any Vaultwork repository or service.
- Any file other than the snapshot. No tool takes a path, a filename or a URL.
- The network. No port is opened, no HTTP transport is imported, nothing is fetched.
- Secrets of any kind. The Telegram token and the AI provider key live in the OS
  keychain, and the snapshot has no field that could carry one.
- Note bodies, documents, vault paths, or task descriptions. They are not projected.
- Anything at all in the write direction: no mutation tool exists.

Unknown fields are stripped during validation, so even a future snapshot that
carried something it should not would not reach a tool result.

## Local setup

The server needs no build step — Node runs the TypeScript directly, which
requires **Node 22.18+ or 23+** (this repo is developed on Node 26). Check with
`node -v`; on an older Node the server exits with a TypeScript syntax error.
Claude Desktop must also find that `node` — if it is only on your shell's PATH,
give the config an absolute path such as `/opt/homebrew/bin/node`.

1. Open Vaultwork once (the desktop app, `npm run desktop`) so the snapshot exists.
2. Copy `mcp/claude_desktop_config.example.json` into
   `~/Library/Application Support/Claude/claude_desktop_config.json`, merging with
   anything already there.
3. Replace `/ABSOLUTE/PATH/TO/vaultwork` with this repository's real path:

```json
{
  "mcpServers": {
    "vaultwork": {
      "command": "node",
      "args": ["/Users/you/path/to/vaultwork/mcp/src/server.ts"]
    }
  }
}
```

4. Restart Claude Desktop, and check that **vaultwork** appears with three tools.

No secrets go in that file, and the path is yours — which is why the repository
ships a template rather than a working config.

### Verifying by hand

```bash
# Is the snapshot there, and does it look like a snapshot rather than a database?
ls -l ~/Library/Application\ Support/app.vaultwork.desktop/mcp-snapshot.json   # -rw-------
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d['schemaVersion'], d['generatedAt'], list(d))" \
  ~/Library/Application\ Support/app.vaultwork.desktop/mcp-snapshot.json

# Does the server start and list its tools?
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | node mcp/src/server.ts
```

Then ask Claude: *"What do I have today?"*, *"What tasks do I have?"*,
*"What projects am I working on?"*

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| "No Vaultwork snapshot exists yet" | the file has never been written | open the Vaultwork **desktop** app once; a browser tab does not write it |
| "problem: malformed" | the file is truncated or not the expected shape | reopen Vaultwork; it rewrites on start-up |
| "problem: unsupported-version" | the app writes a newer schema than this server reads | update the MCP server from this repository |
| answers are out of date | Vaultwork is closed, or the write is still debounced | check `freshness.generatedAt` in the reply; wait ~3s after an edit |
| Claude's numbers disagree with the Dashboard | the snapshot was written by a *different* Vaultwork build than the one on screen — each build has its own IndexedDB | open the packaged app (the one your data lives in) and let it rewrite the snapshot; dev builds write `mcp-snapshot.dev.json` |
| the snapshot never updates | the installed app predates M18.1 | rebuild with `npm run desktop:build` and reinstall; an older binary has no snapshot command |
| server missing in Claude Desktop | config path or JSON | confirm the absolute path, valid JSON, and restart Claude Desktop |
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` or a syntax error at startup | the `node` Claude Desktop launched is too old | point `command` at an absolute Node 22.18+ binary |
| `Cannot find package '@modelcontextprotocol/sdk'` | dependencies are not installed | run `npm ci` in the repository |
