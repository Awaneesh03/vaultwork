import { tagRepo, taskRepo } from '@/repositories'
import type { Id, Tag, Task } from '@/types/entities'
import type { EventSource } from '@/types/enums'

/**
 * Tags — one of the two things a task points at. Projects got their own
 * service in M4; see `projectService.ts`.
 *
 * The M2 rule this service is built around: tag names carry a unique index, and
 * a soft-deleted tag still occupies its name. Creating a tag whose name matches
 * a deleted one therefore *restores* that row, so every task that still
 * references it starts working again. That is handled in `tagRepo`; this layer
 * only has to avoid working around it.
 *
 * A deleted tag's id is deliberately left in `task.tagIds`. Stripping it would
 * make deletion destructive and restore useless; instead the read path filters
 * assignments down to live tags, which makes restore exactly reversible.
 */

export class TagNameTakenError extends Error {
  readonly existing: Tag

  constructor(existing: Tag) {
    super(
      existing.deletedAt === null
        ? `A tag called “${existing.name}” already exists`
        : `“${existing.name}” belongs to a deleted tag. Restore it instead of renaming onto it.`,
    )
    this.name = 'TagNameTakenError'
    this.existing = existing
  }
}

const normalise = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export function listTags(): Promise<Tag[]> {
  return tagRepo.list()
}

export function listDeletedTags(): Promise<Tag[]> {
  return tagRepo.listDeleted()
}

/** Creates a tag, or restores the deleted one that already holds the name. */
export async function createTag(
  name: string,
  color: string | null = null,
  source: EventSource = 'ui',
): Promise<Tag> {
  const clean = normalise(name)
  if (clean.length === 0) throw new Error('A tag needs a name')
  return tagRepo.createOrRestoreByName(clean, color, { source })
}

export async function renameTag(id: Id, name: string, source: EventSource = 'ui'): Promise<Tag> {
  const clean = normalise(name)
  if (clean.length === 0) throw new Error('A tag needs a name')

  const current = await tagRepo.getOrThrow(id)
  if (current.name === clean) return current

  const holder = await tagRepo.findByName(clean)
  if (holder && holder.id !== id) throw new TagNameTakenError(holder)

  return tagRepo.update(id, { name: clean }, { source })
}

export function setTagColor(
  id: Id,
  color: string | null,
  source: EventSource = 'ui',
): Promise<Tag> {
  return tagRepo.update(id, { color }, { source })
}

/**
 * Soft delete. Task assignments are left untouched on purpose — see the note at
 * the top of this file — so restoring the tag restores every assignment with it.
 */
export async function deleteTag(id: Id, source: EventSource = 'ui'): Promise<Tag> {
  const tag = await tagRepo.getOrThrow(id)
  await tagRepo.softDelete(id, { source })
  return tag
}

export function restoreTag(id: Id, source: EventSource = 'ui'): Promise<Tag> {
  return tagRepo.restore(id, { source })
}

/**
 * Turns the tag *names* a parser produced into ids, creating what does not
 * exist yet. Quick Add is a capture surface: being asked to create the tag
 * first would defeat the point.
 */
export async function resolveTagNames(names: string[], source: EventSource = 'ui'): Promise<Id[]> {
  const ids: Id[] = []
  for (const name of names) {
    const clean = normalise(name)
    if (clean.length === 0) continue
    const tag = await tagRepo.createOrRestoreByName(clean, null, { source })
    if (!ids.includes(tag.id)) ids.push(tag.id)
  }
  return ids
}

export function tasksForTag(tagId: Id): Promise<Task[]> {
  return taskRepo.byTag(tagId)
}

export interface TagUsage {
  tag: Tag
  open: number
  total: number
}

/** How many tasks use each tag. Drives the filter list's counts. */
export async function tagUsage(): Promise<TagUsage[]> {
  const [tags, tasks] = await Promise.all([tagRepo.list(), taskRepo.listLive()])
  return tags.map((tag) => {
    const tagged = tasks.filter((task) => task.tagIds.includes(tag.id))
    return {
      tag,
      open: tagged.filter((task) => task.status === 'todo').length,
      total: tagged.length,
    }
  })
}

/** Only the live tags a task points at, in the order the tag list is in. */
export function liveTagsFor(task: Task, tags: Tag[]): Tag[] {
  return tags.filter((tag) => task.tagIds.includes(tag.id))
}
