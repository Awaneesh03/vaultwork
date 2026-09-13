import type { Table } from 'dexie'
import { db } from '@/db'
import { NotFoundError, toRepositoryError } from '@/lib/errors'
import { newId } from '@/lib/id'
import { platform } from '@/platform'
import type { BaseRecord, EntityMap, Id, StoreName, Timestamp } from '@/types/entities'
import type { EventSource } from '@/types/enums'

/**
 * The shared behaviour of every store: UUIDs, timestamps, soft deletes and
 * event emission. Writing it once is what keeps `deletedAt` from being
 * forgotten in the fourteenth repository.
 *
 * Every timestamp comes from `platform.clock`, never from `Date.now()`. That is
 * the whole reason the clock is a port: a test can pin "now" and get a
 * deterministic event log, and one layer reading the wall clock while another
 * reads the port would silently interleave two different timelines.
 *
 * `events` and `settings` are excluded: the event log is append-only and
 * settings is a singleton, so neither wants generic CRUD.
 */
export type ManagedStore = Exclude<StoreName, 'events' | 'settings'>

export type Entity<K extends ManagedStore> = EntityMap[K] & BaseRecord
export type CreateInput<K extends ManagedStore> = Omit<Entity<K>, keyof BaseRecord> & { id?: Id }
export type UpdatePatch<K extends ManagedStore> = Partial<Omit<Entity<K>, keyof BaseRecord>>

export interface WriteOptions {
  /**
   * Where this write came from. Recorded on the event, never on the entity —
   * a task is a task regardless of how it was captured.
   */
  source?: EventSource
  /** Set false for bulk restores, where per-row events would be noise. */
  emit?: boolean
}

export interface ListOptions {
  includeDeleted?: boolean
  limit?: number
}

/** Singular entity name used in event types: `task.created`, `habit.updated`. */
const ENTITY_TYPE: Record<ManagedStore, string> = {
  tasks: 'task',
  subtasks: 'subtask',
  projects: 'project',
  goals: 'goal',
  milestones: 'milestone',
  habits: 'habit',
  habitEntries: 'habitEntry',
  focusSessions: 'focusSession',
  notes: 'note',
  noteLinks: 'noteLink',
  tags: 'tag',
  vaultLinks: 'vaultLink',
  vaultDocuments: 'document',
  messageLog: 'message',
}

/**
 * Appends to the event log. Must be called inside an `rw` transaction that
 * includes `db.events`, so a failed write can never leave an orphan event
 * behind — and a failed event can never leave an unrecorded write.
 */
export async function appendEvent(input: {
  type: string
  entityType: string
  entityId: Id | null
  source: EventSource
  payload?: Record<string, unknown> | null
  at?: Timestamp
}): Promise<void> {
  await db.events.add({
    id: newId(),
    type: input.type,
    at: input.at ?? platform.clock.now(),
    entityType: input.entityType,
    entityId: input.entityId,
    source: input.source,
    payload: input.payload ?? null,
  })
}

function sortKey(record: BaseRecord): number {
  const order = (record as BaseRecord & { sortOrder?: number }).sortOrder
  return typeof order === 'number' ? order : record.createdAt
}

export interface BaseRepository<K extends ManagedStore> {
  readonly store: K
  get(id: Id, options?: { includeDeleted?: boolean }): Promise<Entity<K> | undefined>
  getOrThrow(id: Id): Promise<Entity<K>>
  list(options?: ListOptions): Promise<Entity<K>[]>
  listDeleted(): Promise<Entity<K>[]>
  count(): Promise<number>
  create(input: CreateInput<K>, options?: WriteOptions): Promise<Entity<K>>
  update(id: Id, patch: UpdatePatch<K>, options?: WriteOptions): Promise<Entity<K>>
  softDelete(id: Id, options?: WriteOptions): Promise<void>
  restore(id: Id, options?: WriteOptions): Promise<Entity<K>>
  hardDelete(id: Id, options?: WriteOptions): Promise<void>
  table(): Table<Entity<K>, Id>
}

export function createRepository<K extends ManagedStore>(store: K): BaseRepository<K> {
  const entityType = ENTITY_TYPE[store]
  const table = () => db[store] as unknown as Table<Entity<K>, Id>

  const emit = async (
    action: string,
    id: Id | null,
    options: WriteOptions,
    payload?: Record<string, unknown>,
  ) => {
    if (options.emit === false) return
    await appendEvent({
      type: `${entityType}.${action}`,
      entityType,
      entityId: id,
      source: options.source ?? 'ui',
      payload: payload ?? null,
    })
  }

  return {
    store,
    table,

    async get(id, options = {}) {
      try {
        const record = await table().get(id)
        if (!record) return undefined
        if (record.deletedAt !== null && !options.includeDeleted) return undefined
        return record
      } catch (error) {
        throw toRepositoryError(store, error, 'get')
      }
    },

    async getOrThrow(id) {
      const record = await this.get(id)
      if (!record) throw new NotFoundError(store, id)
      return record
    },

    async list(options = {}) {
      try {
        const all = await table().toArray()
        const live = options.includeDeleted ? all : all.filter((r) => r.deletedAt === null)
        live.sort((a, b) => sortKey(a) - sortKey(b))
        return typeof options.limit === 'number' ? live.slice(0, options.limit) : live
      } catch (error) {
        throw toRepositoryError(store, error, 'list')
      }
    },

    async listDeleted() {
      try {
        // `deletedAt` is nullable, so live rows are simply absent from this
        // index. That is the whole reason the index exists.
        return await table().where('deletedAt').above(0).toArray()
      } catch (error) {
        throw toRepositoryError(store, error, 'listDeleted')
      }
    },

    async count() {
      const all = await table().toArray()
      return all.filter((r) => r.deletedAt === null).length
    },

    async create(input, options = {}) {
      const at = platform.clock.now()
      const { id, ...rest } = input as CreateInput<K> & { id?: Id }
      const record = {
        ...rest,
        id: id ?? newId(),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      } as Entity<K>

      try {
        await db.transaction('rw', [table(), db.events], async () => {
          await table().add(record)
          await emit('created', record.id, options)
        })
        return record
      } catch (error) {
        throw toRepositoryError(store, error, 'create')
      }
    },

    async update(id, patch, options = {}) {
      try {
        let next!: Entity<K>
        await db.transaction('rw', [table(), db.events], async () => {
          const current = await table().get(id)
          if (!current || current.deletedAt !== null) throw new NotFoundError(store, id)
          next = { ...current, ...patch, id, updatedAt: platform.clock.now() } as Entity<K>
          await table().put(next)
          await emit('updated', id, options, { fields: Object.keys(patch) })
        })
        return next
      } catch (error) {
        throw toRepositoryError(store, error, 'update')
      }
    },

    async softDelete(id, options = {}) {
      try {
        await db.transaction('rw', [table(), db.events], async () => {
          const current = await table().get(id)
          if (!current || current.deletedAt !== null) throw new NotFoundError(store, id)
          const at = platform.clock.now()
          await table().put({ ...current, deletedAt: at, updatedAt: at })
          await emit('deleted', id, options)
        })
      } catch (error) {
        throw toRepositoryError(store, error, 'softDelete')
      }
    },

    async restore(id, options = {}) {
      try {
        let next!: Entity<K>
        await db.transaction('rw', [table(), db.events], async () => {
          const current = await table().get(id)
          if (!current) throw new NotFoundError(store, id)
          next = { ...current, deletedAt: null, updatedAt: platform.clock.now() }
          await table().put(next)
          await emit('restored', id, options)
        })
        return next
      } catch (error) {
        throw toRepositoryError(store, error, 'restore')
      }
    },

    async hardDelete(id, options = {}) {
      try {
        await db.transaction('rw', [table(), db.events], async () => {
          await table().delete(id)
          await emit('purged', id, options)
        })
      } catch (error) {
        throw toRepositoryError(store, error, 'hardDelete')
      }
    },
  }
}
