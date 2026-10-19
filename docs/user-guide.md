# Using Vaultwork

Vaultwork is a personal workspace for tasks, projects, goals, habits, notes and
focus sessions. It runs on your computer. There is no Vaultwork account and no
Vaultwork server, so nothing you write is uploaded anywhere unless you connect
an integration that you choose.

## Installing

The macOS desktop app is built with `npm run desktop:build`. The result is
`Vaultwork.app` and a `.dmg` under `src-tauri/target/release/bundle/`.

The build is **not code-signed or notarized** yet. The first time you open it,
macOS will warn that it is from an unidentified developer. Right-click the app,
choose **Open**, then confirm. After that it opens normally.

A Windows or Linux build has not been produced or tested.

## Where your data lives

| What | Where |
| --- | --- |
| Tasks, projects, goals, habits, notes, focus logs | The app's local database (IndexedDB inside the app's web view, under `~/Library/WebKit/app.vaultwork.desktop/`) |
| Which Obsidian folder is connected, the paired Telegram chat, AI and Google preferences | `desktop-state.json` in `~/Library/Application Support/app.vaultwork.desktop/` |
| Telegram bot token, AI API key, Google sign-in | The macOS **Keychain**, under `app.vaultwork.desktop`. These are never shown again after you save them, and never go into a backup file. |

Nothing is synced to a cloud. Vaultwork adds no encryption of its own beyond
what macOS already provides for your disk and Keychain.

## Backing up and restoring

Open **Settings ▸ Storage**.

- **Export JSON** downloads a complete backup file. This is the only backup
  that survives deleting the app or its data. Keep a copy somewhere safe.
- **Take snapshot** saves a copy inside the app. The newest 7 are kept.
  Snapshots protect you from a bad import or restore, not from losing the
  computer.
- **Import JSON** *replaces* everything with the file's contents. It does not
  merge. Vaultwork takes a snapshot first, and if that snapshot cannot be
  saved, nothing is replaced.
- **Restore** on a snapshot also replaces everything. It asks first, and it
  takes a `pre-restore` snapshot, so a restore can itself be undone.

Deleting a task, project, goal, habit or note can be undone from the toast
that appears, or with ⌘Z.

## Working offline

Everything except the integrations works with no network: capturing, editing,
planning, focus sessions, notes, search and backups. The Assistant, Telegram
and Google need a connection. When the connection drops, they report an error
in Settings and nothing else is affected.

## Integrations

All of them are optional and off until you set them up. Each one can be
disconnected from Settings. Disconnecting removes its credential from the
Keychain and does not delete any of your tasks or notes.

### Obsidian

**Obsidian ▸ Connect vault**, then choose your vault folder. Vaultwork can only
read and write inside that folder.

- **Sync** compares notes with the files. A conflict is shown side by side so
  you can choose which version to keep.
- **Disconnect** asks first. Your notes and the vault's files are untouched,
  but Vaultwork forgets which note matches which file. The next sync after
  reconnecting compares everything afresh.
- A symbolic link inside the vault that points outside it is followed, as
  Obsidian itself does. Don't connect a folder whose contents you don't trust.

### Telegram

This lets you capture and check tasks from your phone.

1. Create a bot with **@BotFather** in Telegram and copy its token.
2. **Settings ▸ Telegram**: paste the token and press **Configure**.
3. Settings shows a **pairing code**. Send that code to your bot in a
   **private** chat.
4. Your chat appears in Settings with its name and numeric chat id. Check that
   it's yours, then press **Authorize this chat**.

Only that one chat can control Vaultwork. Messages from any other chat are
refused. A chat can't ask for access without the code on your screen, and
groups can never be paired. Send `/help` to the bot to see the commands
(`/add`, `/today`, `/done`, `/delete`, `/ask` and more). Deleting asks for
confirmation.

### Assistant (AI)

**Settings ▸ Assistant**: add a Groq API key. The Assistant is off by default.

- When you ask something, the app sends your question and the relevant
  workspace context to Groq. Nothing is sent until you ask.
- The Assistant can only propose three kinds of change: add a task, complete a
  task, reschedule a task. **Every proposal needs your confirmation**, and it
  expires after five minutes. It cannot delete anything.

### Google Calendar and Gmail (read-only)

Brings your calendar events and a few email signals (headers only, never
message bodies) into Vaultwork's planning views. Vaultwork asks Google only
for read-only access: `calendar.events.owned.readonly` and `gmail.metadata`.
It can't create, change or send anything.

This needs a Google OAuth desktop client compiled into the build: put it in
`src-tauri/google-oauth.local`, which is git-ignored (see
`src-tauri/build.rs`). A build without one shows Google as unavailable.

### Claude Desktop (MCP)

See [mcp.md](mcp.md). The MCP server is read-only and runs on your machine.

## When something goes wrong

| Symptom | What to do |
| --- | --- |
| Obsidian shows **Reconnect** | The folder moved, was unmounted, or permission lapsed. Press Reconnect and choose it again. |
| Telegram says the token is invalid | Revoke and reissue it with @BotFather, then Configure again. |
| Google says **reconnect required** | Google revoked access or the sign-in expired. Disconnect and connect again. |
| An import or restore went wrong | Settings ▸ Storage ▸ Restore the `pre-import` or `pre-restore` snapshot. |
| A note edit failed to save after you left it | A red message says so. Reopen the note and check the last lines. |

## Removing your data

- **One integration:** Settings ▸ its section ▸ Disconnect.
- **Everything:** export a backup first if you want one. Then quit the app and
  delete `~/Library/Application Support/app.vaultwork.desktop/` and
  `~/Library/WebKit/app.vaultwork.desktop/`. Remove the `app.vaultwork.desktop`
  entries in **Keychain Access**.
