import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASK_ROUTES } from '@/app/navigation'
import { STORE_NAMES } from '@/db'
import { STORE_NAMES_FOR_BACKUP, TASK_VIEW_IDS, TASK_VIEW_PATHS } from '@/services'
import { MENU_ACTIONS } from '@/platform'

/**
 * The architecture is only real if it is checked by a machine.
 *
 * ESLint enforces the same boundaries while you edit, but this test is what
 * runs in CI, states the rule in one readable place, and catches a boundary
 * crossed through a relative path that a glob-based lint rule might miss.
 */

const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'src')

interface ImportRef {
  file: string
  spec: string
  resolved: string
  typeOnly: boolean
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

const IMPORT_RE =
  /^\s*import\s+(type\s+)?[^'"]*from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm

function collectImports(): ImportRef[] {
  const refs: ImportRef[] = []
  for (const file of walk(SRC)) {
    const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[2] ?? match[3]
      if (!spec) continue
      const typeOnly = Boolean(match[1])
      const resolved = spec.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(rel), spec))
        : spec.replace(/^@\//, 'src/')
      refs.push({ file: rel, spec, resolved, typeOnly })
    }
  }
  return refs
}

const IMPORTS = collectImports()

const inLayer = (file: string, ...prefixes: string[]) =>
  prefixes.some((prefix) => file.startsWith(prefix))

const isHookFile = (file: string) => file.includes('/hooks/')

const targets = (ref: ImportRef, ...prefixes: string[]) =>
  prefixes.some((prefix) => ref.resolved === prefix || ref.resolved.startsWith(`${prefix}/`))

const PERSISTENCE_PACKAGES = ['dexie', 'dexie-react-hooks']
const REACT_PACKAGES = [
  'react',
  'react-dom',
  'react-router-dom',
  'zustand',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/modifiers',
  '@dnd-kit/utilities',
]

/**
 * Source with comments removed.
 *
 * Several rules below forbid a *name* appearing in a layer, and prose that
 * explains why a name is forbidden must not itself trip the rule — documenting
 * that `resolveChoice` rebuilds an ambiguous intent is the point of the comment.
 * Only code counts.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function violations(
  applies: (file: string) => boolean,
  forbidden: (ref: ImportRef) => boolean,
): string[] {
  return IMPORTS.filter((ref) => applies(ref.file) && forbidden(ref)).map(
    (ref) => `${ref.file} imports ${ref.spec}`,
  )
}

describe('layer boundaries', () => {
  it('keeps Dexie and repositories out of components and views', () => {
    const found = violations(
      (file) =>
        inLayer(file, 'src/components/', 'src/features/', 'src/app/', 'src/store/') &&
        !isHookFile(file),
      (ref) =>
        PERSISTENCE_PACKAGES.includes(ref.spec) || targets(ref, 'src/db', 'src/repositories'),
    )
    expect(found).toEqual([])
  })

  it('makes components go through hooks rather than calling services', () => {
    const found = violations(
      (file) =>
        inLayer(file, 'src/components/', 'src/features/', 'src/app/', 'src/store/') &&
        !isHookFile(file),
      (ref) => targets(ref, 'src/services') && !ref.typeOnly,
    )
    expect(found).toEqual([])
  })

  it('lets hooks reach services but never repositories or Dexie', () => {
    const found = violations(
      (file) => file.startsWith('src/') && isHookFile(file),
      (ref) => ref.spec === 'dexie' || targets(ref, 'src/db', 'src/repositories'),
    )
    expect(found).toEqual([])
  })

  it('keeps services free of React, UI and Dexie', () => {
    const found = violations(
      (file) => inLayer(file, 'src/services/', 'src/ai/'),
      (ref) =>
        REACT_PACKAGES.includes(ref.spec) ||
        PERSISTENCE_PACKAGES.includes(ref.spec) ||
        targets(
          ref,
          'src/components',
          'src/features',
          'src/app',
          'src/hooks',
          'src/store',
          'src/db',
        ),
    )
    expect(found).toEqual([])
  })

  /**
   * The one file allowed to know Telegram exists.
   *
   * M14 did not relax this rule; it named its single exception. `taskService`,
   * `noteService`, every repository and every query service must still be
   * unable to tell a chat message from a mouse click — which is what makes
   * "Telegram is an adapter, not a second application" a checked claim rather
   * than an intention.
   */
  const TELEGRAM_ADAPTER = 'src/services/telegramService.ts'

  it('keeps services channel-agnostic — Telegram reaches exactly one of them', () => {
    const found = violations(
      (file) =>
        inLayer(file, 'src/services/', 'src/repositories/', 'src/db/', 'src/ai/') &&
        file !== TELEGRAM_ADAPTER,
      (ref) => ref.resolved.includes('integrations/telegram'),
    )
    expect(found).toEqual([])
  })

  it('lets only the Telegram adapter reach the Telegram integration', () => {
    const importers = IMPORTS.filter(
      (ref) => ref.resolved.includes('integrations/telegram') && !/\.test\.tsx?$/.test(ref.file),
    ).map((ref) => ref.file)

    expect([...new Set(importers)].sort()).toEqual([TELEGRAM_ADAPTER])
  })

  it('keeps the Telegram adapter out of the domain services', () => {
    // The dependency runs one way. A task service that imported the Telegram
    // adapter would make the channel a prerequisite for the application.
    const found = violations(
      (file) =>
        inLayer(file, 'src/services/', 'src/repositories/', 'src/db/') && file !== TELEGRAM_ADAPTER,
      (ref) => ref.resolved === 'src/services/telegramService',
    )
    expect(found).toEqual([])
  })

  it('keeps the task feature ignorant of Telegram', () => {
    // Telegram is a future *producer* of CommandIntents, not something the task
    // system knows about. If this ever fails, the M14 transport has leaked into
    // the domain and the command layer has stopped earning its keep.
    const found = violations(
      (file) => inLayer(file, 'src/features/tasks/'),
      (ref) => ref.resolved.includes('integrations/telegram') || /telegram/i.test(ref.spec),
    )
    expect(found).toEqual([])
  })

  it('routes every task mutation through the command layer', () => {
    // Components and hooks may not call taskService directly: the executor is
    // the only caller, which is what keeps every producer on one path.
    const found = IMPORTS.filter(
      (ref) =>
        !ref.typeOnly &&
        !ref.file.startsWith('src/services/') &&
        /taskService|taskRepo/.test(ref.spec),
    ).map((ref) => `${ref.file} imports ${ref.spec}`)
    expect(found).toEqual([])
  })

  it('keeps React out of the persistence and platform layers', () => {
    const found = violations(
      (file) => inLayer(file, 'src/repositories/', 'src/db/', 'src/platform/'),
      (ref) => REACT_PACKAGES.includes(ref.spec),
    )
    expect(found).toEqual([])
  })

  it('keeps db/ at the bottom of the stack', () => {
    const found = violations(
      (file) => file.startsWith('src/db/'),
      (ref) => targets(ref, 'src/services', 'src/repositories', 'src/components', 'src/features'),
    )
    expect(found).toEqual([])
  })

  it('keeps lib/ and types/ as leaves', () => {
    const found = violations(
      (file) => inLayer(file, 'src/lib/', 'src/types/'),
      (ref) =>
        targets(
          ref,
          'src/components',
          'src/features',
          'src/app',
          'src/hooks',
          'src/store',
          'src/services',
          'src/repositories',
          'src/db',
          'src/platform',
        ),
    )
    expect(found).toEqual([])
  })

  it('leaves integrations/ pure — no I/O and no persistence', () => {
    const found = violations(
      (file) => file.startsWith('src/integrations/'),
      (ref) =>
        REACT_PACKAGES.includes(ref.spec) ||
        ref.spec === 'dexie' ||
        targets(ref, 'src/platform', 'src/repositories', 'src/db'),
    )
    expect(found).toEqual([])
  })

  it('confines Dexie to db/ and repositories/', () => {
    const dexieImporters = [
      ...new Set(IMPORTS.filter((ref) => ref.spec === 'dexie').map((ref) => ref.file)),
    ].sort()

    // db/ owns the schema; repositories/ needs the Table type to describe what
    // it returns. Nothing above them may name Dexie at all.
    expect(
      dexieImporters.every(
        (file) => file.startsWith('src/db/') || file.startsWith('src/repositories/'),
      ),
    ).toBe(true)

    const runtimeImporters = [
      ...new Set(
        IMPORTS.filter((ref) => ref.spec === 'dexie' && !ref.typeOnly).map((ref) => ref.file),
      ),
    ].sort()
    // Exactly one module in the application imports the Dexie runtime.
    expect(runtimeImporters).toEqual(['src/db/schema.ts'])
  })
})

/**
 * M10's boundary: the filesystem.
 *
 * The point of the vault port is that a Tauri adapter can replace the browser
 * one in M13 without the notes feature changing. That only holds if nothing
 * above the adapter names a browser filesystem API, so these tests state it
 * directly rather than trusting a convention.
 */
describe('the vault adapter boundary', () => {
  /**
   * The entry points to the File System Access API.
   *
   * Only these three: a name like `requestPermission` or `getFileHandle` is
   * also a legitimate method on the vault *port* and on the OPFS snapshot
   * store, so forbidding those would flag the abstraction along with the thing
   * it abstracts. The pickers are unambiguous — nothing but a real browser
   * filesystem call names them.
   */
  const PICKERS = ['showDirectoryPicker', 'showOpenFilePicker', 'showSaveFilePicker']

  /** Comments discuss these APIs; only actual code counts as a violation. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('keeps browser filesystem APIs below the platform layer', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      // platform/ is where adapters live; that is the whole point of it.
      if (rel.startsWith('src/platform/')) continue

      const source = stripComments(readFileSync(file, 'utf8'))
      for (const api of PICKERS) {
        if (source.includes(api)) offenders.push(`${rel} names ${api}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('confines the File System Access API to one adapter file', () => {
    // Not just "somewhere in platform" — one file, so M13 has exactly one
    // place to add a sibling rather than a scattering to find.
    const users = walk(SRC)
      .map((file) => posix.normalize(relative(ROOT, file).split('\\').join('/')))
      .filter((rel) =>
        PICKERS.some((api) => stripComments(readFileSync(join(ROOT, rel), 'utf8')).includes(api)),
      )

    expect(users).toEqual(['src/platform/browser/browserVault.ts'])
  })

  it('keeps components and hooks away from the vault adapters', () => {
    // The UI talks to a hook, which talks to the service, which talks to the
    // port. A component importing the adapter would pin the app to Chromium.
    const offenders = IMPORTS.filter(
      (ref) =>
        inLayer(ref.file, 'src/components/', 'src/features/', 'src/app/', 'src/store/') &&
        /Vault(\.ts)?$/.test(ref.resolved) &&
        ref.resolved.includes('platform/'),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('lets the service reach the port but never a concrete vault adapter', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/services/') &&
        !ref.file.endsWith('.test.ts') &&
        /platform\/browser\/(browser|unsupported|memory)Vault/.test(ref.resolved),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps the Obsidian integrations pure — no port, no service, no Dexie', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/integrations/obsidian/') &&
        /^(src\/(services|repositories|db|platform|features|components)|dexie)/.test(ref.resolved),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })
})

/**
 * M12's boundary: the knowledge layer consumes Notes, never files.
 *
 * The flow is Obsidian files -> M11 sync -> Note records -> the knowledge
 * layer. If the knowledge service ever read a file directly it would bypass
 * conflict detection entirely and could show a graph built from documents the
 * user has not agreed to import.
 */
describe('the knowledge layer boundary', () => {
  it('keeps the knowledge service away from the filesystem', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file.includes('knowledge') &&
        !ref.file.endsWith('.test.ts') &&
        /(platform\/browser|VaultPort|vaultPort|obsidianSyncService|obsidianService)/.test(
          ref.resolved,
        ),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps the derived index pure — no Dexie, no React, no service', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file === 'src/integrations/obsidian/knowledgeIndex.ts' &&
        /^(src\/(services|repositories|db|platform|features|components)|dexie|react)/.test(
          ref.resolved,
        ),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps the graph layout a leaf', () => {
    const offenders = IMPORTS.filter(
      (ref) => ref.file === 'src/lib/graphLayout.ts' && !ref.resolved.startsWith('src/lib/'),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('adds no second persistent note-to-note relationship store', () => {
    // Backlinks and the graph are derived on read. A store for them would be a
    // second copy of the truth that goes stale the moment a note is edited
    // elsewhere.
    const forbidden = ['noteEdges', 'backlinks', 'knowledgeEdges', 'noteGraph', 'relatedNotes']
    expect(STORE_NAMES.filter((name) => forbidden.includes(name))).toEqual([])
  })
})

/**
 * M13's boundary: Tauri is a runtime adapter, not a second architecture.
 *
 * The desktop build must be reachable through the same ports the browser build
 * uses. The moment a component, a service or the sync logic names a Tauri API,
 * the application stops being a web app that *can* run on the desktop and
 * becomes two applications sharing a folder.
 */
describe('the Tauri runtime boundary', () => {
  /** Everything that only exists inside a Tauri WebView. */
  const TAURI_PACKAGES = /^@tauri-apps\//
  const TAURI_GLOBALS = ['__TAURI_INTERNALS__', '__TAURI__']

  /** Comments discuss these; only actual code counts as a violation. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('lets exactly one file import a Tauri API', () => {
    // Not "somewhere in platform/tauri" — one file. The adapters take a bridge
    // object instead, which is what makes them testable in Node and what keeps
    // the untestable part down to a list of `invoke` calls with no logic.
    const importers = IMPORTS.filter((ref) => TAURI_PACKAGES.test(ref.spec)).map((ref) => ref.file)

    expect([...new Set(importers)]).toEqual(['src/platform/tauri/bridge.ts'])
  })

  it('keeps Tauri APIs out of the UI', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        inLayer(ref.file, 'src/components/', 'src/features/', 'src/app/', 'src/store/') &&
        (TAURI_PACKAGES.test(ref.spec) || ref.resolved.startsWith('src/platform/tauri')),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps Tauri APIs out of the services, including the Obsidian sync logic', () => {
    // `obsidianService` and `obsidianSyncService` reach the desktop filesystem
    // the same way they reach the browser one: through `VaultPort`. That is why
    // M11 needed no changes for M13.
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/services/') &&
        !/\.test\.tsx?$/.test(ref.file) &&
        (TAURI_PACKAGES.test(ref.spec) || ref.resolved.startsWith('src/platform/tauri')),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps Tauri APIs out of hooks, repositories, db, lib and integrations', () => {
    const offenders = IMPORTS.filter(
      (ref) =>
        (isHookFile(ref.file) ||
          inLayer(ref.file, 'src/repositories/', 'src/db/', 'src/lib/', 'src/integrations/')) &&
        (TAURI_PACKAGES.test(ref.spec) || ref.resolved.startsWith('src/platform/tauri')),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('keeps the browser adapters ignorant of Tauri', () => {
    // A browser adapter that imported the desktop one would defeat the split:
    // the two runtimes are siblings, not a hierarchy.
    const offenders = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/platform/browser/') &&
        (TAURI_PACKAGES.test(ref.spec) || ref.resolved.startsWith('src/platform/tauri')),
    )

    expect(offenders.map((ref) => `${ref.file} -> ${ref.spec}`)).toEqual([])
  })

  it('asks how the runtime is detected in exactly one module', () => {
    // The rule this enforces: features ask what the build *can do*, never what
    // it *is*. One module knows about the global, so a third runtime later
    // means one edit rather than a search.
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      if (rel === 'src/platform/runtime.ts') continue

      const source = stripComments(readFileSync(file, 'utf8'))
      for (const global of TAURI_GLOBALS) {
        if (source.includes(global)) offenders.push(`${rel} names ${global}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('lets the vault adapters share one path-safety module', () => {
    // Both adapters import the same validator. Two implementations of "is this
    // path safe" is one implementation and one liability.
    for (const adapter of [
      'src/platform/browser/browserVault.ts',
      'src/platform/tauri/tauriVault.ts',
    ]) {
      const imports = IMPORTS.filter((ref) => ref.file === adapter)
      expect(imports.map((ref) => ref.resolved)).toContain('src/integrations/obsidian/vaultPath')
    }
  })

  it('adds no Rust-side application logic', () => {
    // Tauri is a shell. If the desktop build ever grew its own note model or
    // its own database, the two runtimes would stop being the same app.
    const rust = join(ROOT, 'src-tauri', 'src')
    const sources = readdirSync(rust).filter((name) => name.endsWith('.rs'))

    expect(sources.sort()).toEqual([
      'ai.rs',
      'lib.rs',
      'main.rs',
      'menu.rs',
      'paths.rs',
      'secrets.rs',
      'store.rs',
      'telegram.rs',
      'vault.rs',
    ])

    // No database, and no way to run a program. M14 adds a network client and
    // M15.1 adds a second, but each lives only in the file that talks to its own
    // named host — see the Telegram and AI boundary tests for what those two
    // files are allowed to reach. Nothing else may make a request at all.
    const NETWORK_CLIENTS = ['telegram.rs', 'ai.rs']
    const FORBIDDEN = ['rusqlite', 'sqlite', 'diesel', 'sea_orm', 'std::process::Command']
    for (const name of sources) {
      const source = readFileSync(join(rust, name), 'utf8')
      for (const banned of FORBIDDEN) {
        expect(source, `${name} must not use ${banned}`).not.toContain(banned)
      }
      if (!NETWORK_CLIENTS.includes(name)) {
        expect(source, `${name} must not make network requests`).not.toContain('reqwest')
      }
    }
  })

  it('keeps the native menu ids and the MenuAction union in step', () => {
    // The two halves of the menu live in different languages, and a menu item
    // whose id the web layer does not recognise is silently ignored — so a
    // typo, or an item added on one side only, would look like a menu that
    // simply does nothing. That is how Cmd+Z broke: the Edit menu claimed the
    // key equivalent while nothing on the web side answered for it.
    const rust = readFileSync(join(ROOT, 'src-tauri', 'src', 'menu.rs'), 'utf8')
    const ids = [...rust.matchAll(/with_id\("([\w-]+)"/g)].map((match) => match[1] as string)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(MENU_ACTIONS as readonly string[], `menu.rs emits "${id}"`).toContain(id)
    }
  })

  it('claims Cmd+Z with a custom item, not the predefined one', () => {
    /*
     * The regression this pins down.
     *
     * `PredefinedMenuItem::undo` carries Cmd+Z, and AppKit resolves a menu's
     * key equivalents before the event reaches the WebView. With it in the
     * menu, the application's undo stack was unreachable from the keyboard on
     * desktop while working normally in a browser. The custom item forwards to
     * the renderer, which applies the same rule the browser already applies.
     *
     * Cut, copy, paste, select-all and redo stay predefined: those genuinely
     * belong to the text field, and the web layer has nothing to add.
     */
    const rust = readFileSync(join(ROOT, 'src-tauri', 'src', 'menu.rs'), 'utf8')
    const editMenu = rust.slice(rust.indexOf('let edit_menu'), rust.indexOf('let view_menu'))

    expect(editMenu).toContain('with_id("undo"')
    expect(editMenu).toContain('CmdOrCtrl+Z')
    expect(editMenu).not.toMatch(/^\s*\.undo\(\)/m)

    for (const predefined of ['.cut()', '.copy()', '.paste()', '.select_all()', '.redo()']) {
      expect(editMenu, `${predefined} belongs to the text field`).toContain(predefined)
    }
  })

  it('grants the desktop build no capability it does not use', () => {
    // Phase 16, checked rather than asserted in prose. `dialog` is absent on
    // purpose: the picker is opened from Rust, never from JavaScript, so the
    // renderer needs no permission to it.
    const capabilities = JSON.parse(
      readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    ) as { permissions: string[] }

    const BANNED = ['shell', 'process', 'fs:', 'http', 'updater', 'os:allow-exec']
    for (const permission of capabilities.permissions) {
      for (const banned of BANNED) {
        expect(permission, `capability ${permission} is broader than M13 needs`).not.toContain(
          banned,
        )
      }
    }
  })

  it('exposes a closed set of native commands, with no generic escape hatch', () => {
    // A `invoke_any(command, args)` would make the Rust allow-list decorative.
    const lib = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8')
    const handlers = [...lib.matchAll(/vault::(\w+),/g)].map((match) => match[1])

    expect(handlers.sort()).toEqual([
      'runtime_info',
      'vault_connect',
      'vault_create_dir',
      'vault_current',
      'vault_delete',
      'vault_disconnect',
      'vault_exists',
      'vault_list',
      'vault_permission',
      'vault_read',
      // Text only. There is deliberately no command that returns a PDF's bytes,
      // so the renderer gains a document reader, not a binary-file reader.
      'vault_read_pdf_text',
      'vault_restore',
      'vault_write',
    ])

    for (const dangerous of ['execute_command', 'read_any_file', 'write_any_file', 'eval']) {
      expect(lib).not.toContain(dangerous)
    }
  })
})

/**
 * M14's boundary: Telegram is a remote control, not a second application.
 *
 * The claims worth machine-checking are the ones a reviewer would otherwise
 * have to take on trust — that the bot token cannot reach the renderer, that
 * there is no general-purpose network or shell bridge hiding behind the
 * Telegram commands, and that a chat message ends up in the same command layer
 * a mouse click does.
 */
describe('the Telegram boundary', () => {
  const RUST = join(ROOT, 'src-tauri', 'src')
  const telegramRs = () => readFileSync(join(RUST, 'telegram.rs'), 'utf8')
  const libRs = () => readFileSync(join(RUST, 'lib.rs'), 'utf8')

  it('exposes no command that hands the bot token back', () => {
    // The whole value of the Keychain is that the token goes in and does not
    // come out. A `secret_get` command would make it an expensive localStorage.
    const commands = [...libRs().matchAll(/(\w+)::(\w+),/g)].map((match) => match[2] as string)

    for (const leaky of ['secret_get', 'telegram_token', 'get_token', 'secrets_get']) {
      expect(commands, `no command may return a secret (${leaky})`).not.toContain(leaky)
    }
    expect(libRs()).not.toContain('pub fn secret_get')
  })

  it('reads the credential store from exactly one place', () => {
    /*
     * A macOS Keychain read is a potential authorization prompt, so *where* the
     * token is read is a user-visible property, not only a security one.
     *
     * It used to be read inside every Bot API call. Measured on the real
     * binary, that was 15,081 reads in 33 seconds — which is what produced the
     * repeated "vaultwork wants to access…" dialogs. It is now read once per
     * worker session, by `load_token`, and held in memory for that session.
     *
     * This asserts the shape that makes that true: one call site in the whole
     * crate, and it is not inside the request helper.
     */
    const source = telegramRs()
    const stripped = source.slice(0, source.indexOf('#[cfg(test)]'))
    const reads = [...stripped.matchAll(/secrets::get\(/g)]

    expect(reads).toHaveLength(1)
    expect(stripped).toContain('fn load_token(')

    // The request helper takes a token; it must not fetch one.
    const call = stripped.slice(stripped.indexOf('async fn call<'))
    const body = call.slice(0, call.indexOf('\nasync fn '))
    expect(body).not.toContain('secrets::')
  })

  it('has no generic network bridge', () => {
    // Every Telegram request names its own endpoint. A command taking a URL
    // would hand any script in the WebView the user's whole network.
    const commands = [...libRs().matchAll(/(\w+)::(\w+),/g)].map((match) => match[2] as string)

    for (const generic of ['http_request', 'fetch', 'request', 'http_get', 'http_post']) {
      expect(commands).not.toContain(generic)
    }

    // No command signature accepts a url.
    const signatures = [...telegramRs().matchAll(/pub (?:async )?fn (\w+)\(([^)]*)\)/g)]
    for (const [, name, params] of signatures) {
      if (!name?.startsWith('telegram_')) continue
      expect(params ?? '', `${name} must not take a URL`).not.toMatch(/url|endpoint|host|base/i)
    }
  })

  it('talks to exactly one host, named as a constant', () => {
    const source = telegramRs()
    expect(source).toContain('const API_BASE: &str = "https://api.telegram.org"')

    // Any other absolute URL in the file would be a second destination.
    const urls = [...source.matchAll(/"https?:\/\/[^"]+"/g)].map((match) => match[0])
    expect(urls).toEqual(['"https://api.telegram.org"'])
  })

  it('has no shell or process bridge', () => {
    for (const name of readdirSync(RUST).filter((file) => file.endsWith('.rs'))) {
      const source = readFileSync(join(RUST, name), 'utf8')
      for (const banned of [
        'std::process',
        'Command::new',
        'tauri_plugin_shell',
        'shell_execute',
      ]) {
        expect(source, `${name} must not run programs`).not.toContain(banned)
      }
    }
  })

  it('keeps the bot token out of everything the renderer can read', () => {
    // Not a token *value* check — there is none to find — but a check that no
    // frontend module even has a field to put one in. The token has exactly one
    // home, and it is not in this half of the application.
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      const source = readFileSync(file, 'utf8')
      // The one legitimate mention is the parameter passed *in* to `configure`.
      const isConfigureSite =
        rel === 'src/platform/tauri/bridge.ts' ||
        rel === 'src/platform/tauri/tauriTelegram.ts' ||
        rel === 'src/platform/ports.ts' ||
        rel === 'src/platform/browser/unsupportedTelegram.ts' ||
        rel === 'src/platform/tauri/fakeBridge.ts' ||
        rel.startsWith('src/features/settings/')

      if (isConfigureSite) continue
      if (/botToken|bot_token|telegramToken/.test(source)) offenders.push(rel)
    }

    expect(offenders).toEqual([])
  })

  it('never persists a token: the backup format has no field for one', () => {
    // Phase 44, checked structurally. The backup exports Dexie stores, and the
    // token is not in Dexie — it is in the OS credential store, which no export
    // path can reach.
    expect(STORE_NAMES_FOR_BACKUP).not.toContain('secrets')
    const settings = readFileSync(join(SRC, 'types', 'entities.ts'), 'utf8')
    const block = settings.slice(settings.indexOf('export interface Settings'))
    expect(block.slice(0, block.indexOf('}'))).not.toMatch(/token|telegram/i)
  })

  it('starts no polling loop in the browser', () => {
    // The browser adapter refuses every operation; only the Tauri one can run.
    const browser = readFileSync(join(SRC, 'platform', 'browser', 'unsupportedTelegram.ts'), 'utf8')
    expect(browser).toContain('isSupported: false')
    expect(browser).not.toContain('setInterval')
    expect(browser).not.toContain('getUpdates')

    // And nothing outside the native worker names the polling endpoint.
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} must not poll Telegram`).not.toContain('getUpdates')
    }
  })

  it('routes Telegram mutations through the shared command layer', () => {
    // The adapter must reach the executor, not the entity services directly.
    const adapter = IMPORTS.filter((ref) => ref.file === 'src/services/telegramService.ts')
    const resolved = adapter.map((ref) => ref.resolved)

    expect(resolved).toContain('src/services/commands/commandExecutor')

    for (const forbidden of [
      'src/services/taskService',
      'src/services/noteService',
      'src/services/habitService',
      'src/services/projectService',
      'src/services/goalService',
    ]) {
      expect(
        resolved,
        `Telegram must go through the command layer, not ${forbidden}`,
      ).not.toContain(forbidden)
    }
  })

  it('normalises at the boundary — no Telegram API shapes in the application', () => {
    // `update_id`, `message_id` and friends stop at the bridge; everything above
    // it speaks `IncomingTelegramMessage`. Comments may *name* these fields —
    // explaining what `externalId` holds is the point — so only code counts.
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      if (rel.startsWith('src/platform/tauri/')) continue
      const source = stripComments(readFileSync(file, 'utf8'))
      if (/\bupdate_id\b|\bmessage_id\b|\bfrom_user\b/.test(source)) offenders.push(rel)
    }

    expect(offenders).toEqual([])
  })
})

/**
 * M15.1's boundary: the model is a provider, not a privileged actor.
 *
 * Two claims are worth machine-checking here, and they are different claims.
 *
 * The first is architectural: the AI layer must reach data the way every other
 * caller does — through services and the command layer — and never through
 * Dexie or a repository. A model that could read rows directly could act on
 * data no deterministic validator ever saw, which is the whole risk M15 is
 * built to contain.
 *
 * The second is a secret-handling claim, and it is the same one M14 makes about
 * the bot token: the provider key has exactly one home, and it is not in the
 * half of the application an attacker can reach.
 */
describe('the AI boundary', () => {
  const RUST = join(ROOT, 'src-tauri', 'src')
  const aiRs = () => readFileSync(join(RUST, 'ai.rs'), 'utf8')
  /**
   * The shipping half of `ai.rs`.
   *
   * The `#[cfg(test)]` module below it deliberately names a URL-shaped string
   * and other model ids — that is what proves the validators refuse them — so
   * the "one host, one model" properties are asserted about the code that
   * actually runs, not about its own test fixtures.
   */
  const aiProduction = () => {
    const source = aiRs()
    const tests = source.indexOf('#[cfg(test)]')
    return tests === -1 ? source : source.slice(0, tests)
  }
  const libRs = () => readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8')

  /**
   * The purity claim, and it is the load-bearing one for M15.2.
   *
   * `src/ai` interprets what a model said. It must be able to do that with no
   * database, no network, no clock and no side effect — which is what makes
   * "the model cannot act" a structural fact rather than a promise about how
   * carefully the code was written.
   *
   * Later phases loosen the *layer*: M15.4 needs `entityResolver` and M15.5
   * needs the command executor. Neither belongs to the parser, so the list of
   * modules named here is expected to grow while these files stay pure.
   */
  const AI_MAY_IMPORT = [
    'src/types',
    'src/lib',
    'src/platform/ports',
    'src/ai',
    // Type-only, for the allowlist's compile-time proof that its kinds are real
    // command kinds. No runtime value crosses this edge.
    'src/services/commands/intents',
  ]

  /*
   * M15.3 widened nothing.
   *
   * The context layer needs application data, which would ordinarily mean the
   * AI layer importing query services. Instead it declares the read model it
   * needs (`AiReadModel` in `aiContextTypes`) and `services/ai` implements it —
   * the same inversion `platform/ports.ts` uses for the vault and Telegram.
   *
   * So the list above is unchanged from M15.2, and the tests below still hold
   * against a layer that now reads the user's tasks, projects, goals, habits
   * and notes. That is the whole argument for the inversion.
   */

  it('lets the AI layer import only types, pure helpers and the port', () => {
    const strayed = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/ai/') &&
        ref.resolved.startsWith('src/') &&
        !AI_MAY_IMPORT.some(
          (allowed) => ref.resolved === allowed || ref.resolved.startsWith(`${allowed}/`),
        ),
    ).map((ref) => `${ref.file} imports ${ref.spec}`)

    expect(strayed).toEqual([])
  })

  it('takes nothing but types from the command layer', () => {
    // The allowlist proves its kinds are real `CommandIntent` kinds at compile
    // time. That must not become a runtime dependency on the command layer —
    // importing a value from there is one refactor away from calling it.
    const runtime = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/ai/') && ref.resolved.startsWith('src/services/') && !ref.typeOnly,
    ).map((ref) => `${ref.file} imports ${ref.spec}`)

    expect(runtime).toEqual([])
  })

  it('cannot execute a command or call a mutation service', () => {
    /*
     * M15.2's central rule, checked rather than asserted in prose: a proposal
     * is not a command. The parser produces `ProposedIntent` values that
     * nothing in this layer can run.
     *
     * M15.5 is where execution arrives, and it will arrive in a *caller* — the
     * confirmation flow — not in here. If this test ever needs relaxing, that
     * is the moment to ask whether the layer has stopped being a parser.
     */
    const forbidden =
      /commandExecutor|taskService|projectService|goalService|habitService|noteService|entityResolver/

    const offenders = IMPORTS.filter(
      (ref) => ref.file.startsWith('src/ai/') && forbidden.test(ref.spec),
    ).map((ref) => `${ref.file} imports ${ref.spec}`)
    expect(offenders).toEqual([])

    // And no file in the layer names the executor's entry points at all.
    for (const file of walk(join(SRC, 'ai'))) {
      const code = codeOf(file)
      for (const call of ['execute(', 'executeText(', 'resolveChoice(']) {
        expect(code, `${file} must not call ${call}`).not.toContain(call)
      }
    }
  })

  it('keeps the AI layer away from Dexie and the repositories', () => {
    // Stricter than the rule for `services/`, which may reach repositories
    // because that is what a service is for. The AI layer may not.
    const found = violations(
      (file) => inLayer(file, 'src/ai/'),
      (ref) =>
        PERSISTENCE_PACKAGES.includes(ref.spec) ||
        REACT_PACKAGES.includes(ref.spec) ||
        targets(ref, 'src/db', 'src/repositories') ||
        ref.resolved.includes('integrations/telegram'),
    )
    expect(found).toEqual([])
  })

  it('declares that rule in ESLint too, so it bites while you type', () => {
    /*
     * The scans above check what the layer currently imports. This pins the
     * *guard*: the lint rule is what refuses the import while it is being
     * typed, and deleting it must fail a test rather than quietly widen the
     * layer for whoever writes the next AI file.
     */
    const config = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8')
    const block = config.slice(config.indexOf("files: ['src/ai/**/*.ts']"))
    const rule = block.slice(0, block.indexOf('},\n  },'))

    for (const forbidden of ['@/repositories/**', '@/db/**', '@/integrations/telegram/**']) {
      expect(rule, `the AI layer must be refused ${forbidden}`).toContain(forbidden)
    }
    // And the bare-path twin, so a relative import cannot walk around the alias.
    expect(rule).toContain("'**/repositories/**'")
  })

  it('exposes a closed set of AI commands, with no generic escape hatch', () => {
    const commands = [...libRs().matchAll(/ai::(\w+),/g)].map((match) => match[1])

    expect(commands.sort()).toEqual([
      'ai_complete',
      'ai_configure',
      'ai_disconnect',
      'ai_set_enabled',
      'ai_set_model',
      'ai_status',
      'ai_test',
    ])

    // The command that must never exist. There is no way to ask for the key.
    for (const dangerous of ['ai_get_key', 'ai_key', 'ai_secret', 'ai_request', 'ai_fetch']) {
      expect(commands).not.toContain(dangerous)
    }
  })

  it('advertises no keyboard shortcut twice', () => {
    /*
     * A shortcut shown beside a nav item is a promise about what that key does.
     * Two items claiming the same chord means at least one of them is lying,
     * and the sidebar had been showing `G D` on both Dashboard and Documents —
     * where it navigated to the Dashboard.
     */
    const nav = readFileSync(join(SRC, 'app', 'navigation.ts'), 'utf8')
    const shortcuts = [...nav.matchAll(/shortcut: '([^']+)'/g)].map((match) => match[1])

    expect(shortcuts.length).toBeGreaterThan(5)
    expect(new Set(shortcuts).size, `duplicate shortcut in ${shortcuts.join(', ')}`).toBe(
      shortcuts.length,
    )
  })

  it('has no generic network bridge in the AI provider either', () => {
    // The renderer names no destination. If a command ever took a url, a host
    // or a header, the provider would become a proxy for the whole internet
    // with the user's credential attached.
    const signatures = [...aiRs().matchAll(/pub (?:async )?fn (\w+)\(([^)]*)\)/g)]
    const named = signatures.filter(([, name]) => name?.startsWith('ai_'))

    expect(named.length).toBeGreaterThan(0)
    for (const [, name, params] of named) {
      expect(params ?? '', `${name} must not take a URL`).not.toMatch(
        /url|endpoint|host|base|header/i,
      )
    }
  })

  it('talks to exactly one host, named as a constant', () => {
    const source = aiProduction()
    expect(source).toContain('const API_BASE: &str = "https://api.groq.com"')

    // Any other absolute URL in the file would be a second destination.
    const urls = [...source.matchAll(/"https?:\/\/[^"]+"/g)].map((match) => match[0])
    expect(urls).toEqual(['"https://api.groq.com"'])
  })

  it('names the model in exactly one place', () => {
    /*
     * A model string scattered across files is a model nobody can change.
     *
     * Asserted structurally rather than against a particular model id. The
     * earlier version pinned `llama-3.3-70b-versatile`, which meant the guard
     * failed the day Groq retired that model and the constant was updated —
     * turning a correct change into a broken build. The property worth holding
     * is "one constant, named nowhere else", and that survives the next
     * retirement.
     */
    const production = aiProduction()

    const declaration = production.match(/const DEFAULT_MODEL: &str = "([^"]+)";/)
    expect(declaration, 'the default model must be a named constant').not.toBeNull()
    const model = declaration?.[1] ?? ''
    expect(model.length).toBeGreaterThan(0)
    const quoted = new RegExp(`"${model.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`, 'g')

    // Within the shipping half of ai.rs, once: the constant's own definition.
    expect([...production.matchAll(quoted)]).toHaveLength(1)

    // And no other Rust file names it.
    const rust = readdirSync(RUST).filter((name) => name.endsWith('.rs'))
    const naming = rust.filter((name) =>
      new RegExp(quoted.source).test(readFileSync(join(RUST, name), 'utf8')),
    )
    expect(naming).toEqual(['ai.rs'])

    // The frontend names no model at all — not this one, not any.
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      const source = readFileSync(file, 'utf8')
      if (/llama|mixtral|gpt-|claude-\d/i.test(source)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('reads the credential store from exactly one place, and caches it', () => {
    const stripped = aiProduction().replace(/\/\/.*$/gm, '')

    // One read site, and it is the loader — not the request helper.
    const reads = [...stripped.matchAll(/secrets::get\(/g)]
    expect(reads).toHaveLength(1)
    expect(stripped).toContain('fn load_key(')

    // The request helper takes a key; it must not fetch one. This is the M14
    // Keychain regression, pinned so it cannot be reintroduced here.
    const chat = stripped.slice(stripped.indexOf('async fn chat('))
    const body = chat.slice(0, chat.indexOf('\nfn model_of('))
    expect(body.length).toBeGreaterThan(0)
    expect(body).not.toContain('secrets::')
  })

  it('keeps the provider key out of everything the renderer can read', () => {
    // Not a key *value* check — there is none to find — but a check that no
    // frontend module even has a field to put one in.
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = posix.normalize(relative(ROOT, file).split('\\').join('/'))
      const source = readFileSync(file, 'utf8')

      /*
       * The only legitimate mentions are on the key's one-way path *in*: the
       * port, the adapters, and — since the Settings section exists — the two
       * files that take it from the user and hand it straight to
       * `platform.ai.configure`.
       *
       * Named file by file rather than by folder (the Telegram twin allows all
       * of `src/features/settings/`), so a third settings file cannot acquire a
       * key field without this list being edited. The rule is unchanged: no
       * frontend module may hold a key, and nothing reads one back — there is
       * still no command that returns it.
       */
      const isConfigureSite =
        rel === 'src/platform/tauri/bridge.ts' ||
        rel === 'src/platform/tauri/tauriAi.ts' ||
        rel === 'src/platform/ports.ts' ||
        rel === 'src/platform/browser/nullAi.ts' ||
        rel === 'src/platform/tauri/fakeBridge.ts' ||
        rel === 'src/features/settings/hooks/useAiSettings.ts' ||
        rel === 'src/features/settings/components/AssistantSection.tsx'

      if (isConfigureSite) continue
      if (/apiKey|api_key|groqKey|GROQ_API_KEY/.test(source)) offenders.push(rel)
    }

    expect(offenders).toEqual([])
  })

  it('never ships the key to the browser bundle', () => {
    // The failure mode this forbids is a one-line `import.meta.env` away, and
    // it would publish the key to every visitor.
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} must not read an AI key from the bundle`).not.toMatch(
        /VITE_[A-Z_]*(GROQ|AI|OPENAI|ANTHROPIC)[A-Z_]*/,
      )
    }
    // And nothing in the repo's own env surface declares one either.
    const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/GROQ|OPENAI|ANTHROPIC/i)
  })

  it('reaches application data only through the read model it declares', () => {
    // The context layer's data arrives as a parameter, never as a query. If
    // this fails, `src/ai` has grown a way to read the database directly and
    // the boundary has stopped being a boundary.
    const context = walk(join(SRC, 'ai', 'context'))
    expect(context.length).toBeGreaterThan(0)

    for (const file of context) {
      const source = readFileSync(file, 'utf8')
      for (const banned of ['getDashboard', 'getTaskView', 'getTaskCounts', 'await ', 'fetch(']) {
        expect(source, `${file} must not perform I/O (${banned})`).not.toContain(banned)
      }
    }
  })

  it('sends no note body, from anywhere in the context layer', () => {
    /*
     * The note policy, checked structurally rather than only behaviourally.
     * `Note.body` and `RecentNote.excerpt` are the two ways a note's contents
     * could reach a provider, and neither name may appear in the layer that
     * builds what is sent.
     */
    for (const file of walk(join(SRC, 'ai', 'context'))) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      expect(code, `${file} must not read a note body`).not.toMatch(/\.body\b/)
      expect(code, `${file} must not read a note excerpt`).not.toMatch(/\.excerpt\b/)
    }
  })

  it('keeps the read-model adapter free of ranking and querying of its own', () => {
    // `services/ai` is a wiring file. It may call query services and the
    // existing Next Action ranking; it must not reach a repository, and it must
    // not define an ordering the rest of the application does not use.
    const adapter = IMPORTS.filter((ref) => ref.file.startsWith('src/services/ai/'))
    const resolved = adapter.map((ref) => ref.resolved)

    expect(resolved).toContain('src/services/dashboard/dashboardStats')
    for (const forbidden of ['src/repositories', 'src/db']) {
      expect(
        resolved.some((target) => target === forbidden || target.startsWith(`${forbidden}/`)),
        `services/ai must not import ${forbidden}`,
      ).toBe(false)
    }

    for (const file of walk(join(SRC, 'services', 'ai'))) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} must not sort for itself`).not.toContain('.sort(')
    }
  })

  it('resolves references only through the lookup it declares', () => {
    // M15.4's bridge turns a phrase into an id — but it never performs the
    // lookup. The resolver arrives as a parameter, so the AI layer still cannot
    // read the database even while producing id references.
    for (const file of walk(join(SRC, 'ai', 'bridge'))) {
      const code = codeOf(file)
      for (const banned of ['resolveTaskByText', 'taskRepo', 'getTaskView', 'listLive']) {
        expect(code, `${file} must not resolve for itself (${banned})`).not.toContain(banned)
      }
    }
  })

  it('produces id references only from the application, never from a model', () => {
    /*
     * The M15.4 invariant. `{ by: 'id' }` may be *constructed* by the bridge —
     * that is its job — but only from a value the lookup returned. What must not
     * exist anywhere in the layer is a path that copies an id off a proposal.
     *
     * Checked by requiring that every `by: 'id'` literal in the layer sits in
     * `aiIntentBridge.ts`, which builds it from a resolution, and that the
     * refusal of a model-supplied id is present.
     */
    const withIdRefs = walk(join(SRC, 'ai'))
      .filter((file) => /by:\s*'id'/.test(codeOf(file)))
      .map((file) => posix.normalize(relative(ROOT, file).split('\\').join('/')))

    expect(withIdRefs).toEqual(['src/ai/bridge/aiIntentBridge.ts'])

    const bridge = codeOf(join(SRC, 'ai', 'bridge', 'aiIntentBridge.ts'))
    expect(bridge, 'a model-supplied id must be refused').toContain("candidate.by === 'id'")
  })

  it('keeps the lookup adapter on the existing resolver, not a second one', () => {
    // `services/ai` may reach the command layer's resolver — that is the point
    // of the adapter — but it must not grow matching logic of its own.
    const adapter = IMPORTS.filter((ref) => ref.file === 'src/services/ai/aiEntityLookup.ts')
    expect(adapter.map((ref) => ref.resolved)).toContain('src/services/commands/entityResolver')

    const code = codeOf(join(SRC, 'services', 'ai', 'aiEntityLookup.ts'))
    for (const banned of ['toLowerCase', 'includes(', 'startsWith(', 'levenshtein']) {
      expect(code, `${banned} would be a second matcher`).not.toContain(banned)
    }
  })

  it('keeps every AI mutation behind the confirmation gate', () => {
    /*
     * M15.5's invariant, checked structurally. Exactly one file in the AI
     * feature may reach the command executor, and it is the gate — so there is
     * no second path from a model's proposal to a mutation.
     *
     * `src/ai` still cannot reach it at all; that is asserted separately above.
     */
    const CONFIRMATION_GATE = 'src/services/ai/aiConfirmationService.ts'

    const callers = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/services/ai/') &&
        !/\.test\.tsx?$/.test(ref.file) &&
        ref.resolved === 'src/services/commands/commandExecutor',
    ).map((ref) => ref.file)

    expect([...new Set(callers)]).toEqual([CONFIRMATION_GATE])
  })

  it('lets the gate mutate only through the executor', () => {
    // No repository, no Dexie, no entity service. The executor is the one door,
    // which is what makes events, undo and domain rules happen by themselves.
    const gate = IMPORTS.filter(
      (ref) => ref.file === 'src/services/ai/aiConfirmationService.ts',
    ).map((ref) => ref.resolved)

    expect(gate).toContain('src/services/commands/commandExecutor')
    for (const forbidden of ['src/repositories', 'src/db']) {
      expect(
        gate.some((target) => target === forbidden || target.startsWith(`${forbidden}/`)),
        `the gate must not import ${forbidden}`,
      ).toBe(false)
    }
    for (const service of ['taskService', 'projectService', 'goalService', 'noteService']) {
      expect(
        gate.some((target) => target.includes(service)),
        service,
      ).toBe(false)
    }
  })

  it('never re-parses or re-resolves at confirmation time', () => {
    // `executeText` would re-run the parser over the user's original sentence,
    // and `resolveChoice` would search by name again — both could land on a
    // different row than the one the user was shown.
    const code = codeOf(join(SRC, 'services', 'ai', 'aiConfirmationService.ts'))

    for (const banned of ['executeText', 'resolveChoice', 'resolveTaskByText', 'platform.ai']) {
      expect(code, `the gate must not use ${banned}`).not.toContain(banned)
    }
  })

  it('offers no way to confirm a replacement intent', () => {
    // The public surface takes an id. A `confirm(id, intent)` would make the
    // pinning decorative.
    const code = codeOf(join(SRC, 'services', 'ai', 'aiConfirmationService.ts'))
    const signatures = [...code.matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)]

    for (const [, name, params] of signatures) {
      if (name !== 'confirmAiAction' && name !== 'cancelAiConfirmation') continue
      expect(params ?? '', `${name} must take only an id`).toMatch(/^id: string$/)
    }
  })

  it('keeps the assistant UI out of the database, the executor and the provider', () => {
    /*
     * The AI screen is a presentation layer and nothing else. It may reach the
     * assistant facade in `services/` through a hook, and that is the whole of
     * its power — a component that could call `execute` directly would put a
     * mutation one `onClick` away from the confirmation gate.
     */
    const found = violations(
      (file) => inLayer(file, 'src/features/ai/'),
      (ref) =>
        PERSISTENCE_PACKAGES.includes(ref.spec) ||
        targets(ref, 'src/db', 'src/repositories') ||
        ref.resolved === 'src/services/commands/commandExecutor' ||
        ref.resolved.includes('integrations/telegram') ||
        ref.resolved.includes('platform/tauri'),
    )
    expect(found).toEqual([])
  })

  it('reaches the assistant only through the application facade', () => {
    // Components go through the hook; the hook goes through `services/`. No
    // part of the screen assembles the pipeline itself, so there is one
    // assembly rather than two that can drift apart.
    const components = IMPORTS.filter(
      (ref) =>
        ref.file.startsWith('src/features/ai/') &&
        !ref.file.includes('/hooks/') &&
        !ref.typeOnly &&
        targets(ref, 'src/services'),
    ).map((ref) => `${ref.file} imports ${ref.spec}`)

    expect(components).toEqual([])
  })

  it('never lets the screen name a provider or a credential', () => {
    for (const file of walk(join(SRC, 'features', 'ai'))) {
      const code = codeOf(file)
      for (const banned of [
        'groq',
        'api.groq.com',
        'apiKey',
        'Authorization',
        'Bearer',
        'fetch(',
      ]) {
        expect(code, `${file} must not name ${banned}`).not.toContain(banned)
      }
    }
  })

  it('executes an AI action from exactly one place, and it is the gate', () => {
    // Restated at the UI boundary: adding a screen must not add a second way
    // for a proposal to become a mutation.
    const callers = IMPORTS.filter(
      (ref) =>
        !/\.test\.tsx?$/.test(ref.file) &&
        ref.file.startsWith('src/') &&
        ref.resolved === 'src/services/commands/commandExecutor' &&
        ref.file.startsWith('src/services/ai/'),
    ).map((ref) => ref.file)

    expect([...new Set(callers)]).toEqual(['src/services/ai/aiConfirmationService.ts'])
  })

  it('lets Telegram reach the assistant only through the application facade', () => {
    /*
     * M15.7's boundary. The chat adapter may ask the assistant a question and
     * confirm a proposal; it must not assemble the pipeline itself. A second
     * assembly here would be a second set of rules about what a model may see
     * and do — for a transport that anyone with the bot's number can reach.
     */
    const telegram = IMPORTS.filter((ref) => ref.file === 'src/services/telegramService.ts').map(
      (ref) => ref.resolved,
    )

    expect(telegram).toContain('src/services/ai/aiAssistantService')
    expect(telegram).toContain('src/services/ai/aiConfirmationService')

    // Not the pieces the facade already composes.
    for (const forbidden of [
      'src/ai/aiPrompt',
      'src/ai/aiResponseParser',
      'src/ai/context/aiContextBuilder',
      'src/ai/context/aiContextPurpose',
      'src/ai/bridge/aiIntentBridge',
      'src/services/ai/aiReadModel',
      'src/services/ai/aiEntityLookup',
    ]) {
      expect(telegram, `Telegram must not rebuild ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('never calls a provider or reads a credential from the chat adapter', () => {
    const code = codeOf(join(SRC, 'services', 'telegramService.ts'))
    for (const banned of ['platform.ai.complete', 'groq', 'apiKey', 'Authorization', 'fetch(']) {
      expect(code, `Telegram must not use ${banned}`).not.toContain(banned)
    }
  })

  it('gives Telegram no way around the confirmation gate', () => {
    /*
     * Telegram still calls `execute` for its own M14 commands — that is M14, and
     * it is unchanged. What must not exist is an *assistant* action reaching the
     * executor from here: every AI mutation goes through `confirmAiAction`.
     */
    const code = codeOf(join(SRC, 'services', 'telegramService.ts'))
    expect(code).toContain('confirmAiAction')

    // The AI helpers hand ids to the gate; none of them executes.
    const aiSection = code.slice(code.indexOf('async function aiReply'))
    const helpers = aiSection.slice(
      0,
      aiSection.indexOf('export async function processTelegramMessage'),
    )
    for (const banned of ['execute(', 'executeText(', 'resolveChoice(']) {
      expect(helpers, `the assistant helpers must not call ${banned}`).not.toContain(banned)
    }
  })

  it('keeps the assistant ignorant of Telegram, still', () => {
    // The other direction, restated now that a transport calls in: `src/ai`
    // gained no knowledge of who is asking.
    const found = violations(
      (file) => inLayer(file, 'src/ai/'),
      (ref) => /telegram/i.test(ref.spec) || ref.resolved.includes('telegram'),
    )
    expect(found).toEqual([])
  })

  it('has no autonomous loop, timer or self-trigger anywhere in the AI feature', () => {
    /*
     * M15.8's hard boundary, checked structurally rather than argued.
     *
     * An assistant that can plan is one step from an assistant that plans, acts,
     * inspects the result and plans again. Nothing in this feature may schedule
     * itself, wake itself, or call the provider from a loop — so the timers and
     * the loop keywords are simply absent from the layer.
     */
    const files = [
      ...walk(join(SRC, 'ai')),
      ...walk(join(SRC, 'services', 'ai')),
      ...walk(join(SRC, 'features', 'ai')),
    ]
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const code = codeOf(file)
      for (const banned of [
        'setInterval',
        'setTimeout',
        'requestAnimationFrame',
        'queueMicrotask',
        'cron',
      ]) {
        expect(code, `${file} must not schedule itself (${banned})`).not.toContain(banned)
      }
    }

    /*
     * Loops are *not* banned outright — `enforceBudget` shrinks a context by
     * dropping one task at a time, which is a bounded loop over a shrinking
     * array and exactly the right shape. What must not exist is a loop anywhere
     * near the provider, so the one file that can call it carries none.
     */
    const caller = codeOf(join(SRC, 'services', 'ai', 'aiAssistantService.ts'))
    for (const loop of ['while (', 'while(', 'for (;;', 'do {']) {
      expect(caller, `the provider caller must not loop (${loop})`).not.toContain(loop)
    }
  })

  it('asks the provider from exactly one place', () => {
    // One call site means "one request per question" is a property of the code
    // rather than a habit. A second caller is how recursive planning starts.
    const callers = walk(SRC)
      .filter((file) => codeOf(file).includes('platform.ai.complete'))
      .map((file) => posix.normalize(relative(ROOT, file).split('\\').join('/')))

    expect(callers).toEqual(['src/services/ai/aiAssistantService.ts'])
  })

  it('is entered only by a transport, never by the pipeline itself', () => {
    /*
     * `askAi` is the entry point, and only a transport may pull it: the UI hook
     * and the chat adapter. If anything downstream — the parser, the resolver,
     * the gate — could call back in, a failed step would be one edit away from
     * an automatic replan.
     *
     * Matched on the call rather than the import, because the UI reaches it
     * through the services barrel and the path alone would miss that.
     */
    const callers = walk(SRC)
      .filter((file) => /\baskAi\(/.test(codeOf(file)))
      .map((file) => posix.normalize(relative(ROOT, file).split('\\').join('/')))
      .filter((file) => file !== 'src/services/ai/aiAssistantService.ts')

    expect(callers.sort()).toEqual([
      'src/features/ai/hooks/useAiAssistant.ts',
      'src/services/telegramService.ts',
    ])
  })

  it('keeps the plan checker pure', () => {
    // Plan-level validation runs before resolution and must stay a function of
    // the plan's own text: no database, no clock, no provider, no await.
    const code = codeOf(join(SRC, 'ai', 'bridge', 'aiPlanCheck.ts'))
    for (const banned of ['await ', 'async ', 'platform.', 'Date.', 'Math.random']) {
      expect(code, `the plan checker must not use ${banned}`).not.toContain(banned)
    }
  })

  it('never persists the key: the backup format has no field for one', () => {
    // The same structural argument M14 makes. The backup exports Dexie stores,
    // and the key is not in Dexie — it is in the OS credential store.
    const settings = readFileSync(join(SRC, 'types', 'entities.ts'), 'utf8')
    const block = settings.slice(settings.indexOf('export interface Settings'))
    expect(block.slice(0, block.indexOf('}'))).not.toMatch(/groq|apiKey|aiModel|aiProvider/i)
  })

  it('makes no AI request from the browser', () => {
    const browser = readFileSync(join(SRC, 'platform', 'browser', 'nullAi.ts'), 'utf8')
    expect(browser).toContain('isAvailable: false')
    expect(browser).not.toContain('fetch(')
    expect(browser).not.toContain('api.groq.com')

    // And nothing outside the native provider names the endpoint at all.
    for (const file of walk(SRC)) {
      expect(readFileSync(file, 'utf8'), `${file} must not name the provider host`).not.toContain(
        'api.groq.com',
      )
    }
  })

  it('adds no capability to reach the network from the WebView', () => {
    // M15.1 sends its requests from Rust, so the renderer needs no new
    // permission. If this ever gains `http`, the provider stopped being the
    // only way out.
    const capabilities = JSON.parse(
      readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    ) as { permissions: string[] }

    for (const permission of capabilities.permissions) {
      for (const banned of ['http', 'shell', 'process', 'fs:']) {
        expect(permission, `capability ${permission} is broader than M15.1 needs`).not.toContain(
          banned,
        )
      }
    }
  })

  it('keeps the Telegram secret behaviour exactly as M14 left it', () => {
    // The allowlist grew by one entry. It must not have grown a wildcard, and
    // the Telegram entry must still be there.
    const secrets = readFileSync(join(RUST, 'secrets.rs'), 'utf8')
    const line = secrets.slice(secrets.indexOf('const KNOWN_KEYS'))
    const list = line.slice(0, line.indexOf(';'))

    expect(list).toContain('"telegram.botToken"')
    expect(list).toContain('"ai.groq.apiKey"')
    expect(list).not.toContain('*')
    // Still no way to read a secret out of the process.
    expect(secrets).not.toMatch(/#\[tauri::command\]/)
  })
})

describe('duplicated knowledge stays in step', () => {
  it('agrees on the store list between db/ and the backup format', () => {
    expect([...STORE_NAMES_FOR_BACKUP]).toEqual([...STORE_NAMES])
  })

  it('agrees on the task routes between app/ and the view definitions', () => {
    // `app/` may not import a service value, so the shortcut layer keeps its own
    // copy of the task routes. This is what stops the two drifting.
    expect([...TASK_ROUTES].sort()).toEqual(
      TASK_VIEW_IDS.map((view) => TASK_VIEW_PATHS[view]).sort(),
    )
  })
})
