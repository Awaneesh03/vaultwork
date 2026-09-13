import { beforeEach, describe, expect, it } from 'vitest'
import { eventRepo, tagRepo, taskRepo } from '@/repositories'
import { freezeClock, resetDatabase } from '../../tests/helpers'
import { addTaskTag, createTask, setTaskTags } from './taskService'
import { createProject } from './projectService'
import {
  TagNameTakenError,
  createTag,
  deleteTag,
  listTags,
  liveTagsFor,
  renameTag,
  resolveTagNames,
  restoreTag,
  setTagColor,
  tagUsage,
  tasksForTag,
} from './tagService'

const NOW = new Date(2026, 8, 3, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
})

describe('creating tags', () => {
  it('normalises the name, because tag names are unique', async () => {
    const tag = await createTag('  Deep   Work  ')
    expect(tag.name).toBe('deep work')
  })

  it('returns the existing tag rather than failing on the unique index', async () => {
    const first = await createTag('dsa')
    const second = await createTag('DSA')
    expect(second.id).toBe(first.id)
  })

  it('refuses a blank name', async () => {
    await expect(createTag('   ')).rejects.toThrow()
  })
})

describe('the M2 restore rule', () => {
  it('restores a soft-deleted tag instead of creating a duplicate name', async () => {
    const original = await createTag('dsa')
    await deleteTag(original.id)

    const again = await createTag('dsa')

    expect(again.id).toBe(original.id)
    expect(again.deletedAt).toBeNull()
    expect(await tagRepo.count()).toBe(1)
  })

  it('keeps every task that referenced the tag working through the round trip', async () => {
    const tag = await createTag('dsa')
    const task = await createTask({ title: 'Study trees', tagIds: [tag.id] })

    await deleteTag(tag.id)
    // The assignment survives deletion on purpose: stripping it would make
    // deletion destructive and restore useless.
    expect((await taskRepo.get(task.id))?.tagIds).toEqual([tag.id])
    expect(liveTagsFor((await taskRepo.get(task.id))!, await listTags())).toEqual([])

    await restoreTag(tag.id)
    expect(liveTagsFor((await taskRepo.get(task.id))!, await listTags()).map((t) => t.name)).toEqual(
      ['dsa'],
    )
  })

  it('logs the deletion and the restore', async () => {
    const tag = await createTag('dsa')
    await deleteTag(tag.id)
    await restoreTag(tag.id)

    const types = (await eventRepo.list()).sort((a, b) => a.at - b.at).map((e) => e.type)
    expect(types).toEqual(['tag.created', 'tag.deleted', 'tag.restored'])
  })
})

describe('renaming', () => {
  it('renames a tag', async () => {
    const tag = await createTag('dsa')
    expect((await renameTag(tag.id, 'Algorithms')).name).toBe('algorithms')
  })

  it('is a no-op when the name has not changed', async () => {
    const tag = await createTag('dsa')
    const same = await renameTag(tag.id, 'DSA')
    expect(same.updatedAt).toBe(tag.updatedAt)
  })

  it('refuses to collide with a live tag', async () => {
    const dsa = await createTag('dsa')
    await createTag('java')
    await expect(renameTag(dsa.id, 'java')).rejects.toBeInstanceOf(TagNameTakenError)
  })

  it('refuses to collide with a deleted tag, and says to restore it instead', async () => {
    const java = await createTag('java')
    await deleteTag(java.id)
    const dsa = await createTag('dsa')

    // Silently stealing the name would orphan every task pointing at the
    // deleted row, which restore is supposed to be able to bring back.
    await expect(renameTag(dsa.id, 'java')).rejects.toThrow(/Restore it/)
  })

  it('sets a colour', async () => {
    const tag = await createTag('dsa')
    expect((await setTagColor(tag.id, 'teal')).color).toBe('teal')
  })
})

describe('resolving names from a parser', () => {
  it('creates what does not exist and reuses what does', async () => {
    const existing = await createTag('java')
    const ids = await resolveTagNames(['java', 'college'], 'quickadd')

    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(existing.id)
    expect((await listTags()).map((t) => t.name).sort()).toEqual(['college', 'java'])
  })

  it('records the producer on the tag it created', async () => {
    await resolveTagNames(['college'], 'quickadd')
    const [event] = await eventRepo.list({ type: 'tag.created' })
    expect(event?.source).toBe('quickadd')
  })

  it('deduplicates and skips blanks', async () => {
    const ids = await resolveTagNames(['java', 'JAVA', '  ', 'java'])
    expect(ids).toHaveLength(1)
  })

  it('restores a deleted tag rather than failing the capture', async () => {
    const tag = await createTag('java')
    await deleteTag(tag.id)

    const ids = await resolveTagNames(['java'], 'quickadd')
    expect(ids).toEqual([tag.id])
    expect((await tagRepo.get(tag.id))?.deletedAt).toBeNull()
  })
})

describe('filtering tasks by tag', () => {
  it('finds tasks through the multi-entry index', async () => {
    const dsa = await createTag('dsa')
    const java = await createTag('java')

    const both = await createTask({ title: 'Study trees', tagIds: [dsa.id, java.id] })
    await createTask({ title: 'Read a book', tagIds: [] })
    const onlyJava = await createTask({ title: 'Set up Gradle', tagIds: [java.id] })

    expect((await tasksForTag(dsa.id)).map((t) => t.id)).toEqual([both.id])
    expect((await tasksForTag(java.id)).map((t) => t.id).sort()).toEqual(
      [both.id, onlyJava.id].sort(),
    )
  })

  it('reports usage counts split by open and total', async () => {
    const dsa = await createTag('dsa')
    const open = await createTask({ title: 'Study trees', tagIds: [dsa.id] })
    const done = await createTask({ title: 'Study arrays', tagIds: [dsa.id] })
    await taskRepo.update(done.id, { status: 'done' }, { emit: false })

    const usage = await tagUsage()
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ open: 1, total: 2 })
    expect(open.tagIds).toEqual([dsa.id])
  })
})

describe('assigning tags to tasks', () => {
  it('adds a tag to a task', async () => {
    const tag = await createTag('dsa')
    const task = await createTask({ title: 'Study trees' })

    await addTaskTag(task.id, tag.id)
    expect((await taskRepo.get(task.id))?.tagIds).toEqual([tag.id])
  })

  it('replaces the whole set and drops duplicates', async () => {
    const dsa = await createTag('dsa')
    const java = await createTag('java')
    const task = await createTask({ title: 'Study trees', tagIds: [dsa.id] })

    await setTaskTags(task.id, [java.id, java.id])
    expect((await taskRepo.get(task.id))?.tagIds).toEqual([java.id])
  })
})

describe('projects', () => {
  it('creates a project with defaults and an appended order', async () => {
    const first = await createProject('DSA Mastery')
    const second = await createProject('Semester 5')

    expect(first).toMatchObject({ name: 'DSA Mastery', status: 'active' })
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('refuses a blank name', async () => {
    await expect(createProject('  ')).rejects.toThrow()
  })
})
