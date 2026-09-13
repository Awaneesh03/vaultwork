import { normalizeContent } from './content'
import {
  EMPTY_FRONTMATTER,
  parseFrontmatter,
  serializeFrontmatter,
  type Frontmatter,
} from './frontmatter'

/**
 * A note, as a file in a vault — and back again.
 *
 * Pure: no Dexie, no filesystem, no React, no clock. Everything it needs is an
 * argument, which is what lets the whole round trip be asserted directly.
 *
 * The Markdown body is carried through *verbatim*. Nothing here renders,
 * reformats or re-wraps it — the body the user typed is the body written to
 * disk, because a serializer that "tidies" Markdown produces a diff on every
 * export and therefore a conflict on every export.
 */

/** The note fields a file carries. Narrow on purpose. */
export interface SerializableNote {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface SerializeOptions {
  /** Tag *names*, resolved by the caller — the file has no id vocabulary. */
  tags?: string[] | undefined
  /**
   * Frontmatter read from the file this export will replace.
   *
   * Supplying it is what preserves `aliases`, `cssclasses` and every other key
   * the user or a plugin added. Omitting it writes a fresh block, which is
   * correct only when the file does not exist yet.
   */
  existing?: Frontmatter | undefined
}

/** ISO-8601 in UTC. A stable, sortable, unambiguous instant. */
export function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

export function fromIso(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Note -> Obsidian Markdown.
 *
 * The output is canonical: a fixed key order, LF endings and exactly one
 * trailing newline, so serialising the same note twice is byte-identical. That
 * stability is what makes a content hash meaningful.
 */
export function serializeNote(note: SerializableNote, options: SerializeOptions = {}): string {
  const frontmatter: Frontmatter = {
    ...EMPTY_FRONTMATTER,
    // Unknown keys from the file being replaced are carried over untouched.
    unknown: options.existing?.unknown ?? [],
    id: note.id,
    title: note.title,
    created: toIso(note.createdAt),
    updated: toIso(note.updatedAt),
    tags: options.tags ?? [],
  }

  const block = serializeFrontmatter(frontmatter)
  const body = note.body.replace(/\r\n?/g, '\n').replace(/^\n+/, '')

  return normalizeContent(`${block}\n\n${body}`)
}

export interface ParsedNoteFile {
  /** `null` when the file carries no Vaultwork id — an unmanaged note. */
  id: string | null
  title: string | null
  createdAt: number | null
  updatedAt: number | null
  tags: string[]
  body: string
  frontmatter: Frontmatter
  hadFrontmatter: boolean
}

/**
 * Obsidian Markdown -> a note-shaped value.
 *
 * Never throws on malformed input. A file whose frontmatter is nonsense is
 * still a file full of the user's writing, and refusing to read it would be
 * worse than reading it without metadata — so an unparseable block degrades to
 * "no frontmatter" and the whole text becomes the body.
 */
export function parseNoteFile(source: string): ParsedNoteFile {
  const document = parseFrontmatter(source)
  const { frontmatter } = document

  return {
    id: frontmatter.id,
    title: frontmatter.title,
    createdAt: fromIso(frontmatter.created),
    updatedAt: fromIso(frontmatter.updated),
    tags: frontmatter.tags,
    body: normalizeContent(document.body),
    frontmatter,
    hadFrontmatter: document.hadFrontmatter,
  }
}

/**
 * A title for a file that did not supply one.
 *
 * Falls back to the file name, which is what Obsidian itself uses — a vault is
 * full of notes whose identity is their filename and nothing else.
 */
export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  const withoutExtension = base.replace(/\.md$/i, '')
  return withoutExtension.trim().length > 0 ? withoutExtension : 'Untitled note'
}

// ------------------------------------------------------- comparable content

export interface ComparableNote {
  title: string
  tags: string[]
  body: string
}

/**
 * The canonical projection two sides are compared on.
 *
 * Conflict detection must not compare raw file bytes, for two reasons that
 * both produce false conflicts:
 *
 *  - **Unknown frontmatter belongs to the user.** An export preserves the
 *    `aliases` and `cssclasses` it found in the file, which means the bytes
 *    Vaultwork would write depend on what the file currently says. Comparing
 *    bytes would therefore make an external edit change *both* sides at once
 *    and report a conflict where there is only an external change.
 *
 *  - **`updated` moves on every keystroke.** A timestamp that changes whenever
 *    the note is touched would make every note permanently "changed".
 *
 * So the projection is exactly what Vaultwork manages and a human would call
 * the content: title, tags and body. A change to only the user's own
 * frontmatter is invisible to sync status — which is correct, because
 * Vaultwork never claimed to own it and an export preserves it either way.
 */
export function comparableContent(input: ComparableNote): string {
  const tags = [...input.tags].sort().join(',')
  return normalizeContent(
    ['title: ' + input.title.trim(), 'tags: ' + tags, '', input.body].join('\n'),
  )
}

/** The projection of a note. */
export function comparableFromNote(note: SerializableNote, tags: string[]): string {
  return comparableContent({ title: note.title, tags, body: note.body })
}

/** The projection of a file on disk. */
export function comparableFromFile(source: string, fallbackTitle: string): string {
  const parsed = parseNoteFile(source)
  return comparableContent({
    title: parsed.title ?? fallbackTitle,
    tags: parsed.tags,
    body: parsed.body,
  })
}
