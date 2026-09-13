import { describe, expect, it } from 'vitest'
import {
  formatWikilink,
  parseWikilinks,
  resolveWikilink,
  wikilinkTargets,
  type ResolvableNote,
} from './wikilinks'

/**
 * Obsidian wikilinks.
 *
 * The two failure modes worth guarding: swallowing an ordinary Markdown link,
 * and resolving a target to the wrong note because two notes share a name.
 */

const targets = (source: string) => parseWikilinks(source).map((link) => link.target)

describe('parsing', () => {
  it('finds a plain wikilink', () => {
    expect(targets('See [[Binary Search]] for more.')).toEqual(['Binary Search'])
  })

  it('finds several, in document order', () => {
    expect(targets('[[A]] then [[B]] then [[C]]')).toEqual(['A', 'B', 'C'])
  })

  it('reads an alias', () => {
    const [link] = parseWikilinks('[[Binary Search|the algorithm]]')
    expect(link).toMatchObject({ target: 'Binary Search', alias: 'the algorithm' })
  })

  it('reads a heading fragment', () => {
    const [link] = parseWikilinks('[[Binary Search#Complexity]]')
    expect(link).toMatchObject({ target: 'Binary Search', heading: 'Complexity' })
  })

  it('reads a heading and an alias together', () => {
    const [link] = parseWikilinks('[[Note#Section|shown]]')
    expect(link).toMatchObject({ target: 'Note', heading: 'Section', alias: 'shown' })
  })

  it('accepts an id as the target', () => {
    expect(targets('[[9f3c1e2a-0000-4000-8000-000000000001]]')).toEqual([
      '9f3c1e2a-0000-4000-8000-000000000001',
    ])
  })

  it('never mistakes an ordinary Markdown link for a wikilink', () => {
    expect(parseWikilinks('[docs](https://example.com)')).toEqual([])
    expect(parseWikilinks('[text][ref]')).toEqual([])
    expect(parseWikilinks('![image](a.png)')).toEqual([])
  })

  it('does not run two adjacent links together', () => {
    expect(targets('[[A]] and [[B]]')).toEqual(['A', 'B'])
  })

  it('ignores a wikilink inside code, which is a quotation not a link', () => {
    expect(parseWikilinks('Use `[[Target]]` to link.')).toEqual([])
    expect(parseWikilinks('```\n[[Target]]\n```')).toEqual([])
  })

  it('ignores an empty or fragment-only target', () => {
    expect(parseWikilinks('[[]]')).toEqual([])
    expect(parseWikilinks('[[|alias]]')).toEqual([])
    expect(parseWikilinks('[[#heading]]')).toEqual([])
  })

  it('finds links embedded in ordinary prose and lists', () => {
    const source = '# Title\n\n- see [[A]]\n- and [[B|b]]\n\nText with [[C]] inline.\n'
    expect(targets(source)).toEqual(['A', 'B', 'C'])
  })

  it('reports the span so a caller can replace it exactly', () => {
    const [link] = parseWikilinks('x [[A|b]] y')
    expect(link?.raw).toBe('[[A|b]]')
    expect(
      'x [[A|b]] y'.slice(link?.index ?? 0, (link?.index ?? 0) + (link?.raw.length ?? 0)),
    ).toBe('[[A|b]]')
  })
})

describe('distinct targets', () => {
  it('de-duplicates, case-insensitively, keeping first appearance', () => {
    expect(wikilinkTargets('[[A]] [[B]] [[a]] [[A]]')).toEqual(['A', 'B'])
  })

  it('is empty for a document with no links', () => {
    expect(wikilinkTargets('nothing here')).toEqual([])
  })
})

describe('writing', () => {
  it('writes a title, which is what Obsidian resolves', () => {
    expect(formatWikilink('Binary Search')).toBe('[[Binary Search]]')
  })

  it('writes an alias when given one', () => {
    expect(formatWikilink('Binary Search', 'the algorithm')).toBe('[[Binary Search|the algorithm]]')
  })

  it('strips characters that would break the link syntax', () => {
    expect(formatWikilink('A [weird] | title # here')).toBe('[[A weird title here]]')
  })

  it('falls back rather than writing an empty link', () => {
    expect(formatWikilink('   ')).toBe('[[Untitled note]]')
  })
})

describe('resolving', () => {
  const notes: ResolvableNote[] = [
    { id: 'id-1', title: 'Binary Search', vaultPath: 'notes/dsa/binary-search.md' },
    { id: 'id-2', title: 'Graphs', vaultPath: 'notes/dsa/graphs.md' },
  ]

  it('resolves by exact id', () => {
    expect(resolveWikilink('id-2', notes)).toMatchObject({ status: 'resolved', noteId: 'id-2' })
  })

  it('resolves by title, ignoring case', () => {
    expect(resolveWikilink('binary search', notes)).toMatchObject({
      status: 'resolved',
      noteId: 'id-1',
    })
  })

  it('resolves by file name or full vault path', () => {
    expect(resolveWikilink('binary-search', notes)).toMatchObject({ noteId: 'id-1' })
    expect(resolveWikilink('notes/dsa/graphs.md', notes)).toMatchObject({ noteId: 'id-2' })
  })

  it('leaves an unknown target unresolved rather than inventing a note', () => {
    // A vault is full of links to notes nobody has written yet.
    expect(resolveWikilink('Never Written', notes)).toEqual({
      status: 'unresolved',
      target: 'Never Written',
    })
  })

  it('reports ambiguity instead of guessing', () => {
    const twins: ResolvableNote[] = [
      { id: 'a', title: 'Notes', vaultPath: 'notes/a.md' },
      { id: 'b', title: 'Notes', vaultPath: 'notes/b.md' },
    ]
    const result = resolveWikilink('Notes', twins)
    expect(result.status).toBe('ambiguous')
    if (result.status === 'ambiguous') expect(result.noteIds.sort()).toEqual(['a', 'b'])
  })

  it('resolves against an empty vault as unresolved, not a crash', () => {
    expect(resolveWikilink('anything', []).status).toBe('unresolved')
  })
})
