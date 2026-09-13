import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  VaultworkDatabase,
  type MigrationDefinition,
} from '@/db'
import { resetDatabase } from './helpers'

interface Thing {
  id: string
  name: string
  slug?: string
}

const V1: MigrationDefinition[] = [{ version: 1, stores: { things: 'id, name' } }]

const V2: MigrationDefinition[] = [
  ...V1,
  {
    version: 2,
    stores: { things: 'id, name, slug' },
    upgrade: async (tx) => {
      await tx
        .table<Thing>('things')
        .toCollection()
        .modify((row) => {
          row.slug = row.name.toLowerCase().replace(/\s+/g, '-')
        })
    },
  },
]

const NAME = 'vaultwork-migration-test'

async function open(migrations: MigrationDefinition[]): Promise<Dexie> {
  const db = new Dexie(NAME)
  applyMigrations(db, migrations)
  await db.open()
  return db
}

beforeEach(async () => {
  await Dexie.delete(NAME)
})

afterEach(async () => {
  await Dexie.delete(NAME)
})

/**
 * Migrations are the one part of the data layer that cannot be tested by using
 * the app: by the time a version bump is wrong, the data it damaged is already
 * gone. So the mechanism is exercised directly, on a fixture schema.
 */
describe('applyMigrations', () => {
  it('opens a fresh database at the highest declared version', async () => {
    const db = await open(V2)
    expect(db.verno).toBe(2)
    db.close()
  })

  it('upgrades an existing database and preserves its rows', async () => {
    const v1 = await open(V1)
    await v1.table<Thing>('things').bulkAdd([
      { id: 'a', name: 'Binary Trees' },
      { id: 'b', name: 'Dynamic Programming' },
    ])
    v1.close()

    const v2 = await open(V2)
    const rows = await v2.table<Thing>('things').orderBy('id').toArray()

    expect(v2.verno).toBe(2)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'a', name: 'Binary Trees', slug: 'binary-trees' })
    expect(rows[1]?.slug).toBe('dynamic-programming')

    // The index added by v2 is usable, which is the point of the upgrade.
    expect(await v2.table<Thing>('things').where('slug').equals('binary-trees').count()).toBe(1)
    v2.close()
  })

  it('does not re-run an upgrade that has already been applied', async () => {
    const first = await open(V2)
    await first.table<Thing>('things').add({ id: 'a', name: 'Arrays' })
    first.close()

    const second = await open(V2)
    const row = await second.table<Thing>('things').get('a')

    // The upgrade only touches rows written before it ran; a re-run would
    // rewrite this one, which is how a non-idempotent migration corrupts data.
    expect(row).toMatchObject({ id: 'a', name: 'Arrays' })
    expect(second.verno).toBe(2)
    second.close()
  })
})

/**
 * The v1 -> v2 upgrade, run against the real migration list.
 *
 * This is the project's first schema change on data that may already exist, and
 * it both moves a relationship into a new table and deletes the fields it came
 * from. If it is wrong, a user's note silently loses what it was about — and by
 * the time anyone notices, the old fields are gone.
 */
describe('the notes upgrade (v1 -> v2)', () => {
  const V1_ONLY = MIGRATIONS.filter((m) => m.version === 1)

  interface LegacyNote {
    id: string
    title: string
    body: string
    refType?: string
    refId?: string | null
    tagIds: string[]
    vaultPath: string | null
    createdAt: number
    updatedAt: number
    deletedAt: number | null
  }

  const legacyNote = (over: Partial<LegacyNote>): LegacyNote => ({
    id: 'n1',
    title: 'Traversals',
    body: 'text',
    refType: 'none',
    refId: null,
    tagIds: [],
    vaultPath: null,
    createdAt: 10,
    updatedAt: 20,
    deletedAt: null,
    ...over,
  })

  it('converts a note reference into a link row and keeps the note', async () => {
    const v1 = await open(V1_ONLY)
    await v1.table('notes').bulkAdd([
      legacyNote({ id: 'n1', refType: 'task', refId: 't1' }),
      legacyNote({ id: 'n2', title: 'Loose', refType: 'none', refId: null }),
    ])
    v1.close()

    // Opened with every migration, so this is the *current* schema replaying a
    // version-1 database forward — which is what an installed copy actually does.
    const v2 = await open(MIGRATIONS)
    expect(v2.verno).toBe(CURRENT_SCHEMA_VERSION)

    const notes = await v2.table<LegacyNote>('notes').orderBy('id').toArray()
    expect(notes).toHaveLength(2)
    // Content survives untouched.
    expect(notes[0]).toMatchObject({ title: 'Traversals', body: 'text', createdAt: 10 })

    const links = await v2.table('noteLinks').toArray()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ noteId: 'n1', refType: 'task', refId: 't1' })

    v2.close()
  })

  it('removes the fields it replaced, so nothing can diverge from the table', async () => {
    const v1 = await open(V1_ONLY)
    await v1.table('notes').add(legacyNote({ refType: 'project', refId: 'p1' }))
    v1.close()

    const v2 = await open(MIGRATIONS)
    const note = (await v2.table('notes').get('n1')) as Record<string, unknown>

    expect('refType' in note).toBe(false)
    expect('refId' in note).toBe(false)
    v2.close()
  })

  it('creates no link for a note that referenced nothing', async () => {
    const v1 = await open(V1_ONLY)
    await v1.table('notes').add(legacyNote({ refType: 'none', refId: null }))
    // A dangling refType with no id is not a link either.
    await v1.table('notes').add(legacyNote({ id: 'n2', refType: 'task', refId: null }))
    v1.close()

    const v2 = await open(MIGRATIONS)
    expect(await v2.table('noteLinks').count()).toBe(0)
    v2.close()
  })

  it('is safe to open twice — the upgrade does not run again', async () => {
    const v1 = await open(V1_ONLY)
    await v1.table('notes').add(legacyNote({ refType: 'task', refId: 't1' }))
    v1.close()

    const first = await open(MIGRATIONS)
    first.close()
    const second = await open(MIGRATIONS)

    // A second link row here would mean the migration double-counted.
    expect(await second.table('noteLinks').count()).toBe(1)
    second.close()
  })

  it('leaves the backlink index usable straight after the upgrade', async () => {
    const v1 = await open(V1_ONLY)
    await v1.table('notes').add(legacyNote({ refType: 'task', refId: 't1' }))
    v1.close()

    const v2 = await open(MIGRATIONS)
    const found = await v2.table('noteLinks').where('[refType+refId]').equals(['task', 't1']).toArray()
    expect(found).toHaveLength(1)
    v2.close()
  })
})

describe('the documents upgrade (v2 -> v3)', () => {
  /*
   * Version 3 adds `vaultDocuments` and touches nothing else. That is the point
   * of the design — a PDF is not a Note, so supporting PDFs costs an empty new
   * table rather than a rewrite of rows the user has been editing for months.
   * These tests assert exactly that, because "additive" is a claim about data
   * that can only be checked against a real upgrade.
   */
  const UP_TO_V2 = MIGRATIONS.filter((m) => m.version <= 2)

  it('adds the store and leaves every existing row untouched', async () => {
    const before = await open(UP_TO_V2)
    expect(before.verno).toBe(2)
    await before.table('notes').add({
      id: 'n1',
      title: 'Recursion',
      body: 'the body a user wrote',
      tagIds: ['t1'],
      vaultPath: 'notes/recursion.md',
      createdAt: 10,
      updatedAt: 20,
      deletedAt: null,
    })
    await before.table('tasks').add({
      id: 'k1',
      title: 'Ship it',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      dueTime: null,
      estimateMin: null,
      projectId: null,
      milestoneId: null,
      seriesId: null,
      sortOrder: 1,
      tagIds: [],
      completedAt: null,
      createdAt: 10,
      updatedAt: 20,
      deletedAt: null,
    })
    before.close()

    const after = await open(MIGRATIONS)
    expect(after.verno).toBe(3)

    // The new table exists and is empty. Nothing is invented on upgrade.
    expect(after.tables.map((table) => table.name)).toContain('vaultDocuments')
    expect(await after.table('vaultDocuments').count()).toBe(0)

    // And the data that was already there is exactly as it was.
    expect(await after.table('notes').get('n1')).toMatchObject({
      title: 'Recursion',
      body: 'the body a user wrote',
      vaultPath: 'notes/recursion.md',
      createdAt: 10,
    })
    expect(await after.table('tasks').get('k1')).toMatchObject({ title: 'Ship it' })
    after.close()
  })

  it('refuses two documents for the same file', async () => {
    const db = await open(MIGRATIONS)
    const row = (id: string, vaultPath: string) => ({
      id,
      title: 'Paper',
      vaultPath,
      kind: 'pdf' as const,
      text: 'x',
      extraction: 'ok' as const,
      chars: 1,
      bytes: 10,
      hash: 'h',
      importedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    })

    await db.table('vaultDocuments').add(row('d1', 'papers/a.pdf'))
    // One file is one document, enforced by `&vaultPath` rather than by the
    // import path remembering to check — which is what makes a repeated scan
    // structurally unable to duplicate a row.
    await expect(db.table('vaultDocuments').add(row('d2', 'papers/a.pdf'))).rejects.toThrow()

    expect(await db.table('vaultDocuments').count()).toBe(1)
    db.close()
  })
})

describe('the real schema', () => {
  beforeEach(resetDatabase)

  it('declares every store the application expects', async () => {
    const db = new VaultworkDatabase('vaultwork-schema-probe')
    await db.open()

    const names = db.tables.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'events',
        'focusSessions',
        'goals',
        'habitEntries',
        'habits',
        'messageLog',
        'milestones',
        'noteLinks',
        'notes',
        'projects',
        'settings',
        'subtasks',
        'tags',
        'tasks',
        'vaultDocuments',
        'vaultLinks',
      ].sort(),
    )
    expect(db.verno).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version)

    db.close()
    await Dexie.delete('vaultwork-schema-probe')
  })

  it('creates the indexes the queries depend on', async () => {
    const db = new VaultworkDatabase('vaultwork-index-probe')
    await db.open()

    const index = (table: string, name: string) =>
      db.table(table).schema.indexes.find((i) => i.name === name)

    expect(index('tasks', '[status+dueDate]')?.compound).toBe(true)
    expect(index('tasks', 'tagIds')?.multi).toBe(true)
    expect(index('tasks', 'deletedAt')).toBeDefined()

    // The two constraints correctness actually rests on.
    expect(index('habitEntries', '[habitId+date]')?.unique).toBe(true)
    expect(index('messageLog', '[source+externalId]')?.unique).toBe(true)

    expect(index('tags', 'name')?.unique).toBe(true)
    expect(index('vaultLinks', 'path')?.unique).toBe(true)
    expect(index('events', '[type+at]')?.compound).toBe(true)

    // M9: a note's links are read from both directions — by note, and by the
    // entity being linked to, which is what makes backlinks an index hit.
    expect(index('noteLinks', 'noteId')).toBeDefined()
    expect(index('noteLinks', '[refType+refId]')?.compound).toBe(true)
    expect(index('notes', 'vaultPath')).toBeDefined()

    // Booleans are not valid IndexedDB keys, so they must never be indexed.
    expect(index('tasks', 'isTemplate')).toBeUndefined()
    expect(index('milestones', 'done')).toBeUndefined()

    db.close()
    await Dexie.delete('vaultwork-index-probe')
  })
})
