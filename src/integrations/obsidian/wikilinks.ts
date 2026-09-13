/**
 * Obsidian wikilinks.
 *
 * `[[Target]]`, `[[Target|shown text]]`, `[[Target#heading]]`. Parsed here and
 * *only* parsed — resolving a target to a note is a database question and lives
 * in the service layer, because this module has no idea what notes exist.
 *
 * Two rules the milestone is explicit about:
 *
 *  - An ordinary Markdown link `[text](url)` is not a wikilink. The single
 *    bracket form belongs to `lib/markdown.ts` and must not be captured here.
 *  - An unresolved wikilink stays unresolved. Nothing in this feature invents a
 *    note because someone typed a name that does not exist yet — a vault is
 *    full of links to notes the user has not written, and silently creating
 *    them would fill the database with ghosts.
 */

export interface Wikilink {
  /** The raw text between the brackets, before `|` or `#`. */
  target: string
  /** The label after `|`, when the link has one. */
  alias: string | null
  /** The `#heading` fragment, when present. */
  heading: string | null
  /** Character offset of the opening `[[`, for de-duplication and ordering. */
  index: number
  /** The whole `[[...]]` span, so a caller can replace it exactly. */
  raw: string
}

/**
 * `[[` … `]]` with no nested brackets inside.
 *
 * Requiring a non-`]` run is what stops `[[a]] and [[b]]` being read as one
 * enormous link, and the leading `(?<!\[)` guard is unnecessary because a
 * Markdown link's single bracket can never start this pattern.
 */
const WIKILINK = /\[\[([^[\]]+)\]\]/g

/** Fenced and inline code, whose contents are literal text, not links. */
const CODE_SPANS = /```[\s\S]*?```|`[^`\n]*`/g

/**
 * Every wikilink in a document, in the order it appears.
 *
 * Links inside code spans are skipped: a note explaining wikilink syntax should
 * not acquire a relationship because it quoted one.
 */
export function parseWikilinks(source: string): Wikilink[] {
  // Blank out code spans, preserving length so offsets stay meaningful.
  const masked = source.replace(CODE_SPANS, (span) => ' '.repeat(span.length))

  const links: Wikilink[] = []
  for (const match of masked.matchAll(WIKILINK)) {
    const inner = match[1] ?? ''
    const index = match.index ?? 0

    const [beforeAlias, ...aliasParts] = inner.split('|')
    const alias = aliasParts.length > 0 ? aliasParts.join('|').trim() : null

    const [beforeHeading, ...headingParts] = (beforeAlias ?? '').split('#')
    const heading = headingParts.length > 0 ? headingParts.join('#').trim() : null

    const target = (beforeHeading ?? '').trim()
    // `[[|alias]]` and `[[#heading]]` name no note.
    if (target.length === 0) continue

    links.push({
      target,
      alias: alias !== null && alias.length > 0 ? alias : null,
      heading: heading !== null && heading.length > 0 ? heading : null,
      index,
      raw: match[0],
    })
  }

  return links
}

/** The distinct targets a document links to, in first-appearance order. */
export function wikilinkTargets(source: string): string[] {
  const seen = new Set<string>()
  const targets: string[] = []

  for (const link of parseWikilinks(source)) {
    const key = link.target.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(link.target)
  }

  return targets
}

/**
 * How Vaultwork writes a link to another note.
 *
 * By **title**, which is what Obsidian itself resolves and what a human reads.
 * The alternative — writing the note's uuid — would survive renames but produce
 * `[[9f3c…]]` in a document the user has to read, and Obsidian would not
 * resolve it to anything.
 *
 * The consequence is stated rather than hidden: a wikilink written by title
 * breaks when that note is renamed, exactly as it does for a note written by
 * hand in Obsidian. That is acceptable *because the link is not the
 * relationship* — `noteLinks` is, keyed by id, and it is unaffected by any
 * rename. The wikilink is a convenience for reading the file in Obsidian; the
 * database keeps the durable edge.
 */
export function formatWikilink(title: string, alias?: string | null): string {
  const target = title
    .replace(/[[\]|#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const safeTarget = target.length > 0 ? target : 'Untitled note'
  return alias && alias.length > 0 ? `[[${safeTarget}|${alias}]]` : `[[${safeTarget}]]`
}

export type WikilinkResolution =
  | { status: 'resolved'; noteId: string; title: string }
  | { status: 'unresolved'; target: string }
  | { status: 'ambiguous'; target: string; noteIds: string[] }

export interface ResolvableNote {
  id: string
  title: string
  vaultPath: string | null
}

/**
 * Matches a wikilink target against the notes that exist.
 *
 * Three ways a target can be recognised, tried in order of how certain they
 * are: an exact note id, an exact vault path or file name, then a
 * case-insensitive title. A target matching several notes is reported as
 * ambiguous rather than resolved to whichever came first — guessing is how a
 * link ends up pointing at the wrong note.
 */
export function resolveWikilink(target: string, notes: ResolvableNote[]): WikilinkResolution {
  const byId = notes.find((note) => note.id === target)
  if (byId) return { status: 'resolved', noteId: byId.id, title: byId.title }

  const needle = target.toLowerCase().replace(/\.md$/i, '')

  const byPath = notes.filter((note) => {
    if (note.vaultPath === null) return false
    const path = note.vaultPath.toLowerCase()
    const base = (path.split('/').pop() ?? '').replace(/\.md$/i, '')
    return path.replace(/\.md$/i, '') === needle || base === needle
  })
  if (byPath.length === 1) {
    const note = byPath[0] as ResolvableNote
    return { status: 'resolved', noteId: note.id, title: note.title }
  }

  const byTitle = notes.filter((note) => note.title.toLowerCase().trim() === needle)
  if (byTitle.length === 1) {
    const note = byTitle[0] as ResolvableNote
    return { status: 'resolved', noteId: note.id, title: note.title }
  }

  const candidates = byPath.length > 1 ? byPath : byTitle
  if (candidates.length > 1) {
    return { status: 'ambiguous', target, noteIds: candidates.map((note) => note.id) }
  }

  return { status: 'unresolved', target }
}
