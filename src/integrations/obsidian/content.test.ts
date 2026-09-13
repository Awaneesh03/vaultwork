import { describe, expect, it } from 'vitest'
import { contentEquals, hashContent, normalizeContent } from './content'

/**
 * Canonical content and its hash.
 *
 * The property that matters: differences with no meaning in Markdown must not
 * change the hash, and differences with meaning must.
 */

describe('normalizeContent', () => {
  it('folds CRLF and lone CR to LF', () => {
    expect(normalizeContent('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })

  it('ends with exactly one newline', () => {
    expect(normalizeContent('a')).toBe('a\n')
    expect(normalizeContent('a\n')).toBe('a\n')
    expect(normalizeContent('a\n\n\n\n')).toBe('a\n')
  })

  it('strips a byte order mark', () => {
    expect(normalizeContent('﻿# Title\n')).toBe('# Title\n')
  })

  it('leaves an empty document empty rather than inventing a newline', () => {
    expect(normalizeContent('')).toBe('')
    expect(normalizeContent('\n\n')).toBe('')
  })

  it('preserves trailing spaces, which are a hard line break in Markdown', () => {
    // Stripping these would silently reformat the user's document.
    expect(normalizeContent('line one  \nline two')).toBe('line one  \nline two\n')
  })

  it('preserves interior blank lines, which separate paragraphs', () => {
    expect(normalizeContent('a\n\nb')).toBe('a\n\nb\n')
  })

  it('is idempotent', () => {
    const once = normalizeContent('a\r\n\r\nb\r\n\r\n')
    expect(normalizeContent(once)).toBe(once)
  })
})

describe('hashContent', () => {
  it('is deterministic', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'))
  })

  it('is stable across line-ending and trailing-newline differences', () => {
    expect(hashContent('a\nb')).toBe(hashContent('a\r\nb\r\n'))
    expect(hashContent('a\n')).toBe(hashContent('a\n\n\n'))
  })

  it('changes when the content genuinely changes', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'))
    expect(hashContent('a\nb')).not.toBe(hashContent('a\nc'))
    // A single character, deep in a long document.
    const long = 'x'.repeat(5000)
    expect(hashContent(long)).not.toBe(hashContent(`${long.slice(0, 4999)}y`))
  })

  it('notices transposition, which a weak checksum would miss', () => {
    expect(hashContent('ab')).not.toBe(hashContent('ba'))
  })

  it('is a fixed-width hex string', () => {
    for (const text of ['', 'a', 'a much longer document\nwith lines\n']) {
      expect(hashContent(text)).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('handles non-ASCII text', () => {
    expect(hashContent('café')).toBe(hashContent('café'))
    expect(hashContent('café')).not.toBe(hashContent('cafe'))
    expect(hashContent('日本語')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not collide across a realistic spread of note bodies', () => {
    const hashes = new Set<string>()
    for (let i = 0; i < 2000; i += 1) {
      hashes.add(hashContent(`# Note ${i}\n\nSome body text for note number ${i}.\n`))
    }
    expect(hashes.size).toBe(2000)
  })
})

describe('contentEquals', () => {
  it('compares canonically', () => {
    expect(contentEquals('a\r\nb', 'a\nb\n')).toBe(true)
    expect(contentEquals('a', 'b')).toBe(false)
  })
})
