import { useCallback } from 'react'
import { createTag } from '@/services'
import type { Tag } from '@/types/entities'

/**
 * Tag creation for the picker.
 *
 * Creating goes straight to the tag service rather than through the command
 * layer: a tag is not a command, it is a lookup value a form needs before it
 * can dispatch anything. Returns `null` on failure so the picker can carry on
 * rather than throwing inside an input's keydown handler.
 */
export function useTagActions(): { create: (name: string) => Promise<Tag | null> } {
  const create = useCallback(async (name: string) => {
    try {
      return await createTag(name, null, 'ui')
    } catch {
      return null
    }
  }, [])

  return { create }
}
