import type { DateStr } from '@/types/entities'

/**
 * Where a note will live in an Obsidian vault.
 *
 * M9 performs no file system I/O at all. What it does is fix the *contract*: a
 * note reserves its vault location the moment it is created, so when M12 gains
 * the ability to write files there is nothing to backfill and no migration to
 * run. A path assigned today is the path the file gets later.
 *
 * This module is a pure transform — no Dexie, no clock, no React — which is
 * what lets the rules below be asserted directly rather than through a UI.
 */

/** The folder every note lives under. One place, so M12 cannot disagree. */
export const VAULT_NOTES_FOLDER = 'notes'
export const VAULT_EXTENSION = '.md'
/**
 * The PDF extension, named once beside the Markdown one.
 *
 * A vault holds two kinds of document Vaultwork can read, and the *only*
 * difference the path layer cares about is which suffix a path must end in.
 * Everything else — traversal, drive letters, NUL bytes, empty segments — is
 * identical, and deliberately shared rather than reimplemented per type.
 */
export const VAULT_PDF_EXTENSION = '.pdf'

/** Characters a file name may not carry on Windows, macOS or Linux. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g

/**
 * Reserved base names on Windows. A file called `CON.md` cannot be created
 * there, and a vault is expected to be portable across machines.
 */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** How long one path segment may be. Well under every filesystem's limit. */
const MAX_SEGMENT = 80

/**
 * A title turned into a file-safe, URL-safe segment.
 *
 * Lower case with hyphens, which is what makes `notes/dsa/binary-search.md`
 * read the way the milestone specifies. Accents are folded rather than
 * stripped, so "Résumé" becomes "resume" instead of "rsum".
 */
export function slugify(value: string): string {
  const folded = value
    .normalize('NFKD')
    // Combining marks, left behind by NFKD, are dropped so "é" -> "e".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  const slug = folded
    .replace(ILLEGAL, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/g, '')

  if (slug.length === 0) return 'untitled'
  return RESERVED.has(slug) ? `${slug}-note` : slug
}

export interface VaultPathInput {
  title: string
  /** Tag names, lower-cased by the caller or not — the first becomes a folder. */
  tags?: string[] | undefined
  /** Disambiguates two notes that slug identically. */
  createdOn?: DateStr | undefined
}

/**
 * The vault path a note reserves.
 *
 *   notes/<first tag>/<title>.md      when the note carries a tag
 *   notes/<title>.md                  when it does not
 *
 * The first tag becomes the folder because that is how a vault is usually
 * organised, and because it is stable: renaming a note moves the file within
 * its folder rather than across the vault.
 */
export function buildVaultPath(input: VaultPathInput): string {
  const title = slugify(input.title)
  const folder = input.tags?.find((tag) => slugify(tag) !== 'untitled')
  const segments = [VAULT_NOTES_FOLDER]
  if (folder !== undefined) segments.push(slugify(folder))
  segments.push(`${title}${VAULT_EXTENSION}`)
  return segments.join('/')
}

/**
 * A vault path that no other note holds.
 *
 * Two notes both called "Ideas" would otherwise reserve the same file. The
 * suffix is numeric and applied to the *base name* so the extension stays last:
 * `notes/ideas-2.md`, never `notes/ideas.md-2`.
 */
export function uniqueVaultPath(desired: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const path of taken) used.add(path.toLowerCase())
  if (!used.has(desired.toLowerCase())) return desired

  const cut = desired.lastIndexOf(VAULT_EXTENSION)
  const base = cut === -1 ? desired : desired.slice(0, cut)

  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}${VAULT_EXTENSION}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${base}-${Date.now()}${VAULT_EXTENSION}`
}

/** True when a string is shaped like a path this module would produce. */
export function isVaultPath(value: string): boolean {
  return (
    value.startsWith(`${VAULT_NOTES_FOLDER}/`) &&
    value.endsWith(VAULT_EXTENSION) &&
    !value.includes('//') &&
    !value.includes('..')
  )
}

// ------------------------------------------------------------- path safety

export class UnsafeVaultPathError extends Error {
  readonly path: string

  constructor(path: string, reason: string) {
    super(`Unsafe vault path (${reason}): ${path}`)
    this.name = 'UnsafeVaultPathError'
    this.path = path
  }
}

/** Which suffix a path must carry, or `false` for a directory. */
type ExtensionRule = '.md' | '.pdf' | 'document' | false

/** The suffixes a rule accepts. `document` means either kind Vaultwork reads. */
function allowedExtensions(rule: ExtensionRule): string[] {
  if (rule === false) return []
  if (rule === 'document') return [VAULT_EXTENSION, VAULT_PDF_EXTENSION]
  return [rule]
}

/**
 * Why a path may not be used.
 *
 * Every filesystem operation runs this first. The vault directory handle is a
 * capability the user granted for *one folder*, and a path containing `..`
 * would spend that capability somewhere they never agreed to. The check is
 * therefore not a validation nicety — it is the boundary of the permission.
 */
function unsafeReason(path: string, rule: ExtensionRule = VAULT_EXTENSION): string | null {
  if (typeof path !== 'string' || path.trim().length === 0) return 'empty'

  // A backslash is a separator on Windows, so normalise before judging.
  const candidate = path.replace(/\\/g, '/')

  if (candidate.startsWith('/')) return 'absolute'
  // C:/… or any scheme-like prefix.
  if (/^[A-Za-z]:/.test(candidate)) return 'drive letter'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return 'url'

  const segments = candidate.split('/')
  if (segments.some((segment) => segment === '..')) return 'traversal'
  if (segments.some((segment) => segment === '')) return 'empty segment'
  if (segments.some((segment) => segment === '.')) return 'relative segment'

  // A NUL byte truncates a path in some native filesystem layers.
  if (candidate.includes('\0')) return 'null byte'
  // Percent-encoded traversal, in case a path arrived from a URL.
  if (/%2e%2e/i.test(candidate)) return 'encoded traversal'

  const suffixes = allowedExtensions(rule)
  if (suffixes.length > 0) {
    const lowered = candidate.toLowerCase()
    // Case-insensitive: `.PDF` and `.Pdf` are the same file to every filesystem
    // this runs on, and a vault written by hand contains all three spellings.
    if (!suffixes.some((suffix) => lowered.endsWith(suffix))) {
      return rule === VAULT_PDF_EXTENSION
        ? 'not a pdf file'
        : rule === 'document'
          ? 'not a markdown or pdf file'
          : 'not a markdown file'
    }
  }

  return null
}

export interface VaultPathOptions {
  /** Which suffix to insist on. Defaults to Markdown, as it always did. */
  extension?: ExtensionRule
}

/** True when a path is safe to hand to the filesystem adapter. */
export function isSafeVaultPath(path: string, options: VaultPathOptions = {}): boolean {
  return unsafeReason(path, options.extension ?? VAULT_EXTENSION) === null
}

/**
 * Returns the path, or throws.
 *
 * Used at the top of every adapter call, so an unsafe path cannot reach a
 * filesystem API through any route — including one that has not been written
 * yet.
 */
export function assertSafeVaultPath(path: string, options: VaultPathOptions = {}): string {
  const reason = unsafeReason(path, options.extension ?? VAULT_EXTENSION)
  if (reason !== null) throw new UnsafeVaultPathError(path, reason)
  return path.replace(/\\/g, '/')
}

/**
 * The same check, for a *directory* argument.
 *
 * `assertSafeVaultPath` insists on a `.md` extension, which is correct for a
 * file and wrong for `notes/dsa` — a legitimate argument to `createDirectory`
 * and `listDirectory`. Every other rule is shared, so a directory cannot be a
 * route around traversal that a file path would have been refused for.
 *
 * The browser adapter never needed this: the File System Access API resolves a
 * directory one named segment at a time and throws on `..` itself. A native
 * filesystem offers no such protection, which is why the check has to be
 * explicit on this side of the port.
 */
export function assertSafeVaultDirectory(path: string): string {
  const reason = unsafeReason(path, false)
  if (reason !== null) throw new UnsafeVaultPathError(path, reason)
  return path.replace(/\\/g, '/')
}

/** True when a directory path is safe to hand to a filesystem adapter. */
export function isSafeVaultDirectory(path: string): boolean {
  return unsafeReason(path, false) === null
}

/** The directory segments a path needs, outermost first. `[]` for a root file. */
export function parentDirectories(path: string): string[] {
  const segments = assertSafeVaultPath(path).split('/')
  segments.pop()

  const directories: string[] = []
  let current = ''
  for (const segment of segments) {
    current = current.length === 0 ? segment : `${current}/${segment}`
    directories.push(current)
  }
  return directories
}
