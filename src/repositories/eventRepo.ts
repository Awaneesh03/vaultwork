import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import { newId } from '@/lib/id'
import { platform } from '@/platform'
import type { AppEvent, Id, Timestamp } from '@/types/entities'
import type { EventSource } from '@/types/enums'

export interface AppendEventInput {
  type: string
  entityType: string
  entityId?: Id | null
  source: EventSource
  payload?: Record<string, unknown> | null
  at?: Timestamp
}

export interface EventQuery {
  since?: Timestamp
  until?: Timestamp
  type?: string
  limit?: number
}

/**
 * The event log's entire API surface. There is deliberately no `update` and no
 * `delete`: history is not editable, and the absence of the method is the first
 * line of that defence. The second is a Dexie hook in db/schema.ts that throws
 * if anything tries anyway.
 */
export const eventRepo = {
  async append(input: AppendEventInput): Promise<AppEvent> {
    const event: AppEvent = {
      id: newId(),
      type: input.type,
      at: input.at ?? platform.clock.now(),
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      source: input.source,
      payload: input.payload ?? null,
    }
    try {
      await db.events.add(event)
      return event
    } catch (error) {
      throw toRepositoryError('events', error, 'append')
    }
  },

  async list(query: EventQuery = {}): Promise<AppEvent[]> {
    try {
      const since = query.since ?? 0
      const until = query.until ?? Number.MAX_SAFE_INTEGER
      let rows = await db.events.where('at').between(since, until, true, true).toArray()
      if (query.type) rows = rows.filter((e) => e.type === query.type)
      rows.sort((a, b) => b.at - a.at)
      return typeof query.limit === 'number' ? rows.slice(0, query.limit) : rows
    } catch (error) {
      throw toRepositoryError('events', error, 'list')
    }
  },

  async count(): Promise<number> {
    return db.events.count()
  },

  async latest(limit = 20): Promise<AppEvent[]> {
    return this.list({ limit })
  },
}
