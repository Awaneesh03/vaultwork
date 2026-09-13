import { useMemo } from 'react'
import { parseQuickAdd, type QuickAddParse } from '@/services'

/**
 * Live parse of the Quick Add input.
 *
 * The parser is pure and synchronous, so this is a `useMemo` rather than a
 * query — there is nothing to await and nothing to debounce. The component gets
 * the draft *and* the consumed character ranges, which is what lets the input
 * highlight what it understood as you type.
 */
export function useQuickAddPreview(text: string): QuickAddParse {
  return useMemo(() => parseQuickAdd(text), [text])
}
