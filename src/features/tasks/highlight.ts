import type { QuickAddToken, QuickAddTokenKind } from '@/services'

export interface HighlightSegment {
  text: string
  /** `null` for text the parser did not consume — i.e. the title. */
  kind: QuickAddTokenKind | null
}

/**
 * Splits raw input into plain and recognised runs, in order.
 *
 * Overlapping tokens cannot both win: the earlier one keeps the span. The
 * parser does not emit overlaps, but a renderer that silently produced garbage
 * if it ever did would be a bad place to find out.
 */
export function toSegments(value: string, tokens: QuickAddToken[]): HighlightSegment[] {
  const marks = tokens
    .filter((token) => token.start >= 0 && token.end > token.start)
    .sort((a, b) => a.start - b.start)

  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const token of marks) {
    if (token.start < cursor) continue
    if (token.start > cursor) segments.push({ text: value.slice(cursor, token.start), kind: null })
    segments.push({ text: value.slice(token.start, token.end), kind: token.kind })
    cursor = token.end
  }

  if (cursor < value.length) segments.push({ text: value.slice(cursor), kind: null })
  return segments
}
