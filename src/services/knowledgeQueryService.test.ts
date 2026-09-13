import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { noteRepo, tagRepo } from '@/repositories'
import { tagInput } from '../../tests/factories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { createNote, deleteNote, restoreNote, updateNote } from './noteService'
import {
  getAmbiguousLinks,
  getGraph,
  getNoteBacklinks,
  getNoteKnowledge,
  getNotesByTag,
  getOrphanNotes,
  getOutgoingLinks,
  getRelatedNotes,
  getUnresolvedLinks,
  resolveWikilinkTarget,
} from './knowledgeQueryService'

/**
 * The knowledge layer, against a real database.
 *
 * `knowledgeIndex.test.ts` proves the rules with no Dexie; this proves the
 * service reads the right rows and derives — never stores — the answers.
 */

const NOW = new Date(2026, 8, 7, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('outgoing links and backlinks', () => {
  it('A containing [[B]] gives B a backlink to A', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: 'See [[B]] for detail.' })

    const outgoing = await getOutgoingLinks(a.id)
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]).toMatchObject({ label: 'B', target: { noteId: b.id, title: 'B' } })

    const backlinks = await getNoteBacklinks(b.id)
    expect(backlinks.map((row) => row.noteId)).toEqual([a.id])
  })

  it('shows the alias as the label', async () => {
    await createNote({ title: 'Java DSA' })
    const a = await createNote({ title: 'A', body: '[[Java DSA|DSA]]' })

    expect((await getOutgoingLinks(a.id))[0]?.label).toBe('DSA')
  })

  it('does not duplicate a backlink when a note links twice', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: '[[B]] and again [[B]]' })

    const backlinks = await getNoteBacklinks(b.id)
    expect(backlinks).toHaveLength(1)
    // Both mentions are still available as context.
    expect(backlinks[0]?.contexts).toEqual(['[[B]]', '[[B]]'])
    expect(a.id).toBe(backlinks[0]?.noteId)
  })

  it('ignores a wikilink written inside code', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: 'Write `[[B]]` to link.' })

    expect(await getOutgoingLinks(a.id)).toEqual([])
    expect(await getNoteBacklinks(b.id)).toEqual([])
  })
})

describe('resolution against the database', () => {
  it('resolves by title, path and basename', async () => {
    const note = await createNote({ title: 'Binary Search' })
    const stored = await noteRepo.getOrThrow(note.id)

    expect(await resolveWikilinkTarget('Binary Search')).toMatchObject({ noteId: note.id })
    expect(await resolveWikilinkTarget('binary search')).toMatchObject({ noteId: note.id })
    expect(await resolveWikilinkTarget(stored.vaultPath as string)).toMatchObject({
      noteId: note.id,
    })
    expect(await resolveWikilinkTarget('binary-search')).toMatchObject({ noteId: note.id })
  })

  it('reports a target nothing matches as missing', async () => {
    expect(await resolveWikilinkTarget('Nothing')).toEqual({ status: 'missing' })
  })

  it('refuses to choose between two notes with the same title', async () => {
    await createNote({ title: 'Java' })
    await createNote({ title: 'Java' })

    const result = await resolveWikilinkTarget('Java')
    expect(result.status).toBe('ambiguous')
    if (result.status === 'ambiguous') expect(result.noteIds).toHaveLength(2)
  })

  it('reports a deleted target as deleted, not missing', async () => {
    const b = await createNote({ title: 'B' })
    await deleteNote(b.id)

    expect(await resolveWikilinkTarget('B')).toEqual({ status: 'deleted', noteId: b.id })
  })
})

describe('the deleted and restored cycle', () => {
  it('turns a resolved link into a deleted one, and back again', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: 'See [[B]].' })

    expect((await getNoteKnowledge(a.id))?.outgoing).toHaveLength(1)

    await deleteNote(b.id)
    const broken = await getNoteKnowledge(a.id)
    expect(broken?.outgoing).toEqual([])
    expect(broken?.unresolved[0]).toMatchObject({ reason: 'deleted', deletedNoteId: b.id })

    await restoreNote(b.id)
    const healed = await getNoteKnowledge(a.id)
    expect(healed?.outgoing).toHaveLength(1)
    expect(healed?.unresolved).toEqual([])
  })

  it('drops the edge from the graph while the target is deleted', async () => {
    const b = await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })

    expect((await getGraph()).edges).toHaveLength(1)
    await deleteNote(b.id)
    expect((await getGraph()).edges).toEqual([])
    expect((await getGraph()).nodes).toHaveLength(1)
  })
})

describe('heading links', () => {
  it('resolves the note and the heading, offering an anchor', async () => {
    await createNote({ title: 'Java DSA', body: '## Recursion\n\ntext\n' })
    const a = await createNote({ title: 'A', body: '[[Java DSA#Recursion]]' })

    const link = (await getOutgoingLinks(a.id))[0]
    expect(link).toMatchObject({ heading: 'Recursion', headingSlug: 'recursion', headingMissing: false })
  })

  it('keeps the note resolved when only the heading is missing', async () => {
    await createNote({ title: 'Java DSA', body: '## Recursion\n' })
    const a = await createNote({ title: 'A', body: '[[Java DSA#Nowhere]]' })

    const knowledge = await getNoteKnowledge(a.id)
    expect(knowledge?.outgoing[0]).toMatchObject({ headingMissing: true, headingSlug: null })
    expect(knowledge?.unresolved).toEqual([])
  })
})

describe('related notes', () => {
  it('scores links and shared tags deterministically', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const linked = await createNote({ title: 'Linked', tagIds: [tag.id] })
    const tagged = await createNote({ title: 'Tagged', tagIds: [tag.id] })
    const subject = await createNote({
      title: 'Subject',
      body: '[[Linked]]',
      tagIds: [tag.id],
    })

    const related = await getRelatedNotes(subject.id)
    expect(related.map((row) => [row.noteId, row.score])).toEqual([
      [linked.id, 7],
      [tagged.id, 2],
    ])
    expect(related[0]?.reasons.sort()).toEqual(['Linked from this note', 'Shares a tag'])
  })

  it('never includes the note itself or a deleted note', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const gone = await createNote({ title: 'Gone', tagIds: [tag.id] })
    const subject = await createNote({ title: 'Subject', tagIds: [tag.id] })
    await deleteNote(gone.id)

    expect(await getRelatedNotes(subject.id)).toEqual([])
  })
})

describe('orphans', () => {
  it('finds a note with no links either way', async () => {
    const lonely = await createNote({ title: 'Lonely' })
    const b = await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })

    const orphans = await getOrphanNotes()
    expect(orphans.map((row) => row.noteId)).toEqual([lonely.id])
    expect(b.id).not.toBe(lonely.id)
  })

  it('keeps a tagged note an orphan', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const tagged = await createNote({ title: 'Tagged', tagIds: [tag.id] })

    expect((await getOrphanNotes()).map((row) => row.noteId)).toEqual([tagged.id])
  })

  it('stops being an orphan once something links to it', async () => {
    const b = await createNote({ title: 'B' })
    expect(await getOrphanNotes()).toHaveLength(1)

    await createNote({ title: 'A', body: '[[B]]' })
    const orphans = await getOrphanNotes()
    expect(orphans.map((row) => row.noteId)).not.toContain(b.id)
  })

  it('excludes deleted notes', async () => {
    const gone = await createNote({ title: 'Gone' })
    await deleteNote(gone.id)
    expect(await getOrphanNotes()).toEqual([])
  })
})

describe('the graph', () => {
  it('builds nodes and edges from resolved links only', async () => {
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]] and [[Nowhere]]' })

    const graph = await getGraph()
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.unresolvedNoteIds).toHaveLength(1)
  })

  it('handles a cycle and a self-link', async () => {
    await createNote({ title: 'A', body: '[[B]]' })
    await createNote({ title: 'B', body: '[[C]]' })
    await createNote({ title: 'C', body: '[[A]] and [[C]]' })

    const graph = await getGraph()
    expect(graph.edges).toHaveLength(4)
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: expect.any(String), target: expect.any(String) }),
    )
  })

  it('narrows to one note neighbourhood', async () => {
    const b = await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]' })
    await createNote({ title: 'Far Away' })

    const graph = await getGraph({ focusNoteId: b.id, depth: 1 })
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map((node) => node.title).sort()).toEqual(['A', 'B'])
  })

  it('filters to orphans, tagged and unresolved', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Lonely' })
    await createNote({ title: 'Tagged', tagIds: [tag.id] })
    await createNote({ title: 'B' })
    await createNote({ title: 'Broken', body: '[[B]] [[Nowhere]]' })

    expect((await getGraph({ filter: 'orphans' })).nodes.map((n) => n.title).sort()).toEqual([
      'Lonely',
      'Tagged',
    ])
    expect((await getGraph({ filter: 'tagged' })).nodes.map((n) => n.title)).toEqual(['Tagged'])
    expect((await getGraph({ filter: 'unresolved' })).nodes.map((n) => n.title)).toEqual([
      'Broken',
    ])
  })

  it('keeps an edge only when both ends survive the filter', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'B' })
    await createNote({ title: 'A', body: '[[B]]', tagIds: [tag.id] })

    const graph = await getGraph({ filter: 'tagged' })
    expect(graph.nodes).toHaveLength(1)
    // B was filtered out, so the line to it is not drawn.
    expect(graph.edges).toEqual([])
  })

  it('filters by tag', async () => {
    const java = await tagRepo.create(tagInput({ name: 'java' }))
    const other = await tagRepo.create(tagInput({ name: 'other' }))
    await createNote({ title: 'Java note', tagIds: [java.id] })
    await createNote({ title: 'Other note', tagIds: [other.id] })

    expect((await getGraph({ tagId: java.id })).nodes.map((n) => n.title)).toEqual([
      'Java note',
    ])
  })

  it('is empty and harmless with no notes', async () => {
    expect(await getGraph()).toMatchObject({ nodes: [], edges: [], totalNodes: 0 })
  })
})

describe('problem links across the vault', () => {
  it('lists unresolved and ambiguous links grouped by note', async () => {
    await createNote({ title: 'Java' })
    await createNote({ title: 'Java' })
    await createNote({ title: 'Writer', body: '[[Java]] and [[Nowhere]]' })

    const unresolved = await getUnresolvedLinks()
    expect(unresolved[0]?.links[0]?.target).toBe('Nowhere')

    const ambiguous = await getAmbiguousLinks()
    expect(ambiguous[0]?.links[0]?.candidates).toHaveLength(2)
  })
})

describe('tags', () => {
  it('lists notes carrying a tag, using the existing relationship', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    await createNote({ title: 'Java Basics', tagIds: [tag.id] })
    await createNote({ title: 'Java DSA', tagIds: [tag.id] })
    await createNote({ title: 'Unrelated' })

    const result = await getNotesByTag(tag.id)
    expect(result.tag?.name).toBe('java')
    expect(result.notes.map((row) => row.title)).toEqual(['Java Basics', 'Java DSA'])
  })

  it('excludes deleted notes', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const gone = await createNote({ title: 'Gone', tagIds: [tag.id] })
    await deleteNote(gone.id)

    expect((await getNotesByTag(tag.id)).notes).toEqual([])
  })

  it('handles a tag that does not exist', async () => {
    expect(await getNotesByTag('nope')).toEqual({ tag: null, notes: [] })
  })
})

describe('the whole picture for one note', () => {
  it('assembles every section from one build', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const target = await createNote({ title: 'Target', tagIds: [tag.id] })
    await createNote({ title: 'Java' })
    await createNote({ title: 'Java' })
    const subject = await createNote({
      title: 'Subject',
      body: '[[Target]] [[Java]] [[Nowhere]]',
      tagIds: [tag.id],
    })
    await createNote({ title: 'Referrer', body: '[[Subject]]' })

    const knowledge = await getNoteKnowledge(subject.id)

    expect(knowledge?.outgoing.map((row) => row.target.noteId)).toEqual([target.id])
    expect(knowledge?.ambiguous).toHaveLength(1)
    expect(knowledge?.unresolved).toHaveLength(1)
    expect(knowledge?.backlinks.map((row) => row.title)).toEqual(['Referrer'])
    expect(knowledge?.related.map((row) => row.title)).toContain('Target')
    expect(knowledge?.graph.nodes.length).toBeGreaterThan(1)
    expect(knowledge?.isOrphan).toBe(false)
  })

  it('returns nothing for a note that does not exist or is deleted', async () => {
    const gone = await createNote({ title: 'Gone' })
    await deleteNote(gone.id)

    expect(await getNoteKnowledge('nope')).toBeUndefined()
    expect(await getNoteKnowledge(gone.id)).toBeUndefined()
  })

  it('reports an isolated note as an orphan', async () => {
    const lonely = await createNote({ title: 'Lonely' })
    expect((await getNoteKnowledge(lonely.id))?.isOrphan).toBe(true)
  })
})

describe('the knowledge layer is read-only', () => {
  it('writes no event and changes no row', async () => {
    const tag = await tagRepo.create(tagInput({ name: 'java' }))
    const b = await createNote({ title: 'B', tagIds: [tag.id] })
    const a = await createNote({ title: 'A', body: '[[B]] [[Nowhere]]', tagIds: [tag.id] })

    const notesBefore = await noteRepo.listLive()
    const linksBefore = await db.noteLinks.toArray()
    const eventsBefore = new Set((await db.events.toArray()).map((row) => row.id))

    await getNoteKnowledge(a.id)
    await getOutgoingLinks(a.id)
    await getNoteBacklinks(b.id)
    await getRelatedNotes(a.id)
    await getOrphanNotes()
    await getGraph()
    await getGraph({ focusNoteId: a.id })
    await getUnresolvedLinks()
    await getAmbiguousLinks()
    await getNotesByTag(tag.id)
    await resolveWikilinkTarget('B')

    // Nothing was written: no note touched, no relationship invented, no event.
    expect(await noteRepo.listLive()).toEqual(notesBefore)
    expect(await db.noteLinks.toArray()).toEqual(linksBefore)
    const added = (await db.events.toArray()).filter((row) => !eventsBefore.has(row.id))
    expect(added).toEqual([])
  })

  it('never creates a noteLinks row from a wikilink', async () => {
    await createNote({ title: 'B' })
    const a = await createNote({ title: 'A', body: '[[B]]' })

    await getNoteKnowledge(a.id)
    await getGraph()

    // `noteLinks` remains the explicit note-to-entity table; wikilinks are
    // prose and never manufacture rows in it.
    expect(await db.noteLinks.count()).toBe(0)
  })

  it('reflects an edit immediately, because nothing is cached', async () => {
    const b = await createNote({ title: 'B' })
    const a = await createNote({ title: 'A' })

    expect(await getNoteBacklinks(b.id)).toEqual([])
    await updateNote(a.id, { body: '[[B]]' })
    expect((await getNoteBacklinks(b.id)).map((row) => row.noteId)).toEqual([a.id])
  })
})
