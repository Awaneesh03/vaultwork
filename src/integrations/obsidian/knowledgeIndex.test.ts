import { describe, expect, it } from 'vitest'
import {
  basenameOf,
  buildGraph,
  buildKnowledgeIndex,
  localGraph,
  orphanIds,
  relatedNotes,
  resolveTarget,
  type KnowledgeNote,
} from './knowledgeIndex'

/**
 * The knowledge layer, with no database and no filesystem.
 *
 * The load-bearing cases are the ones where guessing would be wrong: an
 * ambiguous target must never resolve, a deleted target must be distinguishable
 * from a missing one, and a note nobody links to must stay an orphan however
 * many tags it carries.
 */

let seq = 0
const note = (over: Partial<KnowledgeNote> = {}): KnowledgeNote => {
  seq += 1
  return {
    id: `n${seq}`,
    title: `Note ${seq}`,
    body: '',
    tagIds: [],
    vaultPath: `notes/note-${seq}.md`,
    updatedAt: seq,
    deleted: false,
    ...over,
  }
}

const index = (notes: KnowledgeNote[]) => buildKnowledgeIndex(notes)

describe('resolution order', () => {
  it('prefers an exact vault path', () => {
    const target = note({ id: 'p', title: 'Something Else', vaultPath: 'notes/java.md' })
    const decoy = note({ id: 't', title: 'notes/java.md', vaultPath: 'notes/decoy.md' })
    const result = resolveTarget('notes/java.md', index([target, decoy]))
    expect(result).toEqual({ status: 'resolved', noteId: 'p' })
  })

  it('accepts a path written without the .md', () => {
    const target = note({ id: 'p', title: 'X', vaultPath: 'notes/dsa/java.md' })
    expect(resolveTarget('notes/dsa/java', index([target]))).toMatchObject({ noteId: 'p' })
  })

  it('resolves an exact title', () => {
    const target = note({ id: 'a', title: 'Java', vaultPath: 'notes/other.md' })
    expect(resolveTarget('Java', index([target]))).toEqual({ status: 'resolved', noteId: 'a' })
  })

  it('resolves a title regardless of case', () => {
    const target = note({ id: 'a', title: 'Java DSA', vaultPath: 'notes/x.md' })
    expect(resolveTarget('java dsa', index([target]))).toMatchObject({ noteId: 'a' })
    expect(resolveTarget('JAVA DSA', index([target]))).toMatchObject({ noteId: 'a' })
  })

  it('prefers the byte-identical title when several differ only in case', () => {
    const exact = note({ id: 'exact', title: 'Java', vaultPath: 'notes/a.md' })
    const other = note({ id: 'other', title: 'JAVA', vaultPath: 'notes/b.md' })
    expect(resolveTarget('Java', index([exact, other]))).toEqual({
      status: 'resolved',
      noteId: 'exact',
    })
  })

  it('falls back to a basename', () => {
    const target = note({ id: 'a', title: 'Totally Different', vaultPath: 'notes/dsa/java.md' })
    expect(resolveTarget('java', index([target]))).toMatchObject({ noteId: 'a' })
  })

  it('reports a target nothing matches as missing', () => {
    expect(resolveTarget('Nothing Here', index([note()]))).toEqual({ status: 'missing' })
  })

  it('reports an empty target as missing rather than matching everything', () => {
    expect(resolveTarget('   ', index([note()]))).toEqual({ status: 'missing' })
  })
})

describe('ambiguity', () => {
  const twins = () => [
    note({ id: 'prog', title: 'Java', vaultPath: 'Programming/Java.md' }),
    note({ id: 'college', title: 'Java', vaultPath: 'College/Java.md' }),
  ]

  it('never picks between two notes with the same title', () => {
    const result = resolveTarget('Java', index(twins()))
    expect(result.status).toBe('ambiguous')
    if (result.status === 'ambiguous') expect(result.noteIds.sort()).toEqual(['college', 'prog'])
  })

  it('never picks between two notes with the same basename', () => {
    const result = resolveTarget(
      'Java',
      index([
        note({ id: 'a', title: 'One', vaultPath: 'Programming/Java.md' }),
        note({ id: 'b', title: 'Two', vaultPath: 'College/Java.md' }),
      ]),
    )
    expect(result.status).toBe('ambiguous')
  })

  it('resolves cleanly when the full path disambiguates', () => {
    expect(resolveTarget('Programming/Java.md', index(twins()))).toEqual({
      status: 'resolved',
      noteId: 'prog',
    })
  })

  it('is no longer ambiguous once one candidate is deleted', () => {
    const [prog, college] = twins()
    const result = resolveTarget('Java', index([prog as KnowledgeNote, { ...(college as KnowledgeNote), deleted: true }]))
    expect(result).toEqual({ status: 'resolved', noteId: 'prog' })
  })
})

describe('deleted targets', () => {
  it('reports deleted rather than missing', () => {
    const gone = note({ id: 'gone', title: 'Gone', deleted: true })
    const result = resolveTarget('Gone', index([gone]))
    expect(result).toEqual({ status: 'deleted', noteId: 'gone' })
  })

  it('never becomes a graph edge', () => {
    const gone = note({ id: 'gone', title: 'Gone', deleted: true })
    const source = note({ id: 'src', title: 'Source', body: 'See [[Gone]].' })
    const built = index([gone, source])

    expect(built.outgoing.get('src')).toBeUndefined()
    expect(built.unresolved.get('src')?.[0]).toMatchObject({
      reason: 'deleted',
      deletedNoteId: 'gone',
    })
    expect(buildGraph(built).edges).toEqual([])
  })

  it('ignores links written inside a deleted note', () => {
    const target = note({ id: 'live', title: 'Live' })
    const gone = note({ id: 'gone', title: 'Gone', body: '[[Live]]', deleted: true })
    const built = index([target, gone])

    expect(built.incoming.get('live')).toBeUndefined()
    expect(buildGraph(built).nodes.map((n) => n.id)).toEqual(['live'])
  })
})

describe('outgoing links and backlinks', () => {
  it('A containing [[B]] gives B a backlink to A', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: 'See [[B]].' })
    const built = index([a, b])

    expect(built.outgoing.get('a')).toEqual(['b'])
    expect(built.incoming.get('b')).toEqual(['a'])
  })

  it('duplicate links do not duplicate the relationship', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: '[[B]] and again [[B]] and [[b]]' })
    const built = index([a, b])

    expect(built.outgoing.get('a')).toEqual(['b'])
    expect(built.incoming.get('b')).toEqual(['a'])
    // Every occurrence is still listed for the outgoing panel.
    expect(built.resolved.get('a')).toHaveLength(3)
  })

  it('keeps the alias for display', () => {
    const b = note({ id: 'b', title: 'Java DSA' })
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA|DSA]]' })
    const link = index([a, b]).resolved.get('a')?.[0]

    expect(link?.link.alias).toBe('DSA')
    expect(link?.link.raw).toBe('[[Java DSA|DSA]]')
  })

  it('ignores wikilinks inside code', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: 'Use `[[B]]` or\n```\n[[B]]\n```' })
    const built = index([a, b])

    expect(built.outgoing.get('a')).toBeUndefined()
    expect(built.incoming.get('b')).toBeUndefined()
  })

  it('collects unresolved and ambiguous links separately', () => {
    const built = index([
      note({ id: 'j1', title: 'Java', vaultPath: 'a/Java.md' }),
      note({ id: 'j2', title: 'Java', vaultPath: 'b/Java.md' }),
      note({ id: 'a', title: 'A', body: '[[Java]] and [[Spring Boot]]' }),
    ])

    expect(built.ambiguous.get('a')).toHaveLength(1)
    expect(built.unresolved.get('a')?.[0]?.reason).toBe('missing')
    expect(built.outgoing.get('a')).toBeUndefined()
  })
})

describe('heading links', () => {
  const target = () =>
    note({
      id: 'dsa',
      title: 'Java DSA',
      body: '# Java DSA\n\n## Recursion\n\ntext\n\n## Arrays\n',
    })

  it('resolves the note and the heading', () => {
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA#Recursion]]' })
    const link = index([a, target()]).resolved.get('a')?.[0]

    expect(link).toMatchObject({ targetNoteId: 'dsa', heading: 'Recursion', headingMissing: false })
  })

  it('resolves the note but flags a heading that does not exist', () => {
    // The note was found; saying otherwise would send the user looking for a
    // note that is right there.
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA#Nowhere]]' })
    const link = index([a, target()]).resolved.get('a')?.[0]

    expect(link).toMatchObject({ targetNoteId: 'dsa', headingMissing: true })
    expect(index([a, target()]).unresolved.get('a')).toBeUndefined()
  })

  it('matches a heading regardless of case and punctuation', () => {
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA#recursion]]' })
    expect(index([a, target()]).resolved.get('a')?.[0]?.headingMissing).toBe(false)
  })

  it('handles a heading with an alias', () => {
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA#Recursion|Recursion]]' })
    const link = index([a, target()]).resolved.get('a')?.[0]
    expect(link).toMatchObject({ heading: 'Recursion', headingMissing: false })
    expect(link?.link.alias).toBe('Recursion')
  })

  it('still counts as one edge', () => {
    const a = note({ id: 'a', title: 'A', body: '[[Java DSA#Recursion]] [[Java DSA#Arrays]]' })
    expect(index([a, target()]).outgoing.get('a')).toEqual(['dsa'])
  })
})

describe('the graph', () => {
  it('builds nodes with their degree', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: '[[B]]', tagIds: ['t1'] })
    const graph = buildGraph(index([a, b]))

    expect(graph.nodes).toEqual([
      { id: 'a', title: 'A', tags: ['t1'], incomingCount: 0, outgoingCount: 1 },
      { id: 'b', title: 'B', tags: [], incomingCount: 1, outgoingCount: 0 },
    ])
    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('collapses duplicate links into one edge', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: '[[B]] [[B]] [[B]]' })
    expect(buildGraph(index([a, b])).edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('keeps a cycle rather than breaking it', () => {
    const a = note({ id: 'a', title: 'A', body: '[[B]]' })
    const b = note({ id: 'b', title: 'B', body: '[[C]]' })
    const c = note({ id: 'c', title: 'C', body: '[[A]]' })
    const graph = buildGraph(index([a, b, c]))

    expect(graph.edges).toHaveLength(3)
    expect(graph.edges).toContainEqual({ source: 'c', target: 'a' })
  })

  it('keeps a self-link', () => {
    const a = note({ id: 'a', title: 'A', body: 'see [[A]]' })
    const graph = buildGraph(index([a]))
    expect(graph.edges).toEqual([{ source: 'a', target: 'a' }])
    expect(graph.nodes[0]).toMatchObject({ incomingCount: 1, outgoingCount: 1 })
  })

  it('excludes unresolved and ambiguous links', () => {
    const graph = buildGraph(
      index([
        note({ id: 'j1', title: 'Java', vaultPath: 'a/Java.md' }),
        note({ id: 'j2', title: 'Java', vaultPath: 'b/Java.md' }),
        note({ id: 'a', title: 'A', body: '[[Java]] [[Nowhere]]' }),
      ]),
    )
    expect(graph.edges).toEqual([])
  })

  it('is stably ordered', () => {
    const notes = [note({ id: 'z', title: 'Z' }), note({ id: 'a', title: 'A', body: '[[Z]]' })]
    expect(buildGraph(index(notes)).nodes.map((n) => n.title)).toEqual(['A', 'Z'])
  })

  it('is empty for an empty vault', () => {
    expect(buildGraph(index([]))).toEqual({ nodes: [], edges: [] })
  })
})

describe('local graph', () => {
  const web = () => [
    note({ id: 'a', title: 'A', body: '[[B]]' }),
    note({ id: 'b', title: 'B', body: '[[C]]' }),
    note({ id: 'c', title: 'C' }),
    note({ id: 'far', title: 'Far' }),
  ]

  it('takes one hop by default, in both directions', () => {
    const graph = localGraph(index(web()), 'b')
    // A links *to* B, and B links to C: both are neighbours.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('reaches further at a greater depth', () => {
    expect(localGraph(index(web()), 'a', 2).nodes.map((n) => n.id).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('excludes an unconnected note', () => {
    expect(localGraph(index(web()), 'a').nodes.map((n) => n.id)).not.toContain('far')
  })

  it('terminates on a cycle', () => {
    const cycle = [
      note({ id: 'a', title: 'A', body: '[[B]]' }),
      note({ id: 'b', title: 'B', body: '[[A]]' }),
    ]
    expect(localGraph(index(cycle), 'a', 10).nodes).toHaveLength(2)
  })

  it('is empty for a note that does not exist or is deleted', () => {
    expect(localGraph(index(web()), 'nope')).toEqual({ nodes: [], edges: [] })
    const gone = note({ id: 'gone', deleted: true })
    expect(localGraph(index([gone]), 'gone')).toEqual({ nodes: [], edges: [] })
  })

  it('includes an isolated note as a single node', () => {
    const lonely = note({ id: 'lonely', title: 'Lonely' })
    expect(localGraph(index([lonely]), 'lonely').nodes).toHaveLength(1)
  })
})

describe('orphans', () => {
  it('finds a note with no links either way', () => {
    const lonely = note({ id: 'lonely', title: 'Lonely' })
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: '[[B]]' })

    expect(orphanIds(index([lonely, a, b]))).toEqual(['lonely'])
  })

  it('still counts a tagged note as an orphan', () => {
    // A tag is a label; a link is a relationship. A tagged note nobody
    // mentions is exactly the note the user has lost track of.
    const tagged = note({ id: 'tagged', title: 'Tagged', tagIds: ['java', 'dsa'] })
    expect(orphanIds(index([tagged]))).toEqual(['tagged'])
  })

  it('does not count a note that only has a backlink', () => {
    const b = note({ id: 'b', title: 'B' })
    const a = note({ id: 'a', title: 'A', body: '[[B]]' })
    expect(orphanIds(index([a, b]))).toEqual([])
  })

  it('excludes deleted notes', () => {
    const gone = note({ id: 'gone', deleted: true })
    expect(orphanIds(index([gone]))).toEqual([])
  })

  it('does not rescue a note whose only link is unresolved', () => {
    const a = note({ id: 'a', title: 'A', body: '[[Nowhere]]' })
    expect(orphanIds(index([a]))).toEqual(['a'])
  })
})

describe('related notes', () => {
  it('scores a direct link and a backlink equally', () => {
    const out = note({ id: 'out', title: 'Outgoing' })
    const back = note({ id: 'back', title: 'Backlink', body: '[[Subject]]' })
    const subject = note({ id: 'subject', title: 'Subject', body: '[[Outgoing]]' })

    const related = relatedNotes(index([subject, out, back]), 'subject')
    expect(related.map((row) => [row.noteId, row.score])).toEqual([
      ['back', 5],
      ['out', 5],
    ])
  })

  it('adds two points per shared tag', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a', 'b'] })
    const both = note({ id: 'both', title: 'Both', tagIds: ['a', 'b'] })
    const one = note({ id: 'one', title: 'One', tagIds: ['a'] })

    const related = relatedNotes(index([subject, both, one]), 's')
    expect(related.map((row) => [row.noteId, row.score])).toEqual([
      ['both', 4],
      ['one', 2],
    ])
  })

  it('combines links and tags', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a'], body: '[[Linked]]' })
    const linked = note({ id: 'l', title: 'Linked', tagIds: ['a'] })
    const related = relatedNotes(index([subject, linked]), 's')

    expect(related[0]).toMatchObject({ noteId: 'l', score: 7 })
    expect(related[0]?.reasons.sort()).toEqual(['Linked from this note', 'Shares a tag'])
  })

  it('breaks ties on title then id, deterministically', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a'] })
    const beta = note({ id: 'z', title: 'Beta', tagIds: ['a'] })
    const alpha = note({ id: 'y', title: 'Alpha', tagIds: ['a'] })

    const first = relatedNotes(index([subject, beta, alpha]), 's')
    const second = relatedNotes(index([subject, alpha, beta]), 's')
    expect(first.map((row) => row.title)).toEqual(['Alpha', 'Beta'])
    expect(second.map((row) => row.title)).toEqual(first.map((row) => row.title))
  })

  it('never includes the note itself', () => {
    const self = note({ id: 's', title: 'S', tagIds: ['a'], body: '[[S]]' })
    expect(relatedNotes(index([self]), 's')).toEqual([])
  })

  it('excludes deleted notes', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a'] })
    const gone = note({ id: 'gone', title: 'Gone', tagIds: ['a'], deleted: true })
    expect(relatedNotes(index([subject, gone]), 's')).toEqual([])
  })

  it('reports each reason once however many tags are shared', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a', 'b', 'c'] })
    const other = note({ id: 'o', title: 'O', tagIds: ['a', 'b', 'c'] })
    const [related] = relatedNotes(index([subject, other]), 's')

    expect(related?.score).toBe(6)
    expect(related?.reasons).toEqual(['Shares a tag'])
  })

  it('honours the limit', () => {
    const subject = note({ id: 's', title: 'S', tagIds: ['a'] })
    const others = Array.from({ length: 20 }, (_, i) =>
      note({ id: `o${i}`, title: `O${i}`, tagIds: ['a'] }),
    )
    expect(relatedNotes(index([subject, ...others]), 's', 5)).toHaveLength(5)
  })

  it('is empty for an unknown note', () => {
    expect(relatedNotes(index([note()]), 'nope')).toEqual([])
  })
})

describe('basenameOf', () => {
  it('strips the folder and the extension', () => {
    expect(basenameOf('notes/dsa/binary-search.md')).toBe('binary-search')
    expect(basenameOf('plain.md')).toBe('plain')
    expect(basenameOf('no-extension')).toBe('no-extension')
  })
})

describe('scale', () => {
  it('stays linear rather than comparing every note with every other', () => {
    // 2,000 notes in a chain. A quadratic build would be 4,000,000 steps and
    // would show up here as a timeout rather than a wrong answer.
    const many: KnowledgeNote[] = []
    for (let i = 0; i < 2000; i += 1) {
      many.push({
        id: `n${i}`,
        title: `Note ${i}`,
        body: i < 1999 ? `links to [[Note ${i + 1}]]` : '',
        tagIds: [],
        vaultPath: `notes/note-${i}.md`,
        updatedAt: i,
        deleted: false,
      })
    }

    const started = Date.now()
    const built = buildKnowledgeIndex(many)
    const graph = buildGraph(built)

    expect(graph.nodes).toHaveLength(2000)
    expect(graph.edges).toHaveLength(1999)
    expect(Date.now() - started).toBeLessThan(4000)
  })
})
