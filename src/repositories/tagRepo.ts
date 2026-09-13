import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Tag } from '@/types/entities'
import { createRepository, type WriteOptions } from './baseRepository'

const base = createRepository('tags')

/**
 * Tag names carry a unique index, which interacts with soft deletes: a deleted
 * tag still occupies its name. Rather than dropping the constraint, creating a
 * tag whose name matches a deleted one *restores* that row — so every task that
 * still references it keeps working, which is what you would want anyway.
 */
export const tagRepo = {
  ...base,

  async findByName(name: string): Promise<Tag | undefined> {
    try {
      return await db.tags.where('name').equals(name).first()
    } catch (error) {
      throw toRepositoryError('tags', error, 'findByName')
    }
  },

  async createOrRestoreByName(
    name: string,
    color: string | null = null,
    options: WriteOptions = {},
  ): Promise<Tag> {
    const existing = await this.findByName(name)
    if (!existing) return base.create({ name, color }, options)
    if (existing.deletedAt === null) return existing
    return base.restore(existing.id, options)
  },
}
