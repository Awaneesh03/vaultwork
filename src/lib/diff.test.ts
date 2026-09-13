import { describe, expect, it } from 'vitest'
import { diffLines, summarizeDiff, DIFF_LINE_LIMIT } from './diff'

/** The line diff behind the conflict view. Readable, not surgical. */

const kinds = (a: string, b: string) => diffLines(a, b).map((line) => line.kind)
const texts = (a: string, b: string) => diffLines(a, b).map((line) => `${line.kind}:${line.text}`)

describe('diffLines', () => {
  it('reports identical text as unchanged', () => {
    expect(kinds('a\nb\nc', 'a\nb\nc')).toEqual(['same', 'same', 'same'])
  })

  it('finds an inserted line', () => {
    expect(texts('a\nc', 'a\nb\nc')).toEqual(['same:a', 'added:b', 'same:c'])
  })

  it('finds a removed line', () => {
    expect(texts('a\nb\nc', 'a\nc')).toEqual(['same:a', 'removed:b', 'same:c'])
  })

  it('shows a changed line as a removal and an addition', () => {
    // No character-level diff: the milestone asks for readable, not surgical.
    expect(texts('a\nb\nc', 'a\nB\nc')).toEqual(['same:a', 'removed:b', 'added:B', 'same:c'])
  })

  it('keeps the surrounding context aligned', () => {
    const lines = diffLines('one\ntwo\nthree\nfour', 'one\ntwo\nCHANGED\nfour')
    expect(lines.filter((line) => line.kind === 'same').map((line) => line.text)).toEqual([
      'one',
      'two',
      'four',
    ])
  })

  it('numbers the lines on the side they belong to', () => {
    const lines = diffLines('a\nc', 'a\nb\nc')
    expect(lines.map((line) => [line.leftNumber, line.rightNumber])).toEqual([
      [1, 1],
      [null, 2],
      [2, 3],
    ])
  })

  it('handles an empty side', () => {
    expect(kinds('', 'a')).toEqual(['removed', 'added'])
    expect(diffLines('a\nb', '').filter((line) => line.kind === 'removed')).toHaveLength(2)
  })

  it('ignores line-ending differences', () => {
    expect(kinds('a\r\nb', 'a\nb')).toEqual(['same', 'same'])
  })

  it('degrades rather than locking up on an enormous document', () => {
    const huge = Array.from({ length: DIFF_LINE_LIMIT + 10 }, (_, i) => `line ${i}`).join('\n')
    const lines = diffLines(huge, `${huge}\nextra`)
    // Everything replaced, computed in linear time.
    expect(lines.some((line) => line.kind === 'same')).toBe(false)
    expect(lines.length).toBeGreaterThan(DIFF_LINE_LIMIT)
  })
})

describe('summarizeDiff', () => {
  it('counts each kind', () => {
    expect(summarizeDiff(diffLines('a\nb', 'a\nc'))).toEqual({
      added: 1,
      removed: 1,
      unchanged: 1,
    })
  })
})
