import { describe, expect, it } from 'vitest'
import { hashContent } from './content'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { parseNoteFile, serializeNote, titleFromPath, type SerializableNote } from './noteFile'

/**
 * Note <-> Obsidian Markdown.
 *
 * Two properties carry this file. **Round-tripping**: what goes out comes back
 * unchanged, or an export/import cycle quietly rewrites the user's notes.
 * **Preservation**: frontmatter keys Vaultwork has never heard of survive being
 * written through, or the first export destroys somebody's plugin config.
 */

const note: SerializableNote = {
  id: '9f3c1e2a-0000-4000-8000-000000000001',
  title: 'Binary Search',
  body: '# Halving the range\n\nCompare the middle, discard a half.\n',
  createdAt: Date.UTC(2026, 8, 1, 9, 30, 0),
  updatedAt: Date.UTC(2026, 8, 4, 11, 15, 0),
}

describe('serializing', () => {
  it('writes frontmatter and then the body', () => {
    const file = serializeNote(note, { tags: ['dsa', 'algorithms'] })

    expect(file).toBe(
      [
        '---',
        'id: "9f3c1e2a-0000-4000-8000-000000000001"',
        'title: Binary Search',
        'created: "2026-09-01T09:30:00.000Z"',
        'updated: "2026-09-04T11:15:00.000Z"',
        'tags:',
        '  - dsa',
        '  - algorithms',
        '---',
        '',
        '# Halving the range',
        '',
        'Compare the middle, discard a half.',
        '',
      ].join('\n'),
    )
  })

  it('carries the id, which is the permanent identity', () => {
    expect(serializeNote(note)).toContain(`id: "${note.id}"`)
  })

  it('always quotes the id, whatever it starts with', () => {
    // Quoting only when a value looks numeric would make two notes' files
    // differ in shape on the one field that is the identity contract.
    for (const id of ['655adbc0-ea8e', 'a233c17b-a958', '0000', 'true']) {
      expect(serializeNote({ ...note, id })).toContain(`id: "${id}"`)
    }
  })

  it('is byte-identical across repeated calls, so the hash is stable', () => {
    const once = serializeNote(note, { tags: ['dsa'] })
    const twice = serializeNote(note, { tags: ['dsa'] })
    expect(once).toBe(twice)
    expect(hashContent(once)).toBe(hashContent(twice))
  })

  it('leaves the Markdown body verbatim rather than rendering it', () => {
    const raw = '# H\n\n- [ ] a task\n\n```ts\nconst a = **1**\n```\n'
    const file = serializeNote({ ...note, body: raw })
    expect(file).toContain('- [ ] a task')
    expect(file).toContain('const a = **1**')
    // Nothing became HTML.
    expect(file).not.toContain('<')
  })

  it('omits an empty tag list rather than writing an empty key', () => {
    expect(serializeNote(note, { tags: [] })).not.toContain('tags:')
  })

  it('normalises line endings and the trailing newline', () => {
    const file = serializeNote({ ...note, body: 'a\r\nb\r\n\r\n\r\n' })
    expect(file).not.toContain('\r')
    expect(file.endsWith('b\n')).toBe(true)
  })

  it('handles an empty body', () => {
    const file = serializeNote({ ...note, body: '' })
    expect(file.trimEnd().endsWith('---')).toBe(true)
  })

  it('quotes a title that YAML would otherwise misread', () => {
    expect(serializeNote({ ...note, title: 'true' })).toContain('title: "true"')
    expect(serializeNote({ ...note, title: '2026: a year' })).toContain('title: "2026: a year"')
    expect(serializeNote({ ...note, title: 'He said "hi"' })).toContain('title: "He said \\"hi\\""')
  })
})

describe('parsing', () => {
  it('reads back everything serializing wrote', () => {
    const parsed = parseNoteFile(serializeNote(note, { tags: ['dsa'] }))

    expect(parsed.id).toBe(note.id)
    expect(parsed.title).toBe('Binary Search')
    expect(parsed.tags).toEqual(['dsa'])
    expect(parsed.createdAt).toBe(note.createdAt)
    expect(parsed.updatedAt).toBe(note.updatedAt)
    expect(parsed.body).toBe(note.body)
  })

  it('round-trips exactly, so an export/import cycle changes nothing', () => {
    const first = serializeNote(note, { tags: ['dsa', 'algorithms'] })
    const parsed = parseNoteFile(first)
    const second = serializeNote(
      {
        id: parsed.id as string,
        title: parsed.title as string,
        body: parsed.body,
        createdAt: parsed.createdAt as number,
        updatedAt: parsed.updatedAt as number,
      },
      { tags: parsed.tags, existing: parsed.frontmatter },
    )
    expect(second).toBe(first)
  })

  it('reads an inline tag list, which is what Obsidian often writes', () => {
    const parsed = parseNoteFile('---\ntags: [dsa, algorithms]\n---\n\nbody\n')
    expect(parsed.tags).toEqual(['dsa', 'algorithms'])
  })

  it('reads a single scalar tag', () => {
    expect(parseNoteFile('---\ntags: dsa\n---\n\nbody\n').tags).toEqual(['dsa'])
  })

  it('treats a file with no frontmatter as all body', () => {
    const parsed = parseNoteFile('# Just a note\n\nNo metadata here.\n')
    expect(parsed.hadFrontmatter).toBe(false)
    expect(parsed.id).toBeNull()
    expect(parsed.body).toBe('# Just a note\n\nNo metadata here.\n')
  })

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const parsed = parseNoteFile('# Title\n\n---\n\nAfter the rule\n')
    expect(parsed.hadFrontmatter).toBe(false)
    expect(parsed.body).toContain('After the rule')
  })

  it('degrades an unterminated block to no frontmatter rather than eating the note', () => {
    const parsed = parseNoteFile('---\nid: abc\ntitle: Nope\n\nbody that never closes\n')
    expect(parsed.hadFrontmatter).toBe(false)
    expect(parsed.body).toContain('body that never closes')
  })

  it('survives a malformed block without throwing', () => {
    const parsed = parseNoteFile('---\n:::: nonsense\n[unclosed\n---\n\nbody\n')
    expect(parsed.id).toBeNull()
    expect(parsed.body).toBe('body\n')
  })

  it('ignores an unparseable date rather than inventing one', () => {
    const parsed = parseNoteFile('---\ncreated: "not a date"\n---\n\nbody\n')
    expect(parsed.createdAt).toBeNull()
  })
})

describe('unknown frontmatter', () => {
  const withExtras = [
    '---',
    'id: "abc"',
    'title: Kept',
    'aliases:',
    '  - Other name',
    '  - Yet another',
    'cssclasses: wide',
    'publish: true',
    'my-plugin-field: 42',
    '---',
    '',
    'body',
    '',
  ].join('\n')

  it('keeps every key it does not understand', () => {
    const parsed = parseNoteFile(withExtras)
    const kept = parsed.frontmatter.unknown.join('\n')

    expect(kept).toContain('aliases:')
    expect(kept).toContain('  - Other name')
    expect(kept).toContain('  - Yet another')
    expect(kept).toContain('cssclasses: wide')
    expect(kept).toContain('publish: true')
    expect(kept).toContain('my-plugin-field: 42')
  })

  it('writes them back when the note is exported again', () => {
    // The whole point: a Vaultwork export must not destroy a plugin's config.
    const parsed = parseNoteFile(withExtras)
    const rewritten = serializeNote(
      { id: 'abc', title: 'Kept', body: parsed.body, createdAt: 0, updatedAt: 0 },
      { existing: parsed.frontmatter },
    )

    expect(rewritten).toContain('aliases:')
    expect(rewritten).toContain('  - Other name')
    expect(rewritten).toContain('cssclasses: wide')
    expect(rewritten).toContain('publish: true')
    expect(rewritten).toContain('my-plugin-field: 42')
  })

  it('does not confuse an unknown list with the tag list', () => {
    const parsed = parseNoteFile(withExtras)
    // `aliases` items must not be swept into tags.
    expect(parsed.tags).toEqual([])
  })

  it('keeps two adjacent lists apart', () => {
    const parsed = parseNoteFile(
      ['---', 'aliases:', '  - one', 'tags:', '  - dsa', '---', '', 'body'].join('\n'),
    )
    expect(parsed.tags).toEqual(['dsa'])
    expect(parsed.frontmatter.unknown.join('\n')).toContain('  - one')
  })

  it('drops unknown keys only when the caller does not pass the old block', () => {
    // Exporting to a path with no existing file writes a fresh block, which is
    // correct — there is nothing there to preserve.
    const fresh = serializeNote({ id: 'abc', title: 'T', body: 'b', createdAt: 0, updatedAt: 0 })
    expect(fresh).not.toContain('aliases')
  })
})

describe('frontmatter primitives', () => {
  it('serializes and parses a block symmetrically', () => {
    const block = serializeFrontmatter({
      id: 'abc',
      title: 'Title',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      tags: ['a', 'b'],
      unknown: ['custom: value'],
    })
    const parsed = parseFrontmatter(`${block}\n\nbody\n`)

    expect(parsed.frontmatter.id).toBe('abc')
    expect(parsed.frontmatter.tags).toEqual(['a', 'b'])
    expect(parsed.frontmatter.unknown).toEqual(['custom: value'])
    expect(parsed.body).toBe('body\n')
  })
})

describe('titleFromPath', () => {
  it('uses the file name, as Obsidian does', () => {
    expect(titleFromPath('notes/dsa/binary-search.md')).toBe('binary-search')
    expect(titleFromPath('Some Note.md')).toBe('Some Note')
  })

  it('copes with a path that has no extension or no name', () => {
    expect(titleFromPath('notes/thing')).toBe('thing')
    expect(titleFromPath('.md')).toBe('Untitled note')
  })
})
