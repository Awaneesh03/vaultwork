import { describe, expect, it } from 'vitest'
import {
  markdownExcerpt,
  markdownToText,
  toggleCheckbox,
  parseInline,
  parseMarkdown,
  safeHref,
  type Block,
  type Inline,
} from './markdown'

/**
 * The markdown grammar.
 *
 * Two families matter most: the *degradation* cases, where malformed input must
 * survive as literal text rather than swallowing the document, and the *safety*
 * cases, where a link tries to carry a scheme that executes.
 */

const text = (value: string): Inline => ({ kind: 'text', value })

describe('inline', () => {
  it('returns plain text unchanged', () => {
    expect(parseInline('just words')).toEqual([text('just words')])
  })

  it('parses bold with either delimiter', () => {
    expect(parseInline('a **b** c')).toEqual([
      text('a '),
      { kind: 'strong', content: [text('b')] },
      text(' c'),
    ])
    expect(parseInline('__b__')).toEqual([{ kind: 'strong', content: [text('b')] }])
  })

  it('parses italic with either delimiter', () => {
    expect(parseInline('*b*')).toEqual([{ kind: 'em', content: [text('b')] }])
    expect(parseInline('_b_')).toEqual([{ kind: 'em', content: [text('b')] }])
  })

  it('prefers bold over italic, so ** is never an empty em', () => {
    expect(parseInline('**b**')).toEqual([{ kind: 'strong', content: [text('b')] }])
  })

  it('nests emphasis', () => {
    expect(parseInline('**bold _and italic_**')).toEqual([
      {
        kind: 'strong',
        content: [text('bold '), { kind: 'em', content: [text('and italic')] }],
      },
    ])
  })

  it('parses inline code and lets nothing nest inside it', () => {
    expect(parseInline('use `**not bold**` here')).toEqual([
      text('use '),
      { kind: 'code', value: '**not bold**' },
      text(' here'),
    ])
  })

  it('parses links, including a link whose label is formatted', () => {
    expect(parseInline('[docs](https://example.com)')).toEqual([
      { kind: 'link', href: 'https://example.com', content: [text('docs')] },
    ])
    expect(parseInline('[**bold**](/local)')).toEqual([
      { kind: 'link', href: '/local', content: [{ kind: 'strong', content: [text('bold')] }] },
    ])
  })

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([text('*not italic*')])
    expect(parseInline('a \\` b')).toEqual([text('a ` b')])
  })

  it('leaves an unterminated run as literal text', () => {
    // The failure mode this prevents: one stray asterisk turning the rest of
    // the note into an italic run.
    expect(parseInline('a * b')).toEqual([text('a * b')])
    expect(parseInline('**never closed')).toEqual([text('**never closed')])
    expect(parseInline('`unclosed code')).toEqual([text('`unclosed code')])
    expect(parseInline('[label](unclosed')).toEqual([text('[label](unclosed')])
  })

  it('treats an empty delimiter run as literal', () => {
    expect(parseInline('****')).toEqual([text('****')])
  })

  it('merges adjacent text rather than fragmenting the tree', () => {
    const nodes = parseInline('a - b - c')
    expect(nodes.filter((node) => node.kind === 'text')).toHaveLength(1)
  })

  it('does not italicise arithmetic or stray separators', () => {
    // A delimiter followed by a space does not open a run, and one preceded by
    // a space does not close it — so a note containing `2 * 3 * 4` keeps its
    // asterisks instead of silently reformatting itself.
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')])
    expect(parseInline('a * b * c')).toEqual([text('a * b * c')])
    expect(parseInline('spaced ** out ** here')).toEqual([text('spaced ** out ** here')])
  })

  it('still emphasises when the delimiters hug their content', () => {
    expect(parseInline('a *b* c')).toEqual([
      text('a '),
      { kind: 'em', content: [text('b')] },
      text(' c'),
    ])
    // Snug on the outside, spaces within: that is a real run.
    expect(parseInline('*two words*')).toEqual([{ kind: 'em', content: [text('two words')] }])
  })

  it('keeps raw HTML as text, because it is never rendered as markup', () => {
    // The renderer builds React elements, so this becomes a text node. The
    // parser's job is simply not to lose it.
    const nodes = parseInline('<img src=x onerror=alert(1)>')
    expect(nodes).toEqual([text('<img src=x onerror=alert(1)>')])
  })
})

describe('safeHref', () => {
  it('allows http, https and mailto', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
  })

  it('allows relative and fragment links, which name no scheme', () => {
    expect(safeHref('/notes/abc')).toBe('/notes/abc')
    expect(safeHref('#section')).toBe('#section')
    expect(safeHref('./file.md')).toBe('./file.md')
  })

  it('defuses a scheme that would execute', () => {
    // Rendering to React elements stops injected markup but not this: an
    // anchor whose href is a script URL.
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('JavaScript:alert(1)')).toBe('#')
    expect(safeHref('  javascript:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,<script>')).toBe('#')
    expect(safeHref('vbscript:msgbox')).toBe('#')
  })

  it('defuses an unsafe link found in a document', () => {
    const [node] = parseInline('[click](javascript:alert(1))')
    expect(node).toMatchObject({ kind: 'link', href: '#' })
  })

  it('treats an empty href as going nowhere', () => {
    expect(safeHref('')).toBe('#')
    expect(safeHref('   ')).toBe('#')
  })
})

describe('blocks', () => {
  const kinds = (blocks: Block[]) => blocks.map((block) => block.kind)

  it('parses headings at every level', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n###### Six')
    expect(blocks).toMatchObject([
      { kind: 'heading', level: 1 },
      { kind: 'heading', level: 2 },
      { kind: 'heading', level: 6 },
    ])
  })

  it('requires a space after the hashes', () => {
    // `#tag` is a tag, not a heading — the note body must not reformat it.
    expect(kinds(parseMarkdown('#notaheading'))).toEqual(['paragraph'])
  })

  it('does not treat seven hashes as a heading', () => {
    expect(kinds(parseMarkdown('####### too many'))).toEqual(['paragraph'])
  })

  it('splits paragraphs on blank lines', () => {
    expect(kinds(parseMarkdown('one\n\ntwo'))).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps a soft-wrapped paragraph as one block', () => {
    expect(kinds(parseMarkdown('one\ntwo'))).toEqual(['paragraph'])
  })

  it('parses unordered lists with either bullet', () => {
    const [block] = parseMarkdown('- a\n- b\n* c')
    expect(block).toMatchObject({ kind: 'list', ordered: false })
    expect((block as Extract<Block, { kind: 'list' }>).items).toHaveLength(3)
  })

  it('parses ordered lists and remembers where they start', () => {
    const [block] = parseMarkdown('3. three\n4. four')
    expect(block).toMatchObject({ kind: 'list', ordered: true, start: 3 })
  })

  it('starts a new list when the kind changes', () => {
    expect(kinds(parseMarkdown('- a\n1. b'))).toEqual(['list', 'list'])
  })

  it('parses checkbox items, checked and unchecked', () => {
    const [block] = parseMarkdown('- [ ] todo\n- [x] done\n- [X] also done')
    const list = block as Extract<Block, { kind: 'list' }>
    expect(list.items.map((item) => item.checked)).toEqual([false, true, true])
    expect(list.items[0]?.content).toEqual([text('todo')])
  })

  it('distinguishes a plain bullet from a checkbox', () => {
    const [block] = parseMarkdown('- plain')
    expect((block as Extract<Block, { kind: 'list' }>).items[0]?.checked).toBeNull()
  })

  it('parses fenced code and keeps it verbatim', () => {
    const [block] = parseMarkdown('```ts\nconst a = **1**\n```')
    expect(block).toEqual({ kind: 'code', language: 'ts', code: 'const a = **1**' })
  })

  it('parses a fence with no language', () => {
    const [block] = parseMarkdown('```\nplain\n```')
    expect(block).toMatchObject({ language: null, code: 'plain' })
  })

  it('keeps blank lines inside a fence', () => {
    const [block] = parseMarkdown('```\na\n\nb\n```')
    expect(block).toMatchObject({ code: 'a\n\nb' })
  })

  it('runs an unclosed fence to the end rather than dropping it', () => {
    const [block] = parseMarkdown('```\nstill code')
    expect(block).toMatchObject({ kind: 'code', code: 'still code' })
  })

  it('does not treat a list or heading inside a fence as markup', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```')
    expect(kinds(blocks)).toEqual(['code'])
  })

  it('handles an empty document', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n  \n')).toEqual([])
  })

  it('normalises CRLF line endings', () => {
    expect(kinds(parseMarkdown('# a\r\n\r\nb'))).toEqual(['heading', 'paragraph'])
  })

  it('parses a realistic note end to end', () => {
    const blocks = parseMarkdown(
      [
        '# Binary search',
        '',
        'Halve the range each step. See [notes](https://example.com).',
        '',
        '- [x] Implement it',
        '- [ ] Handle duplicates',
        '',
        '```ts',
        'while (lo < hi) {}',
        '```',
      ].join('\n'),
    )
    expect(kinds(blocks)).toEqual(['heading', 'paragraph', 'list', 'code'])
  })
})

describe('plain text', () => {
  it('strips markup so search matches the words a user typed', () => {
    expect(markdownToText('# Binary **search**')).toBe('Binary search')
    expect(markdownToText('a [link](https://x.com) here')).toBe('a link here')
  })

  it('includes list items and code', () => {
    expect(markdownToText('- [x] one\n- two')).toBe('one two')
    expect(markdownToText('```\ncode here\n```')).toBe('code here')
  })

  it('collapses whitespace', () => {
    expect(markdownToText('a\n\n\nb')).toBe('a b')
  })

  it('excerpts to a length with an ellipsis, and leaves short text alone', () => {
    expect(markdownExcerpt('short')).toBe('short')
    const long = markdownExcerpt('x'.repeat(300), 20)
    expect(long).toHaveLength(20)
    expect(long.endsWith('…')).toBe(true)
  })

  it('is empty for an empty body', () => {
    expect(markdownToText('')).toBe('')
    expect(markdownExcerpt('')).toBe('')
  })
})

describe('toggleCheckbox', () => {
  it('ticks and unticks by position', () => {
    const src = '- [ ] one\n- [ ] two'
    expect(toggleCheckbox(src, 0)).toBe('- [x] one\n- [ ] two')
    expect(toggleCheckbox(src, 1)).toBe('- [ ] one\n- [x] two')
    expect(toggleCheckbox('- [x] one', 0)).toBe('- [ ] one')
  })

  it('counts checkboxes only, skipping plain bullets and prose', () => {
    const src = 'intro\n\n- plain\n- [ ] first box\n- another plain\n- [ ] second box'
    expect(toggleCheckbox(src, 1)).toContain('- [x] second box')
    expect(toggleCheckbox(src, 1)).toContain('- [ ] first box')
  })

  it('ignores a checkbox inside a code block', () => {
    // It is a literal there, and ticking it would corrupt the example.
    const src = '```\n- [ ] not real\n```\n- [ ] real'
    expect(toggleCheckbox(src, 0)).toBe('```\n- [ ] not real\n```\n- [x] real')
  })

  it('preserves indentation and the rest of the line', () => {
    expect(toggleCheckbox('  - [ ] indented **item**', 0)).toBe('  - [x] indented **item**')
  })

  it('accepts an uppercase X as checked', () => {
    expect(toggleCheckbox('- [X] done', 0)).toBe('- [ ] done')
  })

  it('returns the source unchanged when the index does not exist', () => {
    // The document may have changed in another tab between render and click.
    expect(toggleCheckbox('- [ ] one', 5)).toBe('- [ ] one')
    expect(toggleCheckbox('no boxes here', 0)).toBe('no boxes here')
  })

  it('round-trips through the parser', () => {
    const src = '- [ ] a\n- [ ] b'
    const [block] = parseMarkdown(toggleCheckbox(src, 1))
    const list = block as Extract<Block, { kind: 'list' }>
    expect(list.items.map((item) => item.checked)).toEqual([false, true])
  })
})
