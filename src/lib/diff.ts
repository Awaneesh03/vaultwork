/**
 * A line diff, for showing two versions of a note side by side.
 *
 * Deliberately small: a longest-common-subsequence over *lines*, which is
 * enough to see what changed and nowhere near an IDE's diff engine. The
 * milestone asks for a readable comparison, not a merge tool — and since
 * nothing here ever merges, the diff only has to be legible, not surgical.
 *
 * Pure and synchronous, so it can be asserted directly.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  /** Line number on the left, when it exists there. */
  leftNumber: number | null
  rightNumber: number | null
  text: string
}

/** Above this, the quadratic table is skipped — see `diffLines`. */
export const DIFF_LINE_LIMIT = 800

/**
 * Lines of `left` and `right`, aligned.
 *
 * The LCS table is O(n·m), which is fine for a note and hopeless for a
 * generated file that happens to be enormous. Past `DIFF_LINE_LIMIT` the
 * comparison degrades to "everything was replaced" rather than locking the tab
 * — a slow honest answer is worse than a fast blunt one here.
 */
export function diffLines(left: string, right: string): DiffLine[] {
  const a = left.replace(/\r\n?/g, '\n').split('\n')
  const b = right.replace(/\r\n?/g, '\n').split('\n')

  if (a.length > DIFF_LINE_LIMIT || b.length > DIFF_LINE_LIMIT) {
    return [
      ...a.map((text, i) => ({
        kind: 'removed' as const,
        leftNumber: i + 1,
        rightNumber: null,
        text,
      })),
      ...b.map((text, i) => ({
        kind: 'added' as const,
        leftNumber: null,
        rightNumber: i + 1,
        text,
      })),
    ]
  }

  // lengths[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lengths[i] as number[]
      const next = lengths[i + 1] as number[]
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', leftNumber: i + 1, rightNumber: j + 1, text: a[i] as string })
      i += 1
      j += 1
      continue
    }

    const down = (lengths[i + 1] as number[])[j] as number
    const right = (lengths[i] as number[])[j + 1] as number

    if (down >= right) {
      out.push({ kind: 'removed', leftNumber: i + 1, rightNumber: null, text: a[i] as string })
      i += 1
    } else {
      out.push({ kind: 'added', leftNumber: null, rightNumber: j + 1, text: b[j] as string })
      j += 1
    }
  }

  while (i < a.length) {
    out.push({ kind: 'removed', leftNumber: i + 1, rightNumber: null, text: a[i] as string })
    i += 1
  }
  while (j < b.length) {
    out.push({ kind: 'added', leftNumber: null, rightNumber: j + 1, text: b[j] as string })
    j += 1
  }

  return out
}

export interface DiffSummary {
  added: number
  removed: number
  unchanged: number
}

export function summarizeDiff(lines: DiffLine[]): DiffSummary {
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
    unchanged: lines.filter((line) => line.kind === 'same').length,
  }
}
