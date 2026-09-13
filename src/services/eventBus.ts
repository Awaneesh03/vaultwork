import { eventRepo, type AppendEventInput } from '@/repositories'
import type { AppEvent } from '@/types/entities'

type Listener = (event: AppEvent) => void

const listeners = new Set<Listener>()

/**
 * One place to record that something happened.
 *
 * Every event is persisted first — the log is the substrate all analytics is
 * computed from, and history that was not recorded cannot be recovered later —
 * and then handed to in-memory subscribers for anything that wants to react
 * right now (a toast, a running timer).
 *
 * Most events are emitted by the base repository as part of the write that
 * caused them. This is for the domain events a repository cannot know about:
 * `task.completed`, `focus.completed`, `habit.checked`.
 */
export const eventBus = {
  async emit(input: AppendEventInput): Promise<AppEvent> {
    const event = await eventRepo.append(input)
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        // A broken subscriber must never fail the write that already happened.
        console.error('Event listener threw', error)
      }
    }
    return event
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Test seam; never called by application code. */
  clearListeners(): void {
    listeners.clear()
  },
}
