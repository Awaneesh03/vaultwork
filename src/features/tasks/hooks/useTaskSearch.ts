import { useLiveQuery } from 'dexie-react-hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { searchTasks } from '@/services'
import type { Task } from '@/types/entities'

/**
 * Debounced task search.
 *
 * The caller keeps the raw input in its own state so typing never stutters;
 * only the Dexie read waits for a pause.
 */
export function useTaskSearch(query: string, limit = 8): Task[] {
  const debounced = useDebouncedValue(query, 160)
  return useLiveQuery(() => searchTasks(debounced, limit), [debounced, limit]) ?? []
}
