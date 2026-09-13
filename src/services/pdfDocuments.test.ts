import { beforeEach, describe, expect, it } from 'vitest'
import { buildAiContext } from '@/ai/context/aiContextBuilder'
import { AI_CONTEXT_LIMITS } from '@/ai/context/aiContextLimits'
import { purposeFor } from '@/ai/context/aiContextPurpose'
import type { AiSourceData } from '@/ai/context/aiContextTypes'
import type { SyncDecision, SyncPlan } from '@/integrations/obsidian/syncPlan'
import { UnsafeVaultPathError } from '@/integrations/obsidian/vaultPath'
import { createMemoryVault, type MemoryVault } from '@/platform/browser/memoryVault'
import { noteRepo, vaultDocumentRepo, vaultLinkRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { readAiSource } from './ai/aiReadModel'
import { listDocuments, searchKnowledge } from './documentQueryService'
import { getNotesView } from './noteQueryService'
import { connectVault, scanVault, setVaultPort } from './obsidianService'
import { applySync, scanVaultPlan } from './obsidianSyncService'

/**
 * PDFs from an Obsidian vault, end to end.
 *
 * The whole path with nothing stubbed between the vault adapter and the screens
 * that read the result: connect → scan → plan → apply → documents, search, and
 * the AI context. The design under test is that a PDF is a *different domain
 * object* from a Note but travels the *same pipeline* — so these assert both
 * halves: that documents never leak into the Notes store, and that they obey
 * the plan → review → apply rules Markdown already obeys.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)
let vault: MemoryVault

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  vault = createMemoryVault({ name: 'vaultwork-test-vault' })
  setVaultPort(vault)
  await connectVault()
})

/** A vault with both kinds in it, nested, plus files that are neither. */
async function seedMixedVault(): Promise<void> {
  await vault.createDirectory('Java')
  await vault.createDirectory('DSA')
  await vault.createDirectory('System Design')
  await vault.createDirectory('.obsidian')

  vault.seed('note1.md', '# Note one\n\nFirst.')
  vault.seed('note2.md', '# Note two\n\nSecond.')
  vault.seed('Java/inheritance.md', '# Inheritance\n\nThird.')
  vault.seed('DSA/recursion.md', '# Recursion\n\nFourth.')

  vault.seedPdf(
    'System Design/System Design Basics.pdf',
    'Consistent hashing spreads keys across nodes. A load balancer distributes requests evenly.',
  )

  // Neither kind, and Obsidian's own state.
  vault.seed('diagram.png', 'binary')
  vault.seed('clip.mp4', 'binary')
  vault.seed('.obsidian/workspace.json', '{}')
}

const decideAll = (plan: SyncPlan, status: string, decision: SyncDecision) =>
  Object.fromEntries(
    plan.items.map((item) => [item.key, item.status === status ? decision : 'skip']),
  ) as Record<string, SyncDecision>

const importEverything = async () => {
  const plan = await scanVaultPlan()
  return applySync(plan, decideAll(plan, 'untracked', 'import'))
}

const itemFor = (plan: SyncPlan, path: string) => plan.items.find((item) => item.path === path)

/** A source snapshot with nothing in it, for driving the builder directly. */
const emptySource = (): AiSourceData => ({
  today: '2026-09-06',
  now: NOW.getTime(),
  rankedOpenTasks: [],
  projects: [],
  goals: [],
  habits: [],
  notes: [],
  documents: [],
  counts: { openTasks: 0, dueToday: 0, overdue: 0 },
  totals: { tasks: 0, projects: 0, goals: 0, habits: 0, notes: 0, documents: 0 },
  projectNames: new Map(),
  tagNames: new Map(),
})

// ------------------------------------------------------------------ discovery

describe('discovery', () => {
  beforeEach(seedMixedVault)

  it('finds Markdown and PDFs, and counts them apart', async () => {
    const plan = await scanVaultPlan()

    expect(plan.seen).toEqual({ markdown: 4, pdf: 1 })
    // The two files that are neither. `.obsidian` was never opened.
    expect(plan.skipped.nonMarkdown).toBe(2)
    expect(plan.skipped.ignoredDirectories).toBe(1)
    expect(plan.errors).toEqual([])
  })

  it('finds a PDF nested several folders deep', async () => {
    await vault.createDirectory('System Design/Advanced')
    vault.seedPdf('System Design/Advanced/Sharding.pdf', 'Sharding splits data horizontally.')

    const plan = await scanVaultPlan()
    expect(itemFor(plan, 'System Design/Advanced/Sharding.pdf')?.itemKind).toBe('document')
    expect(plan.seen.pdf).toBe(2)
  })

  it('recognises the extension whatever case it is written in', async () => {
    vault.seedPdf('Upper.PDF', 'Uppercase extension.')
    vault.seedPdf('Mixed.Pdf', 'Mixed extension.')

    const plan = await scanVaultPlan()
    expect(plan.seen.pdf).toBe(3)
    for (const path of ['Upper.PDF', 'Mixed.Pdf']) {
      expect(itemFor(plan, path)?.itemKind, path).toBe('document')
    }
  })

  it('never opens .obsidian, whatever is inside it', async () => {
    vault.seedPdf('.obsidian/plugin-manual.pdf', 'Plugin internals.')

    const plan = await scanVaultPlan()
    expect(plan.items.some((item) => item.path?.includes('.obsidian'))).toBe(false)
  })

  it('leaves every other file type alone', async () => {
    for (const name of ['a.jpeg', 'b.webp', 'c.zip', 'd.json', 'e.canvas']) {
      vault.seed(name, 'binary')
    }

    const plan = await scanVaultPlan()
    const paths = plan.items.map((item) => item.path)
    for (const name of ['a.jpeg', 'b.webp', 'c.zip', 'd.json', 'e.canvas', 'diagram.png']) {
      expect(paths, name).not.toContain(name)
    }
  })

  it('reports both kinds through the Obsidian page scan too', async () => {
    const scan = await scanVault()

    expect(scan.seen).toEqual({ markdown: 4, pdf: 1 })
    expect(scan.untrackedDocuments).toEqual(['System Design/System Design Basics.pdf'])
    expect(scan.untracked).toHaveLength(4)
  })
})

// --------------------------------------------------------------------- import

describe('importing a PDF', () => {
  beforeEach(seedMixedVault)

  it('is never silent: a scan alone stores nothing', async () => {
    await scanVaultPlan()
    expect(await vaultDocumentRepo.listLive()).toEqual([])
    expect(vault.files.has('System Design/System Design Basics.pdf')).toBe(true)
  })

  it('stores the extracted text with the metadata change detection needs', async () => {
    await importEverything()

    const [document] = await vaultDocumentRepo.listLive()
    expect(document).toMatchObject({
      title: 'System Design Basics',
      vaultPath: 'System Design/System Design Basics.pdf',
      kind: 'pdf',
      extraction: 'ok',
    })
    expect(document?.text).toContain('Consistent hashing')
    expect(document?.hash.length).toBeGreaterThan(0)
    expect(document?.bytes).toBeGreaterThan(0)
    expect(document?.chars).toBe(document?.text.length)
    expect(document?.importedAt).toBeGreaterThan(0)
  })

  it('does not modify the PDF in the vault', async () => {
    const before = new Map(vault.files)
    await importEverything()
    expect([...vault.files.entries()]).toEqual([...before.entries()])
  })

  it('records a baseline through the same table notes use', async () => {
    await importEverything()

    const [document] = await vaultDocumentRepo.listLive()
    const links = await vaultLinkRepo.listLive()
    const link = links.find((row) => row.entityId === document?.id)
    expect(link).toMatchObject({
      entityType: 'document',
      path: 'System Design/System Design Basics.pdf',
    })
  })

  it('imports only what was chosen', async () => {
    const plan = await scanVaultPlan()
    const pdf = itemFor(plan, 'System Design/System Design Basics.pdf')
    const decisions = Object.fromEntries(
      plan.items.map((item) => [item.key, 'skip']),
    ) as Record<string, SyncDecision>
    decisions[pdf!.key] = 'import'

    await applySync(plan, decisions)

    expect(await vaultDocumentRepo.listLive()).toHaveLength(1)
    // Nothing else moved: the four Markdown files were left as they were.
    expect((await getNotesView()).notes).toEqual([])
  })

  it('is not selected by "select safe changes"', async () => {
    const { safeDecisions } = await import('@/integrations/obsidian/syncPlan')
    const plan = await scanVaultPlan()

    const safe = safeDecisions(plan)
    const pdf = itemFor(plan, 'System Design/System Design Basics.pdf')
    // Reading a file and creating rows is a decision the user makes per
    // document, exactly as it is for an untracked Markdown file.
    expect(safe[pdf!.key]).toBe('skip')
  })
})

// ------------------------------------------------------- notes stay notes

describe('a PDF is not a Note', () => {
  beforeEach(seedMixedVault)

  it('never appears in the Notes store or the Notes page', async () => {
    const plan = await scanVaultPlan()
    await applySync(plan, decideAll(plan, 'untracked', 'import'))

    const view = await getNotesView()
    expect(view.notes).toHaveLength(4)
    expect(view.notes.map((note) => note.title).sort()).toEqual([
      'inheritance',
      'note1',
      'note2',
      'recursion',
    ])
    // Not by title, and not by path either.
    expect(view.notes.some((note) => note.title.includes('System Design'))).toBe(false)
    expect((await noteRepo.listLive()).some((note) => note.vaultPath?.endsWith('.pdf'))).toBe(
      false,
    )
  })

  it('lives in exactly one store, not two', async () => {
    await importEverything()

    expect(await vaultDocumentRepo.listLive()).toHaveLength(1)
    expect(await noteRepo.listLive()).toHaveLength(4)
  })
})

// ------------------------------------------------------------- extraction

describe('extraction', () => {
  it('marks a PDF with no text layer rather than pretending to have read it', async () => {
    // A scan of a photographed page. There is no OCR in this milestone, and
    // claiming otherwise would put invented content into a search index.
    vault.seedPdf('scan.pdf', '')
    await importEverything()

    const [document] = await vaultDocumentRepo.listLive()
    expect(document?.extraction).toBe('empty')
    expect(document?.text).toBe('')
    // It is still a document. The file is recognised even when its text is not.
    expect(document?.kind).toBe('pdf')
    expect(document?.title).toBe('scan')
  })

  it('bounds a very large document and says that it did', async () => {
    vault.seedPdf('huge.pdf', 'x'.repeat(50_000))
    await importEverything()

    const [document] = await vaultDocumentRepo.listLive()
    expect(document?.extraction).toBe('truncated')
    // The adapter's ceiling held; the whole document did not reach the store.
    expect(document?.chars).toBeLessThan(50_000)
    expect(document?.text.length).toBe(document?.chars)
  })

  it('surfaces an empty document in the list with an explanation', async () => {
    vault.seedPdf('scan.pdf', '')
    await importEverything()

    const [summary] = await listDocuments()
    expect(summary?.extraction).toBe('empty')
    expect(summary).not.toHaveProperty('text')
  })
})

// ------------------------------------------------------------------ search

describe('search', () => {
  beforeEach(async () => {
    await seedMixedVault()
    await importEverything()
  })

  it('finds text inside a PDF and says where it came from', async () => {
    const hits = await searchKnowledge('consistent hashing')

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      sourceType: 'pdf',
      title: 'System Design Basics',
      path: 'System Design/System Design Basics.pdf',
    })
    expect(hits[0]?.snippet).toContain('Consistent hashing')
  })

  it('returns notes and documents together, each labelled', async () => {
    const hits = await searchKnowledge('recursion')
    expect(hits.some((hit) => hit.sourceType === 'note')).toBe(true)

    const both = await searchKnowledge('e')
    expect(new Set(both.map((hit) => hit.sourceType))).toEqual(new Set(['note', 'pdf']))
  })

  it('can be narrowed to one kind', async () => {
    const pdfsOnly = await searchKnowledge('a', { sourceType: 'pdf' })
    expect(pdfsOnly.every((hit) => hit.sourceType === 'pdf')).toBe(true)

    const notesOnly = await searchKnowledge('note', { sourceType: 'note' })
    expect(notesOnly.every((hit) => hit.sourceType === 'note')).toBe(true)
  })

  it('needs every term, so a second word narrows', async () => {
    expect(await searchKnowledge('consistent hashing')).toHaveLength(1)
    expect(await searchKnowledge('consistent unicorn')).toEqual([])
  })

  it('is deterministic and needs no provider', async () => {
    // No AI is configured in this test at all; search still answers, twice the
    // same way. Knowledge search must never depend on a model.
    const first = await searchKnowledge('load balancer')
    const second = await searchKnowledge('load balancer')
    expect(first).toEqual(second)
    expect(first[0]?.sourceType).toBe('pdf')
  })

  it('returns nothing for an empty query rather than everything', async () => {
    expect(await searchKnowledge('')).toEqual([])
    expect(await searchKnowledge('   ')).toEqual([])
  })

  it('cannot match a PDF that has no text', async () => {
    vault.seedPdf('scan.pdf', '')
    await importEverything()
    expect(await searchKnowledge('anything')).toEqual([])
  })
})

// --------------------------------------------------------- change detection

describe('change detection', () => {
  beforeEach(async () => {
    await seedMixedVault()
    await importEverything()
  })

  const PDF = 'System Design/System Design Basics.pdf'

  it('is idempotent: re-scanning creates no duplicate document', async () => {
    for (let round = 0; round < 3; round += 1) {
      const plan = await scanVaultPlan()
      expect(itemFor(plan, PDF)?.status).toBe('clean')
      await applySync(plan, decideAll(plan, 'untracked', 'import'))
    }

    expect(await vaultDocumentRepo.listLive()).toHaveLength(1)
  })

  it('reports a changed PDF as a pending change and writes nothing on its own', async () => {
    vault.seedPdf(PDF, 'Rewritten: quorum reads and writes.')

    const plan = await scanVaultPlan()
    expect(itemFor(plan, PDF)?.status).toBe('external-change')

    // Applying with the default decisions — everything on skip — must not
    // replace the stored text.
    await applySync(plan, Object.fromEntries(plan.items.map((i) => [i.key, 'skip'])))
    const [document] = await vaultDocumentRepo.listLive()
    expect(document?.text).toContain('Consistent hashing')
  })

  it('re-reads only when the user asks, and replaces rather than duplicating', async () => {
    vault.seedPdf(PDF, 'Rewritten: quorum reads and writes.')

    const plan = await scanVaultPlan()
    const result = await applySync(plan, decideAll(plan, 'external-change', 'import'))

    expect(result.imported).toBe(1)
    const documents = await vaultDocumentRepo.listLive()
    expect(documents).toHaveLength(1)
    expect(documents[0]?.text).toContain('quorum reads')
    // And the re-read settles: the next scan is clean.
    expect(itemFor(await scanVaultPlan(), PDF)?.status).toBe('clean')
  })

  it('reports a deleted PDF as missing and deletes nothing locally', async () => {
    vault.files.delete(PDF)

    const plan = await scanVaultPlan()
    const item = plan.items.find((row) => row.key === `pdf:${PDF}`)
    expect(item?.status).toBe('missing')
    expect(item?.message).toContain('Nothing here was deleted')

    await applySync(plan, Object.fromEntries(plan.items.map((i) => [i.key, 'skip'])))
    expect(await vaultDocumentRepo.listLive()).toHaveLength(1)
  })

  it('forgets a missing document only when told to, and touches no file', async () => {
    vault.files.delete(PDF)
    const plan = await scanVaultPlan()
    const before = new Map(vault.files)

    await applySync(plan, decideAll(plan, 'missing', 'forget-link'))

    expect(await vaultDocumentRepo.listLive()).toEqual([])
    expect([...vault.files.entries()]).toEqual([...before.entries()])
  })
})

// ------------------------------------------------------------ safety rules

describe('safety', () => {
  it('never offers to write a PDF back to the vault', async () => {
    const { documentOptionsFor } = await import('@/integrations/obsidian/syncPlan')

    for (const status of ['untracked', 'external-change', 'missing', 'clean'] as const) {
      const decisions = documentOptionsFor(status).map((option) => option.decision)
      // The whole export side is absent, because Vaultwork cannot write a PDF.
      for (const forbidden of ['export', 'keep-local', 'restore-to-vault', 'delete-from-vault']) {
        expect(decisions, `${status} must not offer ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('never merges: a changed PDF leaves both sides alone until a decision', async () => {
    await seedMixedVault()
    await importEverything()
    const PDF = 'System Design/System Design Basics.pdf'

    vault.seedPdf(PDF, 'A completely different document.')
    const plan = await scanVaultPlan()
    const fileBefore = vault.files.get(PDF)
    const storedBefore = (await vaultDocumentRepo.listLive())[0]?.text

    await applySync(plan, Object.fromEntries(plan.items.map((i) => [i.key, 'skip'])))

    // Neither side moved, and nothing was blended from the two.
    expect(vault.files.get(PDF)).toBe(fileBefore)
    expect((await vaultDocumentRepo.listLive())[0]?.text).toBe(storedBefore)
    expect(itemFor(await scanVaultPlan(), PDF)?.status).toBe('external-change')
  })

  it('refuses a PDF path that leaves the vault', async () => {
    await expect(vault.readPdfText('../outside.pdf')).rejects.toBeInstanceOf(UnsafeVaultPathError)
    await expect(vault.readPdfText('/etc/secret.pdf')).rejects.toBeInstanceOf(
      UnsafeVaultPathError,
    )
    await expect(vault.readPdfText('a/../../outside.pdf')).rejects.toBeInstanceOf(
      UnsafeVaultPathError,
    )
  })

  it('records a traversing entry as an error rather than reading it', async () => {
    vault.seedPdf('ok.pdf', 'Fine.')
    const read: string[] = []
    setVaultPort({
      ...vault,
      listDirectory: async (path = '') => {
        const entries = await vault.listDirectory(path)
        return path === ''
          ? [...entries, { name: 'escape.pdf', path: '../escape.pdf', kind: 'file' as const }]
          : entries
      },
      readPdfText: async (path: string) => {
        read.push(path)
        return vault.readPdfText(path)
      },
    })

    const plan = await scanVaultPlan()

    expect(plan.items.map((item) => item.path)).toEqual(['ok.pdf'])
    expect(plan.errors).toEqual([{ path: '../escape.pdf', message: 'Unsafe path; skipped.' }])
    // The important half: it was never opened.
    expect(read).toEqual(['ok.pdf'])
  })
})

// ------------------------------------------------------------- AI context

describe('the AI context', () => {
  beforeEach(async () => {
    await seedMixedVault()
    await importEverything()
  })

  it('routes a question about a PDF to the documents profile', () => {
    expect(purposeFor('Summarize the System Design PDF')).toBe('documents')
    expect(purposeFor('what does my document say about hashing')).toBe('documents')
    // And an ordinary request is unaffected.
    expect(purposeFor('what tasks are due today')).toBe('tasks')
    expect(purposeFor('plan my revision')).toBe('planning')
  })

  it('carries a bounded passage of the matching document, and nothing else', async () => {
    const source = await readAiSource('documents', 'summarize the system design pdf hashing')
    const context = buildAiContext(source, 'documents')

    expect(context.documents.length).toBeGreaterThan(0)
    expect(context.documents[0]?.title).toBe('System Design Basics')
    // The narrowest profile that carries data: a question about a document is
    // not a reason to send someone's tasks, goals or habits.
    expect(context.tasks).toEqual([])
    expect(context.goals).toEqual([])
    expect(context.habits).toEqual([])
    expect(context.notes).toEqual([])
  })

  it('never sends more than the document limits allow', async () => {
    vault.seedPdf('big.pdf', `hashing ${'y'.repeat(4_000)}`)
    await importEverything()

    const source = await readAiSource('documents', 'hashing')
    const context = buildAiContext(source, 'documents')

    expect(context.documents.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.documents)
    for (const document of context.documents) {
      expect(document.passage.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.documentChars)
    }
  })

  /*
   * The two below drive `buildAiContext` with a *hand-made* source rather than
   * one the retrieval layer produced.
   *
   * That matters: retrieval already keeps passages short and already returns
   * nothing off-profile, so a test that only goes through it would pass even if
   * the builder's own clipping and section set were removed. The builder is the
   * security boundary, so it is tested as one — against input it would never
   * receive in practice, which is exactly the input a bug would produce.
   */
  it('clips a passage that arrives longer than the ceiling', () => {
    const oversized = 'z'.repeat(AI_CONTEXT_LIMITS.documentChars * 4)
    const context = buildAiContext(
      {
        ...emptySource(),
        documents: [
          { title: 'Huge', path: 'a/Huge.pdf', passage: oversized, totalChars: oversized.length },
        ],
        totals: { tasks: 0, projects: 0, goals: 0, habits: 0, notes: 0, documents: 1 },
      },
      'documents',
    )

    expect(context.documents[0]?.passage.length).toBeLessThanOrEqual(
      AI_CONTEXT_LIMITS.documentChars,
    )
    // And it says it was cut, rather than leaving a model to summarise a
    // document whose second half it never saw.
    expect(context.documents[0]?.clipped).toBe(true)
  })

  it('drops documents on every profile that does not carry them', () => {
    const withDocuments = {
      ...emptySource(),
      documents: [
        { title: 'Secret', path: 'a/Secret.pdf', passage: 'confidential', totalChars: 12 },
      ],
      totals: { tasks: 0, projects: 0, goals: 0, habits: 0, notes: 0, documents: 1 },
    }

    // Even handed a document, a non-document profile must not carry it: the
    // section set is the control, not what the read model happened to fetch.
    for (const purpose of ['general', 'tasks', 'planning'] as const) {
      const context = buildAiContext(withDocuments, purpose)
      expect(context.documents, purpose).toEqual([])
      expect(JSON.stringify(context), purpose).not.toContain('confidential')
    }
    expect(buildAiContext(withDocuments, 'documents').documents).toHaveLength(1)
  })

  it('sends nothing when the question matches no document', async () => {
    const source = await readAiSource('documents', 'quantum tunnelling in semiconductors')
    expect(buildAiContext(source, 'documents').documents).toEqual([])
  })

  it('carries no document at all on any other profile', async () => {
    for (const purpose of ['general', 'tasks', 'planning'] as const) {
      const source = await readAiSource(purpose, 'summarize the system design pdf')
      expect(buildAiContext(source, purpose).documents, purpose).toEqual([])
    }
  })

  it('cannot reach a document that was never imported', async () => {
    await vaultDocumentRepo.softDelete((await vaultDocumentRepo.listLive())[0]!.id)

    const source = await readAiSource('documents', 'consistent hashing')
    // The AI reads the store, never the filesystem: a file that has not been
    // explicitly imported is not reachable from a prompt.
    expect(buildAiContext(source, 'documents').documents).toEqual([])
    expect(vault.files.has('System Design/System Design Basics.pdf')).toBe(true)
  })
})
