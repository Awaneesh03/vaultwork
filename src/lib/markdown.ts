/**
 * Markdown, as a parser rather than a renderer.
 *
 * This produces a small typed tree; the component layer turns that tree into
 * React elements. That split is the whole security design: nothing here emits
 * an HTML string, so nothing downstream needs `dangerouslySetInnerHTML`, and a
 * note whose body is `<img onerror=...>` renders as the *text* `<img
 * onerror=...>` because it becomes a text node. XSS is not sanitised away here
 * — it is unrepresentable, which is a much stronger guarantee than a filter.
 *
 * The grammar is deliberately closed, and matches exactly what a note needs:
 * headings, bold, italic, inline code, fenced code, links, and the three list
 * kinds (unordered, ordered, checkbox). There is no custom syntax and no
 * extension point. Anything unrecognised stays as literal text rather than
 * being dropped, which is the same promise the Quick Add parser makes.
 */

export type Inline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; content: Inline[] }
  | { kind: 'em'; content: Inline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; content: Inline[] }

export interface ListItem {
  /** `null` for a plain bullet; a boolean for `- [ ]` / `- [x]`. */
  checked: boolean | null
  content: Inline[]
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'code'; language: string | null; code: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }

// ------------------------------------------------------------------- safety

/**
 * Schemes a link may use.
 *
 * Rendering to React elements stops injected markup, but it does not stop
 * `[click](javascript:alert(1))` — that is a legitimate-looking anchor whose
 * href executes. An unsafe scheme is dropped to `#`, so the link still renders
 * as text the user can read and simply goes nowhere.
 */
const SAFE_SCHEME = /^(https?:|mailto:)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function safeHref(raw: string): string {
  const href = raw.trim()
  if (href.length === 0) return '#'
  // A relative or fragment link names no scheme and cannot execute.
  if (!HAS_SCHEME.test(href)) return href
  return SAFE_SCHEME.test(href) ? href : '#'
}

// ------------------------------------------------------------------- inline

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '-', '!', '.'])

/** Merges adjacent text nodes so the tree has no needless fragmentation. */
function pushText(out: Inline[], value: string): void {
  if (value.length === 0) return
  const last = out[out.length - 1]
  if (last && last.kind === 'text') last.value += value
  else out.push({ kind: 'text', value })
}

/**
 * Finds the index of a closing delimiter, respecting backslash escapes.
 * Returns -1 when the run is never closed, in which case the opener is treated
 * as literal text — an unterminated `**` should read as asterisks, not swallow
 * the rest of the note.
 */
function findClose(src: string, from: number, delimiter: string): number {
  for (let i = from; i <= src.length - delimiter.length; i += 1) {
    if (src[i] === '\\') {
      i += 1
      continue
    }
    if (src.startsWith(delimiter, i)) return i
  }
  return -1
}

/** The four emphasis delimiters, longest first so `**` beats `*`. */
const EMPHASIS = [
  { delimiter: '**', kind: 'strong' },
  { delimiter: '__', kind: 'strong' },
  { delimiter: '*', kind: 'em' },
  { delimiter: '_', kind: 'em' },
] as const

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)

/**
 * The closing delimiter of an emphasis run, applying CommonMark's flanking rule.
 *
 * A closer may not be *preceded* by whitespace. Without this, `2 * 3 * 4`
 * becomes "2  3  4" in italics, and a note containing arithmetic or a stray
 * separator silently reformats itself. The rule costs one check and removes a
 * whole class of surprise.
 */
function findEmphasisClose(src: string, from: number, delimiter: string): number {
  let i = from
  while (i <= src.length - delimiter.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src.startsWith(delimiter, i) && !isSpace(src[i - 1])) return i
    i += 1
  }
  return -1
}

/**
 * The emphasis run starting at `i`, or null if none does.
 *
 * Returning a value rather than mutating in place keeps the main loop a flat
 * sequence of "try this, else fall through to literal text" — which is what
 * makes an unterminated `**` degrade to asterisks instead of eating the rest
 * of the line.
 */
function emphasisAt(
  src: string,
  i: number,
): { kind: 'strong' | 'em'; inner: string; next: number } | null {
  for (const { delimiter, kind } of EMPHASIS) {
    if (!src.startsWith(delimiter, i)) continue
    // An opener may not be followed by whitespace, for the same reason a
    // closer may not be preceded by one.
    if (isSpace(src[i + delimiter.length])) continue

    const close = findEmphasisClose(src, i + delimiter.length, delimiter)
    // An empty run (`****`) is literal text, not an empty element.
    if (close === -1 || close === i + delimiter.length) continue
    return {
      kind,
      inner: src.slice(i + delimiter.length, close),
      next: close + delimiter.length,
    }
  }
  return null
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  let i = 0

  const emit = (node: Inline) => {
    pushText(out, text)
    text = ''
    out.push(node)
  }

  while (i < src.length) {
    const char = src[i] as string

    // A backslash escape makes the next character literal.
    if (char === '\\' && i + 1 < src.length && ESCAPABLE.has(src[i + 1] as string)) {
      text += src[i + 1]
      i += 2
      continue
    }

    // Inline code wins over everything: nothing nests inside it, which is what
    // makes `**not bold**` inside backticks render as literal asterisks.
    if (char === '`') {
      const close = src.indexOf('`', i + 1)
      if (close !== -1) {
        emit({ kind: 'code', value: src.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }

    // [label](href)
    if (char === '[') {
      const closeLabel = findClose(src, i + 1, ']')
      if (closeLabel !== -1 && src[closeLabel + 1] === '(') {
        const closeHref = findClose(src, closeLabel + 2, ')')
        if (closeHref !== -1) {
          emit({
            kind: 'link',
            href: safeHref(src.slice(closeLabel + 2, closeHref)),
            content: parseInline(src.slice(i + 1, closeLabel)),
          })
          i = closeHref + 1
          continue
        }
      }
    }

    const emphasis = emphasisAt(src, i)
    if (emphasis) {
      emit({ kind: emphasis.kind, content: parseInline(emphasis.inner) })
      i = emphasis.next
      continue
    }

    text += char
    i += 1
  }

  pushText(out, text)
  return out
}

// ------------------------------------------------------------------- blocks

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^```\s*([A-Za-z0-9+#._-]*)\s*$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^(\d{1,9})[.)]\s+(.*)$/
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/

function listItem(raw: string): ListItem {
  const box = CHECKBOX.exec(raw)
  if (box) {
    return {
      checked: (box[1] ?? ' ').toLowerCase() === 'x',
      content: parseInline(box[2] ?? ''),
    }
  }
  return { checked: null, content: parseInline(raw) }
}

/**
 * Splits a document into blocks.
 *
 * Line-based and deliberately simple: a blank line ends a paragraph, consecutive
 * bullets form one list, and a fence runs until its closing fence or the end of
 * the document. Lazy continuation and nested lists are not supported — see the
 * limitations note in the milestone report.
 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []

  let paragraph: string[] = []
  let items: ListItem[] = []
  let ordered = false
  let start = 1

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  const flushList = () => {
    if (items.length === 0) return
    blocks.push({ kind: 'list', ordered, start, items })
    items = []
  }

  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    const fence = FENCE.exec(line.trim())
    if (fence) {
      flush()
      const code: string[] = []
      i += 1
      // An unclosed fence runs to the end rather than discarding the content.
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        code.push(lines[i] ?? '')
        i += 1
      }
      blocks.push({
        kind: 'code',
        language: (fence[1] ?? '').length > 0 ? (fence[1] as string) : null,
        code: code.join('\n'),
      })
      continue
    }

    if (line.trim().length === 0) {
      flush()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2] ?? ''),
      })
      continue
    }

    const bullet = BULLET.exec(line.trimStart())
    if (bullet) {
      flushParagraph()
      if (items.length > 0 && ordered) flushList()
      ordered = false
      items.push(listItem(bullet[1] ?? ''))
      continue
    }

    const numbered = ORDERED.exec(line.trimStart())
    if (numbered) {
      flushParagraph()
      if (items.length > 0 && !ordered) flushList()
      if (items.length === 0) start = Number(numbered[1] ?? 1)
      ordered = true
      items.push(listItem(numbered[2] ?? ''))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flush()
  return blocks
}

// ------------------------------------------------------------ plain text

/** Flattens inline nodes back to their text, for search and previews. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.value
        default:
          return inlineText(node.content)
      }
    })
    .join('')
}

/**
 * A note's body with its markup removed.
 *
 * Used for the list preview and for search, so that searching "binary" matches
 * a note whose body says `**binary** search` — the user typed a word, not a
 * delimiter, and should not have to know how it was formatted.
 */
export function markdownToText(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      switch (block.kind) {
        case 'code':
          return block.code
        case 'list':
          return block.items.map((item) => inlineText(item.content)).join(' ')
        default:
          return inlineText(block.content)
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First non-empty line of text, for a one-line preview in the list. */
export function markdownExcerpt(source: string, limit = 140): string {
  const text = markdownToText(source)
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}

// -------------------------------------------------------------- interaction

/**
 * Flips the nth checkbox in a document, returning the new source.
 *
 * A rendered checkbox that cannot be ticked is worse than no checkbox at all —
 * it looks interactive and is not. Rather than have the renderer own a second
 * copy of the document, the toggle is expressed as a text edit: the markdown
 * stays the single source of truth, and the same autosave path that handles
 * typing handles ticking.
 *
 * `index` counts checkbox items only, in document order, which is exactly the
 * order the renderer assigns them. A source with no nth checkbox is returned
 * unchanged rather than throwing, because the document may have been edited in
 * another tab between render and click.
 */
export function toggleCheckbox(source: string, index: number): string {
  const lines = source.split('\n')
  let seen = -1
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    // A `- [ ]` inside a code block is a literal, not a checkbox.
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/.exec(line)
    if (!match) continue

    seen += 1
    if (seen !== index) continue

    const checked = (match[2] ?? ' ').toLowerCase() === 'x'
    lines[i] = `${match[1]}${checked ? ' ' : 'x'}${match[3]}`
    return lines.join('\n')
  }

  return source
}

// ----------------------------------------------------------------- headings

/**
 * The anchor id for a heading.
 *
 * Shared by the renderer (which stamps it onto the element) and by wikilink
 * resolution (which looks for it), so a `[[Note#Heading]]` cannot drift out of
 * step with the heading it names. Two implementations of this would be two
 * chances to disagree about what "Recursion" means.
 *
 * Deliberately lenient: case, punctuation and spacing are all normalised away,
 * because a person typing a heading into a link is recalling it, not copying
 * it byte for byte.
 */
export function headingSlug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface HeadingRef {
  level: number
  text: string
  slug: string
}

/** Every heading in a document, in order. Used to resolve `#fragment` links. */
export function documentHeadings(source: string): HeadingRef[] {
  return parseMarkdown(source)
    .filter((block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading')
    .map((block) => {
      const text = inlineText(block.content)
      return { level: block.level, text, slug: headingSlug(text) }
    })
}
