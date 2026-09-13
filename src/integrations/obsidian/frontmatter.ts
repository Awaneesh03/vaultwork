/**
 * YAML frontmatter, read and written.
 *
 * A deliberately small YAML subset — scalars, quoted strings and string lists —
 * because that is all a note's metadata needs and a full YAML implementation
 * would be a large dependency with a large attack surface for a block of text
 * the user rarely looks at.
 *
 * The rule that shapes this file is **do not destroy what you do not
 * understand.** An Obsidian vault is the user's, and their notes carry keys
 * this application has never heard of: `aliases`, `cssclasses`, `publish`,
 * whatever a plugin invented last week. Parsing therefore keeps every key it
 * cannot interpret, verbatim and in its original order, and writing puts them
 * back. Vaultwork owns its own keys and is a guest among the rest.
 */

/** The keys Vaultwork claims. Everything else belongs to the user. */
export const OWNED_KEYS = ['id', 'title', 'created', 'updated', 'tags'] as const

export interface Frontmatter {
  /** Parsed values for the keys Vaultwork understands. */
  id: string | null
  title: string | null
  created: string | null
  updated: string | null
  tags: string[]
  /**
   * Every other key, as raw YAML lines, in the order they appeared.
   *
   * Kept as text rather than parsed values on purpose: re-emitting a value this
   * module never understood is how formatting gets mangled. Handing the
   * original lines back is lossless.
   */
  unknown: string[]
}

export interface ParsedDocument {
  frontmatter: Frontmatter
  /** Everything after the closing delimiter. */
  body: string
  /** False when the file had no frontmatter block at all. */
  hadFrontmatter: boolean
}

export const EMPTY_FRONTMATTER: Frontmatter = {
  id: null,
  title: null,
  created: null,
  updated: null,
  tags: [],
  unknown: [],
}

const DELIMITER = '---'

/** Strips one layer of matching quotes, and unescapes what we escape. */
function unquote(value: string): string {
  const text = value.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = text.slice(1, -1)
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
    }
  }
  return text
}

/**
 * Quotes a scalar when YAML would otherwise misread it.
 *
 * Always quoting would be simpler but produces a diff against every file an
 * Obsidian user wrote by hand, and a spurious diff is a spurious conflict.
 */
function quote(value: string): string {
  if (value.length === 0) return '""'
  // Anything that could be read as a number, boolean, null, or that carries
  // YAML punctuation, gets quoted; a plain word does not.
  if (/^[A-Za-z][A-Za-z0-9 _.\-/]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) {
    return value
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Splits `key: value`, returning null for a line that is not a mapping. */
function splitKey(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z0-9_][A-Za-z0-9_\-.]*)\s*:(.*)$/.exec(line)
  if (!match) return null
  return { key: match[1] as string, value: (match[2] ?? '').trim() }
}

/** `[a, b]` or `[]`, the inline form Obsidian writes for short lists. */
function parseInlineList(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null
  const inner = value.slice(1, -1).trim()
  if (inner.length === 0) return []
  return inner
    .split(',')
    .map((part) => unquote(part))
    .filter((part) => part.length > 0)
}

/**
 * Splits a document into its frontmatter and body.
 *
 * A file with no frontmatter is not an error: it is an ordinary Markdown note
 * that has never met Vaultwork, and importing it is exactly the case the
 * milestone asks to support.
 */
export function parseFrontmatter(source: string): ParsedDocument {
  const text = source.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
  const none = (): ParsedDocument => ({
    frontmatter: { ...EMPTY_FRONTMATTER, tags: [], unknown: [] },
    body: text,
    hadFrontmatter: false,
  })

  // A file with no frontmatter is not an error: it is an ordinary Markdown
  // note that has never met Vaultwork, which is exactly the import case.
  if (!text.startsWith(`${DELIMITER}\n`)) return none()

  const lines = text.split('\n')

  // An unterminated block is treated as no block at all, rather than swallowing
  // the entire note into metadata.
  let close = -1
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trimEnd() === DELIMITER) {
      close = i
      break
    }
  }
  if (close === -1) return none()

  const frontmatter: Frontmatter = { ...EMPTY_FRONTMATTER, tags: [], unknown: [] }
  const owned = new Set<string>(OWNED_KEYS)

  // Which key the current `- item` run belongs to. Tracked explicitly, because
  // guessing from the previous line breaks as soon as two lists are adjacent.
  let openList: { key: string; owned: boolean } | null = null

  for (let i = 1; i < close; i += 1) {
    const line = lines[i] ?? ''

    if (/^\s*-\s/.test(line)) {
      if (openList === null) {
        // A list item with no key above it is malformed; keep it rather than
        // silently drop the user's text.
        frontmatter.unknown.push(line)
      } else if (openList.owned && openList.key === 'tags') {
        frontmatter.tags.push(unquote(line.replace(/^\s*-\s*/, '')))
      } else {
        frontmatter.unknown.push(line)
      }
      continue
    }

    const pair = splitKey(line)
    if (!pair) {
      openList = null
      if (line.trim().length > 0) frontmatter.unknown.push(line)
      continue
    }

    const isOwned = owned.has(pair.key)
    // A key with an empty value opens a block list on the next lines.
    openList = pair.value.length === 0 ? { key: pair.key, owned: isOwned } : null

    if (!isOwned) {
      frontmatter.unknown.push(line)
      continue
    }

    switch (pair.key) {
      case 'id':
        frontmatter.id = unquote(pair.value) || null
        break
      case 'title':
        frontmatter.title = unquote(pair.value) || null
        break
      case 'created':
        frontmatter.created = unquote(pair.value) || null
        break
      case 'updated':
        frontmatter.updated = unquote(pair.value) || null
        break
      case 'tags': {
        const inline = parseInlineList(pair.value)
        if (inline !== null) frontmatter.tags = inline
        else if (pair.value.length > 0) frontmatter.tags = [unquote(pair.value)]
        // An empty value leaves `openList` pointing here for the items below.
        break
      }
    }
  }

  return {
    frontmatter,
    body: lines
      .slice(close + 1)
      .join('\n')
      .replace(/^\n/, ''),
    hadFrontmatter: true,
  }
}

/**
 * Renders a frontmatter block.
 *
 * Vaultwork's own keys come first, in a fixed order, so two exports of the same
 * note are byte-identical — a stable field order is what stops the hash moving
 * for no reason. The user's own keys follow, untouched and in their original
 * order.
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = [DELIMITER]

  // `id` is always quoted, unlike the other scalars. It is an opaque
  // identifier, and quoting it only when it happens to start with a digit
  // makes two notes' files differ in shape for no reason — on a field that is
  // the whole identity contract.
  if (frontmatter.id !== null) lines.push(`id: "${frontmatter.id.replace(/"/g, '\\"')}"`)
  if (frontmatter.title !== null) lines.push(`title: ${quote(frontmatter.title)}`)
  if (frontmatter.created !== null) lines.push(`created: ${quote(frontmatter.created)}`)
  if (frontmatter.updated !== null) lines.push(`updated: ${quote(frontmatter.updated)}`)

  if (frontmatter.tags.length > 0) {
    lines.push('tags:')
    for (const tag of frontmatter.tags) lines.push(`  - ${quote(tag)}`)
  }

  for (const line of frontmatter.unknown) lines.push(line)

  lines.push(DELIMITER)
  return lines.join('\n')
}
