import { describe, expect, it } from 'vitest'
import type { Provenance } from '@/types/entities'
import { KNOWLEDGE_KINDS } from '@/types/enums'
import {
  buildResearchPack,
  KNOWLEDGE_SECTIONS,
  knowledgeBody,
  RESEARCH_PACK_LIMITS,
  RESEARCH_PACK_ROOT,
  sanitizeProvenance,
  type ResearchPackInput,
  type ResearchPackNote,
} from './knowledge'
import { parseNoteFile, serializeNote } from './noteFile'

/**
 * M18.2's pure half: what an artifact looks like, what provenance may say, and
 * what a research pack contains. No database and no vault — every rule here is
 * a function of its arguments, so it is asserted directly.
 */

const AT = Date.parse('2026-09-21T09:30:00.000Z')

describe('knowledge templates', () => {
  it('gives every kind its own section headings', () => {
    for (const kind of KNOWLEDGE_KINDS) {
      const body = knowledgeBody(kind)
      for (const heading of KNOWLEDGE_SECTIONS[kind]) {
        expect(body, `${kind} should open with ${heading}`).toContain(`## ${heading}\n`)
      }
    }
  })

  it('writes the decision format in a stable order', () => {
    expect(knowledgeBody('decision', ['Vaultwork'])).toBe(
      [
        '## Context',
        '',
        '## Decision',
        '',
        '## Reasoning',
        '',
        '## Consequences',
        '',
        '## Related',
        '',
        '- [[Vaultwork]]',
        '',
      ].join('\n'),
    )
  })

  it('links related entities as wikilinks, once each, in the order given', () => {
    const body = knowledgeBody('brief', ['Vaultwork', 'Database', 'Vaultwork', '  '])
    expect(body).toContain('- [[Vaultwork]]\n- [[Database]]')
    expect(body.match(/\[\[Vaultwork\]\]/g)).toHaveLength(1)
  })

  it('writes no Related section when there is nothing to relate', () => {
    expect(knowledgeBody('review')).not.toContain('## Related')
  })

  it('is byte-identical across calls', () => {
    expect(knowledgeBody('research', ['A', 'B'])).toBe(knowledgeBody('research', ['A', 'B']))
  })
})

describe('provenance', () => {
  it('keeps a well-formed provenance', () => {
    expect(
      sanitizeProvenance({
        source: 'web',
        sourceId: 'article-42',
        sourceUrl: 'https://example.com/post?id=7',
        capturedAt: AT,
      }),
    ).toEqual({
      source: 'web',
      sourceId: 'article-42',
      sourceUrl: 'https://example.com/post?id=7',
      capturedAt: AT,
    })
  })

  it('refuses a source it does not know, rather than storing it as-is', () => {
    expect(sanitizeProvenance({ source: 'gmail-api' })).toBeNull()
    expect(sanitizeProvenance(null)).toBeNull()
    expect(sanitizeProvenance('web')).toBeNull()
  })

  it('refuses URLs a click should never follow', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'nope']) {
      expect(sanitizeProvenance({ source: 'web', sourceUrl: url })?.sourceUrl, url).toBeNull()
    }
  })

  it('drops a URL carrying a credential in its address', () => {
    expect(
      sanitizeProvenance({ source: 'web', sourceUrl: 'https://me:hunter2@example.com/x' })
        ?.sourceUrl,
    ).toBeNull()
  })

  it('strips secret-shaped query parameters and keeps the address', () => {
    const url = sanitizeProvenance({
      source: 'email',
      sourceUrl:
        'https://mail.example.com/msg?id=9&access_token=ya29.SECRET&api_key=KEY123&X-Amz-Signature=abc&page=2#access_token=ALSO',
    })?.sourceUrl

    expect(url).toBe('https://mail.example.com/msg?id=9&page=2')
    for (const secret of ['SECRET', 'KEY123', 'abc', 'ALSO', 'token', 'key', 'Signature']) {
      expect(url).not.toContain(secret)
    }
  })

  it('removes control characters and bounds the source id', () => {
    const provenance = sanitizeProvenance({
      source: 'calendar',
      sourceId: 'evt\n1\u0000' + 'x'.repeat(500),
      capturedAt: Number.NaN,
    })
    expect(provenance?.sourceId).not.toContain('\n')
    expect(provenance?.sourceId).not.toContain('\u0000')
    expect(provenance?.sourceId?.length).toBeLessThanOrEqual(200)
    expect(provenance?.capturedAt).toBeNull()
  })
})

describe('knowledge frontmatter', () => {
  const provenance: Provenance = {
    source: 'vaultwork',
    sourceId: 'project-1',
    sourceUrl: null,
    capturedAt: AT,
  }
  const base = { id: 'n1', title: 'Use Dexie', body: 'body\n', createdAt: AT, updatedAt: AT }

  it('writes an ordinary note byte-identically to before M18.2', () => {
    // No new key on an ordinary note, so no existing exported file changes
    // hash and no sync status moves.
    const plain = serializeNote(base)
    expect(serializeNote({ ...base, kind: null, provenance: null })).toBe(plain)
    expect(plain).not.toContain('vaultwork-')
  })

  it('writes kind and provenance as namespaced, flat keys', () => {
    const file = serializeNote({ ...base, kind: 'decision', provenance })
    expect(file).toContain('vaultwork-kind: decision\n')
    expect(file).toContain('vaultwork-source: vaultwork\n')
    expect(file).toContain('vaultwork-source-id: "project-1"\n')
    expect(file).toContain('vaultwork-captured: "2026-09-21T09:30:00.000Z"\n')
    // Never the bare keys a user is likely to own.
    expect(file).not.toMatch(/^type:/m)
    expect(file).not.toMatch(/^source:/m)
  })

  it('round-trips kind and provenance through a file', () => {
    const parsed = parseNoteFile(serializeNote({ ...base, kind: 'decision', provenance }))
    expect(parsed.kind).toBe('decision')
    expect(parsed.provenance).toEqual(provenance)
    expect(parsed.body).toBe('body\n')
  })

  it("leaves the user's own type and source keys alone", () => {
    const theirs = [
      '---',
      'id: "n1"',
      'title: Use Dexie',
      'type: book',
      'source: a friend',
      'vaultwork-kind: decision',
      '---',
      '',
      'body',
      '',
    ].join('\n')
    const parsed = parseNoteFile(theirs)
    expect(parsed.frontmatter.unknown).toEqual(['type: book', 'source: a friend'])

    const rewritten = serializeNote(
      { ...base, kind: 'decision', provenance: null },
      { existing: parsed.frontmatter },
    )
    expect(rewritten).toContain('type: book\n')
    expect(rewritten).toContain('source: a friend\n')
    // Owned once — a re-export must not duplicate a key it parsed.
    expect(rewritten.match(/vaultwork-kind:/g)).toHaveLength(1)
  })

  it('reads an unknown kind as none, and cleans a provenance URL from a file', () => {
    const parsed = parseNoteFile(
      [
        '---',
        'vaultwork-kind: manifesto',
        'vaultwork-source: web',
        'vaultwork-source-url: "https://x.example/a?token=LEAK&p=1"',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    )
    expect(parsed.kind).toBeNull()
    expect(parsed.provenance?.sourceUrl).toBe('https://x.example/a?p=1')
  })
})

describe('research packs', () => {
  const note = (index: number, overrides: Partial<ResearchPackNote> = {}): ResearchPackNote => ({
    title: `Note ${index}`,
    body: `Body ${index}\n`,
    kind: 'research',
    provenance: { source: 'user', sourceId: null, sourceUrl: null, capturedAt: null },
    vaultPath: `notes/note-${index}.md`,
    updatedAt: AT - index,
    ...overrides,
  })

  const input = (overrides: Partial<ResearchPackInput> = {}): ResearchPackInput => ({
    project: { name: 'DSA Mastery', status: 'active', deadline: null, progress: 40, remaining: 6 },
    notes: [note(1), note(2)],
    documents: [{ title: 'System Design', vaultPath: 'papers/system-design.pdf' }],
    generatedAt: AT,
    ...overrides,
  })

  it('writes into the hidden pack folder, dated to the minute', () => {
    expect(buildResearchPack(input()).folder).toBe(
      `${RESEARCH_PACK_ROOT}/dsa-mastery-20260921-0930`,
    )
    expect(RESEARCH_PACK_ROOT.startsWith('.')).toBe(true)
  })

  it('is deterministic in its input', () => {
    expect(buildResearchPack(input())).toEqual(buildResearchPack(input()))
  })

  it('writes a manifest and one file per note, newest first, with provenance', () => {
    const pack = buildResearchPack(input())
    expect(pack.files.map((file) => file.name)).toEqual([
      'README.md',
      '01-note-1.md',
      '02-note-2.md',
    ])

    const readme = pack.files[0]?.contents ?? ''
    expect(readme).toContain('# Research pack — DSA Mastery')
    expect(readme).toContain('Progress: 40% (6 open tasks)')
    expect(readme).toContain('- System Design — `papers/system-design.pdf`')

    const first = pack.files[1]?.contents ?? ''
    expect(first.startsWith('# Note 1\n')).toBe(true)
    expect(first).toContain('> Research · Source: You')
    expect(first).toContain('> Obsidian: notes/note-1.md')
    expect(first).toContain('Body 1')
  })

  it('carries no Vaultwork ids or frontmatter into the pack', () => {
    const pack = buildResearchPack(input())
    for (const file of pack.files) {
      expect(file.contents.startsWith('---'), file.name).toBe(false)
      expect(file.contents, file.name).not.toMatch(/^id:/m)
    }
  })

  it('caps notes and documents, and says what it left out', () => {
    const many = Array.from({ length: RESEARCH_PACK_LIMITS.notes + 10 }, (_, i) => note(i))
    const documents = Array.from({ length: RESEARCH_PACK_LIMITS.documents + 3 }, (_, i) => ({
      title: `Doc ${i}`,
      vaultPath: `papers/doc-${String(i).padStart(3, '0')}.pdf`,
    }))
    const pack = buildResearchPack(input({ notes: many, documents }))

    expect(pack.files).toHaveLength(RESEARCH_PACK_LIMITS.notes + 1)
    expect(pack.documents).toHaveLength(RESEARCH_PACK_LIMITS.documents)
    expect(pack.omitted).toEqual({ notes: 10, documents: 3 })
    expect(pack.files[0]?.contents).toContain('10 notes and 3 documents exceeded')
  })

  it('says so when a project has no notes yet', () => {
    const pack = buildResearchPack(input({ notes: [], documents: [] }))
    expect(pack.files).toHaveLength(1)
    expect(pack.files[0]?.contents).toContain('No notes are linked to this project yet.')
    expect(pack.files[0]?.contents).toContain('None cited.')
  })
})
