import { describe, expect, it } from 'vitest'
import { hashContent } from './content'
import {
  buildSyncPlan,
  fileKindOf,
  isPdfFile,
  classifyPair,
  defaultDecisions,
  isIgnoredDirectory,
  isIgnoredFile,
  isMarkdownFile,
  optionsFor,
  orderedForApply,
  safeDecisions,
  summarizeDecisions,
  type LocalNote,
  type ScannedFile,
  type SyncBaseline,
  type SyncPlan,
} from './syncPlan'

/**
 * Vault classification, with no filesystem and no database.
 *
 * Every case the milestone enumerates is here. These are the assertions that
 * stand between a user and an overwritten afternoon, so each is spelled out
 * rather than folded into a table.
 */

const H = (text: string) => hashContent(text)
const AT = 1_700_000_000_000

const note = (over: Partial<LocalNote> = {}): LocalNote => ({
  id: 'n1',
  title: 'Binary Search',
  vaultPath: 'notes/binary-search.md',
  hash: H('A'),
  updatedAt: AT,
  deleted: false,
  ...over,
})

const file = (over: Partial<ScannedFile> = {}): ScannedFile => ({
  path: 'notes/binary-search.md',
  id: 'n1',
  title: 'Binary Search',
  tags: [],
  excerpt: 'body',
  hash: H('A'),
  updatedAt: AT,
  ...over,
})

const baseline = (over: Partial<SyncBaseline> = {}): SyncBaseline => ({
  noteId: 'n1',
  path: 'notes/binary-search.md',
  lastHashApp: H('A'),
  lastHashFile: H('A'),
  syncedAt: AT,
  ...over,
})

const plan = (over: Partial<Parameters<typeof buildSyncPlan>[0]> = {}): SyncPlan =>
  buildSyncPlan({ notes: [], files: [], baselines: [], errors: [], scannedAt: AT, ...over })

const statusOf = (result: SyncPlan, key: string) =>
  result.items.find((item) => item.key === key)?.status

describe('the three-way cases, through the plan', () => {
  it('base A, local A, remote A: clean', () => {
    const result = plan({ notes: [note()], files: [file()], baselines: [baseline()] })
    expect(statusOf(result, 'note:n1')).toBe('clean')
  })

  it('base A, local B, remote A: local change', () => {
    const result = plan({
      notes: [note({ hash: H('B') })],
      files: [file()],
      baselines: [baseline()],
    })
    expect(statusOf(result, 'note:n1')).toBe('local-change')
  })

  it('base A, local A, remote B: external change', () => {
    const result = plan({
      notes: [note()],
      files: [file({ hash: H('B') })],
      baselines: [baseline()],
    })
    expect(statusOf(result, 'note:n1')).toBe('external-change')
  })

  it('base A, local B, remote C: conflict', () => {
    const result = plan({
      notes: [note({ hash: H('B') })],
      files: [file({ hash: H('C') })],
      baselines: [baseline()],
    })
    expect(statusOf(result, 'note:n1')).toBe('conflict')
  })

  it('base A, both moved to B: equivalent, not a conflict', () => {
    const result = plan({
      notes: [note({ hash: H('B') })],
      files: [file({ hash: H('B') })],
      baselines: [baseline()],
    })
    expect(statusOf(result, 'note:n1')).toBe('clean')
  })

  it('classifyPair agrees with the plan', () => {
    expect(classifyPair(note({ hash: H('B') }), file(), baseline())).toBe('local-change')
    expect(classifyPair(note(), null, baseline())).toBe('missing')
    expect(classifyPair(note(), null, null)).toBe('not-exported')
  })
})

describe('files with no note', () => {
  it('classifies an unknown Markdown file as new', () => {
    const result = plan({ files: [file({ path: 'notes/theirs.md', id: null })] })
    expect(statusOf(result, 'file:notes/theirs.md')).toBe('untracked')
  })

  it('does not resurrect a note that was deleted, even with a matching id', () => {
    // A file carrying an id whose note is gone is just a new file.
    const result = plan({ files: [file({ path: 'notes/orphan.md', id: 'deleted-note' })] })
    const item = result.items.find((row) => row.key === 'file:notes/orphan.md')
    expect(item?.status).toBe('untracked')
    expect(item?.message).toContain('no matching note')
  })

  it('carries what the user needs to decide', () => {
    const result = plan({
      files: [
        file({ path: 'notes/theirs.md', id: null, title: 'Theirs', tags: ['dsa'], excerpt: 'hi' }),
      ],
    })
    const item = result.items[0]
    expect(item).toMatchObject({ title: 'Theirs', path: 'notes/theirs.md', excerpt: 'hi' })
  })
})

describe('missing files', () => {
  it('reports a note whose exported file is gone', () => {
    const result = plan({ notes: [note()], files: [], baselines: [baseline()] })
    expect(statusOf(result, 'note:n1')).toBe('missing')
  })

  it('never turns a missing file into a deleted note', () => {
    const result = plan({ notes: [note()], files: [], baselines: [baseline()] })
    // The only options are to write it again or stop tracking it.
    expect(optionsFor('missing').map((row) => row.decision)).toEqual([
      'restore-to-vault',
      'forget-link',
      'skip',
    ])
    expect(result.items[0]?.noteId).toBe('n1')
  })

  it('distinguishes never-exported from missing', () => {
    const never = plan({ notes: [note({ vaultPath: 'notes/x.md' })] })
    expect(statusOf(never, 'note:n1')).toBe('not-exported')
  })
})

describe('moves', () => {
  it('detects a file that moved but did not change', () => {
    const result = plan({
      notes: [note()],
      files: [file({ path: 'notes/archive/binary-search.md' })],
      baselines: [baseline()],
    })
    const item = result.items[0]
    expect(item?.status).toBe('moved')
    expect(item?.previousPath).toBe('notes/binary-search.md')
    expect(item?.path).toBe('notes/archive/binary-search.md')
  })

  it('keeps a move and an edit as one state that says both', () => {
    const result = plan({
      notes: [note()],
      files: [file({ path: 'notes/archive/binary-search.md', hash: H('B') })],
      baselines: [baseline()],
    })
    expect(statusOf(result, 'note:n1')).toBe('moved-change')
  })

  it('follows the id rather than the path', () => {
    // The file is the authority on where it lives; the id says which note.
    const result = plan({
      notes: [note()],
      files: [file({ path: 'somewhere/else.md' })],
      baselines: [baseline()],
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.status).toBe('moved')
  })

  it('does not create a second note for a moved file', () => {
    const result = plan({
      notes: [note()],
      files: [file({ path: 'notes/moved.md' })],
      baselines: [baseline()],
    })
    expect(result.items.filter((item) => item.status === 'untracked')).toEqual([])
  })

  it('offers acceptance rather than moving on its own', () => {
    expect(optionsFor('moved').map((row) => row.decision)).toEqual(['accept-move', 'skip'])
  })
})

describe('identity problems', () => {
  it('reports two files claiming one note, and touches neither', () => {
    const result = plan({
      notes: [note()],
      files: [file({ path: 'notes/a.md' }), file({ path: 'notes/b.md' })],
      baselines: [baseline()],
    })

    const item = result.items.find((row) => row.status === 'duplicate-id')
    expect(item?.otherPath).toBe('notes/b.md')
    expect(item?.message).toContain('notes/a.md')
    // The note itself is not classified: acting on it would compound the doubt.
    expect(result.items.filter((row) => row.key === 'note:n1')).toEqual([])
  })

  it('offers nothing automatic for a duplicate id', () => {
    expect(optionsFor('duplicate-id')).toEqual([])
  })

  it('reports two notes claiming one path', () => {
    const result = plan({
      notes: [note({ id: 'n1' }), note({ id: 'n2', title: 'Other' })],
    })
    const item = result.items.find((row) => row.status === 'path-collision')
    expect(item?.message).toContain('notes/binary-search.md')
    expect(optionsFor('path-collision')).toEqual([])
  })

  it('compares paths case-insensitively, as a real filesystem would', () => {
    const result = plan({
      notes: [note({ id: 'n1' }), note({ id: 'n2', vaultPath: 'notes/Binary-Search.md' })],
    })
    expect(result.counts['path-collision']).toBe(1)
  })

  it('does not call one note claiming its own path a collision', () => {
    const result = plan({ notes: [note()] })
    expect(result.counts['path-collision']).toBe(0)
  })
})

describe('local deletion', () => {
  it('reports a deleted note whose file remains', () => {
    const result = plan({
      notes: [note({ deleted: true })],
      files: [file()],
      baselines: [baseline()],
    })
    const item = result.items[0]
    expect(item?.status).toBe('deleted-local')
    expect(item?.message).toContain('vault file is untouched')
  })

  it('says nothing when both are gone', () => {
    const result = plan({ notes: [note({ deleted: true })], baselines: [baseline()] })
    expect(result.items).toEqual([])
  })

  it('offers deletion and keeping, with deletion marked destructive', () => {
    const options = optionsFor('deleted-local')
    expect(options.map((row) => row.decision)).toEqual([
      'delete-from-vault',
      'forget-link',
      'skip',
    ])
    expect(options[0]?.destructive).toBe(true)
  })
})

describe('ignore rules', () => {
  it('skips dot-directories and known internals', () => {
    for (const name of ['.obsidian', '.trash', '.git', 'node_modules', '.anything']) {
      expect(isIgnoredDirectory(name)).toBe(true)
    }
    expect(isIgnoredDirectory('notes')).toBe(false)
  })

  it('recognises Markdown, whatever case it is written in', () => {
    expect(isMarkdownFile('a.md')).toBe(true)
    expect(isMarkdownFile('a.MD')).toBe(true)
    for (const name of ['a.canvas', 'a.png', 'a.pdf', 'a.json', 'a']) {
      expect(isMarkdownFile(name)).toBe(false)
    }
  })

  it('recognises PDFs, whatever case they are written in', () => {
    // A vault assembled by hand over years contains all three spellings, and a
    // filesystem treats them as one file.
    for (const name of ['a.pdf', 'a.PDF', 'a.Pdf', 'System Design.pdf']) {
      expect(isPdfFile(name), name).toBe(true)
      expect(fileKindOf(name), name).toBe('pdf')
      expect(isIgnoredFile(name), name).toBe(false)
    }
    expect(isPdfFile('a.md')).toBe(false)
    expect(isPdfFile('a.pdf.png')).toBe(false)
  })

  it('reads the two document kinds and passes over everything else', () => {
    expect(fileKindOf('notes/a.md')).toBe('note')
    expect(fileKindOf('papers/a.pdf')).toBe('pdf')

    // Somebody's file that Vaultwork has no business interpreting.
    for (const name of ['a.canvas', 'a.png', 'a.jpeg', 'a.webp', 'a.mp4', 'a.zip', 'a.json', 'a']) {
      expect(fileKindOf(name), name).toBeNull()
      expect(isIgnoredFile(name), name).toBe(true)
    }
  })

  it('skips editor and sync scratch files', () => {
    for (const name of ['~$draft.md', '.~lock.md', 'a.tmp', 'a.swp', 'note.md.crswap']) {
      expect(isIgnoredFile(name)).toBe(true)
    }
    expect(isIgnoredFile('binary-search.md')).toBe(false)
  })
})

describe('counts and ordering', () => {
  it('counts every state', () => {
    const result = plan({
      notes: [note({ id: 'n1' }), note({ id: 'n2', vaultPath: 'notes/b.md', hash: H('B') })],
      files: [file({ id: 'n1' }), file({ path: 'notes/new.md', id: null })],
      baselines: [baseline()],
    })

    expect(result.counts.clean).toBe(1)
    expect(result.counts['not-exported']).toBe(1)
    expect(result.counts.untracked).toBe(1)
    expect(result.filesSeen).toBe(2)
    expect(result.notesSeen).toBe(2)
  })

  it('puts what needs a decision first and clean last', () => {
    const result = plan({
      notes: [
        note({ id: 'n1' }),
        note({ id: 'n2', vaultPath: 'notes/b.md', hash: H('B') }),
      ],
      files: [
        file({ id: 'n1' }),
        file({ id: 'n2', path: 'notes/b.md', hash: H('C') }),
      ],
      baselines: [baseline(), baseline({ noteId: 'n2', path: 'notes/b.md' })],
    })

    expect(result.items[0]?.status).toBe('conflict')
    expect(result.items[result.items.length - 1]?.status).toBe('clean')
  })

  it('carries scan errors without letting them stop the plan', () => {
    const result = plan({
      notes: [note()],
      files: [file()],
      baselines: [baseline()],
      errors: [{ path: 'notes/broken.md', message: 'unreadable' }],
    })

    expect(result.counts.error).toBe(1)
    expect(result.errors[0]?.path).toBe('notes/broken.md')
    // The readable file was still classified.
    expect(statusOf(result, 'note:n1')).toBe('clean')
  })

  it('gives items keys that survive a rescan', () => {
    const first = plan({ notes: [note()], files: [file()], baselines: [baseline()] })
    const second = plan({ notes: [note()], files: [file()], baselines: [baseline()] })
    expect(first.items.map((item) => item.key)).toEqual(second.items.map((item) => item.key))
  })
})

describe('decisions', () => {
  const mixed = () =>
    plan({
      notes: [
        note({ id: 'local', vaultPath: 'notes/local.md', hash: H('B') }),
        note({ id: 'fresh', vaultPath: 'notes/fresh.md' }),
        note({ id: 'clash', vaultPath: 'notes/clash.md', hash: H('B') }),
      ],
      files: [
        file({ id: 'local', path: 'notes/local.md' }),
        file({ id: 'clash', path: 'notes/clash.md', hash: H('C') }),
        file({ id: null, path: 'notes/new.md' }),
      ],
      baselines: [
        baseline({ noteId: 'local', path: 'notes/local.md' }),
        baseline({ noteId: 'clash', path: 'notes/clash.md' }),
      ],
    })

  it('defaults everything to doing nothing', () => {
    const result = mixed()
    const decisions = defaultDecisions(result)
    expect(Object.values(decisions).every((value) => value === 'skip')).toBe(true)
  })

  it('selects only genuinely safe changes', () => {
    const result = mixed()
    const decisions = safeDecisions(result)

    expect(decisions['note:local']).toBe('export')
    expect(decisions['note:fresh']).toBe('export')
    // A conflict and a new file are never chosen for the user.
    expect(decisions['note:clash']).toBe('skip')
    expect(decisions['file:notes/new.md']).toBe('skip')
  })

  it('summarises what a batch would do', () => {
    const result = mixed()
    const decisions = {
      ...defaultDecisions(result),
      'note:local': 'export' as const,
      'note:clash': 'keep-external' as const,
      'file:notes/new.md': 'import' as const,
    }

    const summary = summarizeDecisions(result, decisions)
    expect(summary).toMatchObject({ exported: 1, imported: 2, total: 3 })
    // Keeping the vault side replaces unseen local work.
    expect(summary.destructive).toBe(1)
    expect(summary.skipped).toBeGreaterThan(0)
  })

  it('offers no automatic resolution for a conflict', () => {
    const options = optionsFor('conflict')
    expect(options.map((row) => row.decision)).toEqual(['keep-local', 'keep-external', 'skip'])
    // Both sides are marked destructive; neither is a default.
    expect(options.filter((row) => row.destructive)).toHaveLength(2)
    expect(options.some((row) => row.label.toLowerCase().includes('auto'))).toBe(false)
  })

  it('always allows doing nothing', () => {
    for (const status of [
      'local-change',
      'external-change',
      'conflict',
      'untracked',
      'missing',
      'moved',
      'deleted-local',
      'not-exported',
    ] as const) {
      expect(optionsFor(status).some((row) => row.decision === 'skip')).toBe(true)
    }
  })

  it('orders operations so imports run before deletes', () => {
    const result = mixed()
    const decisions = {
      ...defaultDecisions(result),
      'note:local': 'export' as const,
      'file:notes/new.md': 'import' as const,
    }

    const ordered = orderedForApply(result, decisions)
    expect(ordered.map((row) => row.decision)).toEqual(['import', 'export'])
    // Skipped items never reach apply.
    expect(ordered).toHaveLength(2)
  })
})
