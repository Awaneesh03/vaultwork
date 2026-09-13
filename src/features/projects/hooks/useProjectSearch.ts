import { useLiveQuery } from 'dexie-react-hooks'
import { searchProjects, type ProjectSummary } from '@/services'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

/**
 * Project search for the command palette.
 *
 * Debounced, because this runs on every keystroke against a table read. Returns
 * an empty array rather than `undefined` while loading: the palette shows a
 * combined list, and a loading state for one of its five sections would flicker
 * more than it informs.
 */
export function useProjectSearch(query: string, limit = 5): ProjectSummary[] {
  const debounced = useDebouncedValue(query, 120)
  return (
    useLiveQuery(() => searchProjects(debounced, limit), [debounced, limit]) ?? []
  )
}
