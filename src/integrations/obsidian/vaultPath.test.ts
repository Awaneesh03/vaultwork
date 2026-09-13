import { describe, expect, it } from 'vitest'
import {
  assertSafeVaultPath,
  buildVaultPath,
  isSafeVaultPath,
  isVaultPath,
  parentDirectories,
  slugify,
  uniqueVaultPath,
  UnsafeVaultPathError,
  VAULT_NOTES_FOLDER,
} from './vaultPath'

/**
 * The Obsidian path contract.
 *
 * M9 writes no files, so these tests are the whole specification of where a
 * note *will* live. Getting them right now is what makes M12 a feature rather
 * than a migration.
 */

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('Binary Search')).toBe('binary-search')
    expect(slugify('  Spaced   Out  ')).toBe('spaced-out')
  })

  it('folds accents rather than deleting the letters', () => {
    // Stripping instead of folding would turn "Résumé" into "rsum".
    expect(slugify('Résumé')).toBe('resume')
    expect(slugify('naïve café')).toBe('naive-cafe')
  })

  it('removes characters a filesystem or a vault would reject', () => {
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    // `#`, `^` and `[]` are Obsidian link syntax, not just filesystem issues.
    expect(slugify('tag #dsa [ref]')).toBe('tag-dsa-ref')
  })

  it('never produces leading, trailing or doubled hyphens', () => {
    expect(slugify('---a---b---')).toBe('a-b')
    expect(slugify('!!!')).toBe('untitled')
  })

  it('falls back to untitled for an empty or symbol-only title', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('   ')).toBe('untitled')
    expect(slugify('###')).toBe('untitled')
  })

  it('escapes Windows reserved names, which cannot be files there', () => {
    expect(slugify('con')).toBe('con-note')
    expect(slugify('CON')).toBe('con-note')
    expect(slugify('nul')).toBe('nul-note')
    // Only the exact reserved word is affected.
    expect(slugify('control')).toBe('control')
  })

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(200)} ${'b'.repeat(200)}`)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('keeps digits, which often carry the meaning', () => {
    expect(slugify('Chapter 4 notes')).toBe('chapter-4-notes')
  })
})

describe('buildVaultPath', () => {
  it('produces the shape the milestone specifies', () => {
    expect(buildVaultPath({ title: 'Binary Search', tags: ['dsa'] })).toBe(
      'notes/dsa/binary-search.md',
    )
  })

  it('puts an untagged note directly under the notes folder', () => {
    expect(buildVaultPath({ title: 'Loose thought' })).toBe('notes/loose-thought.md')
    expect(buildVaultPath({ title: 'Loose thought', tags: [] })).toBe('notes/loose-thought.md')
  })

  it('uses the first tag as the folder', () => {
    expect(buildVaultPath({ title: 'Trees', tags: ['dsa', 'college'] })).toBe(
      'notes/dsa/trees.md',
    )
  })

  it('slugifies the folder as well as the file', () => {
    expect(buildVaultPath({ title: 'Notes', tags: ['Data Structures'] })).toBe(
      'notes/data-structures/notes.md',
    )
  })

  it('skips a tag that slugifies to nothing', () => {
    expect(buildVaultPath({ title: 'Thing', tags: ['!!!', 'real'] })).toBe(
      'notes/real/thing.md',
    )
  })

  it('always lands inside the notes folder with a .md extension', () => {
    for (const title of ['', '../escape', 'C:\\Windows', 'a/b/c']) {
      const path = buildVaultPath({ title })
      expect(path.startsWith(`${VAULT_NOTES_FOLDER}/`)).toBe(true)
      expect(path.endsWith('.md')).toBe(true)
      // A title must never be able to climb out of the vault folder.
      expect(path.includes('..')).toBe(false)
    }
  })
})

describe('uniqueVaultPath', () => {
  it('leaves a free path alone', () => {
    expect(uniqueVaultPath('notes/ideas.md', [])).toBe('notes/ideas.md')
    expect(uniqueVaultPath('notes/ideas.md', ['notes/other.md'])).toBe('notes/ideas.md')
  })

  it('suffixes the base name, keeping the extension last', () => {
    expect(uniqueVaultPath('notes/ideas.md', ['notes/ideas.md'])).toBe('notes/ideas-2.md')
  })

  it('keeps counting past an existing suffix', () => {
    expect(
      uniqueVaultPath('notes/ideas.md', ['notes/ideas.md', 'notes/ideas-2.md']),
    ).toBe('notes/ideas-3.md')
  })

  it('compares case-insensitively, because vaults live on such filesystems', () => {
    // macOS and Windows would treat these as the same file.
    expect(uniqueVaultPath('notes/Ideas.md', ['notes/ideas.md'])).toBe('notes/Ideas-2.md')
  })

  it('respects folders — the same name in two folders is not a clash', () => {
    expect(uniqueVaultPath('notes/dsa/trees.md', ['notes/bio/trees.md'])).toBe(
      'notes/dsa/trees.md',
    )
  })
})

describe('isVaultPath', () => {
  it('accepts what this module produces', () => {
    expect(isVaultPath('notes/dsa/binary-search.md')).toBe(true)
    expect(isVaultPath('notes/loose.md')).toBe(true)
  })

  it('rejects anything outside the contract', () => {
    expect(isVaultPath('other/thing.md')).toBe(false)
    expect(isVaultPath('notes/thing.txt')).toBe(false)
    expect(isVaultPath('notes//thing.md')).toBe(false)
    expect(isVaultPath('notes/../escape.md')).toBe(false)
    expect(isVaultPath('')).toBe(false)
  })
})

describe('path safety', () => {
  it('accepts the paths this module produces', () => {
    expect(isSafeVaultPath('notes/dsa/binary-search.md')).toBe(true)
    expect(isSafeVaultPath('notes/loose.md')).toBe(true)
    expect(isSafeVaultPath('anything/deep/nested/file.md')).toBe(true)
  })

  it('rejects every form of traversal', () => {
    // The vault handle is permission for one folder. A path that climbs out of
    // it spends that permission somewhere the user never agreed to.
    for (const path of [
      '../../secret.md',
      '../outside.md',
      'notes/../../escape.md',
      'notes/../secret.md',
      'notes/%2e%2e/escape.md',
    ]) {
      expect(isSafeVaultPath(path)).toBe(false)
    }
  })

  it('rejects absolute and platform-specific paths', () => {
    for (const path of [
      '/Users/user/file.md',
      '/etc/passwd.md',
      'C:\\Users\\file.md',
      'C:/Users/file.md',
      '\\\\server\\share\\file.md',
      'file:///etc/passwd.md',
      'https://example.com/x.md',
    ]) {
      expect(isSafeVaultPath(path)).toBe(false)
    }
  })

  it('rejects malformed and dangerous segments', () => {
    expect(isSafeVaultPath('')).toBe(false)
    expect(isSafeVaultPath('   ')).toBe(false)
    expect(isSafeVaultPath('notes//double.md')).toBe(false)
    expect(isSafeVaultPath('notes/./here.md')).toBe(false)
    expect(isSafeVaultPath('notes/nul\u0000byte.md')).toBe(false)
  })

  it('rejects anything that is not a Markdown file', () => {
    // A note must never be able to create an arbitrary file type.
    expect(isSafeVaultPath('notes/thing.txt')).toBe(false)
    expect(isSafeVaultPath('notes/script.js')).toBe(false)
    expect(isSafeVaultPath('notes/.obsidian/config.json')).toBe(false)
    expect(isSafeVaultPath('notes/noextension')).toBe(false)
  })

  it('throws with a reason a person can read', () => {
    expect(() => assertSafeVaultPath('../escape.md')).toThrow(UnsafeVaultPathError)
    expect(() => assertSafeVaultPath('../escape.md')).toThrow(/traversal/)
    expect(() => assertSafeVaultPath('/abs.md')).toThrow(/absolute/)
  })

  it('returns the path, normalised, when it is safe', () => {
    expect(assertSafeVaultPath('notes/a.md')).toBe('notes/a.md')
  })

  it('never lets a generated path be unsafe, whatever the title', () => {
    for (const title of ['../../escape', '/etc/passwd', 'C:\\Windows', '..', '.']) {
      expect(isSafeVaultPath(buildVaultPath({ title }))).toBe(true)
    }
  })
})

describe('parentDirectories', () => {
  it('lists the directories to create, outermost first', () => {
    expect(parentDirectories('notes/dsa/binary-search.md')).toEqual(['notes', 'notes/dsa'])
  })

  it('is empty for a file at the root', () => {
    expect(parentDirectories('file.md')).toEqual([])
  })

  it('handles a single folder', () => {
    expect(parentDirectories('notes/a.md')).toEqual(['notes'])
  })

  it('refuses an unsafe path rather than returning directories for it', () => {
    expect(() => parentDirectories('../escape.md')).toThrow(UnsafeVaultPathError)
  })
})
