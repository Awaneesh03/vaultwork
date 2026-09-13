import { db } from '@/db'
import { nowTs } from '@/lib/date'
import { ConstraintError, toRepositoryError } from '@/lib/errors'
import { newId } from '@/lib/id'
import type { Id, MessageLog } from '@/types/entities'
import type { MessageSource, MessageStatus } from '@/types/enums'

export interface InboundMessageInput {
  source: MessageSource
  /** The channel's own id — Telegram's `update_id`. */
  externalId: string
  text: string
  receivedAt?: number
}

export interface AppendResult {
  /** False when this message had already been recorded. */
  created: boolean
  record: MessageLog
}

/**
 * The message log exists for one reason: exactly-once effects on top of an
 * at-least-once transport.
 *
 * A channel redelivers. Telegram will resend an update if the poll cursor was
 * not advanced, which happens every time the app dies between reading a message
 * and committing it. `appendIfNew` leans on the unique [source+externalId]
 * index to decide, so correctness comes from the database rather than from
 * remembering to check first — a check-then-insert would still race itself.
 */
export const messageLogRepo = {
  async appendIfNew(input: InboundMessageInput): Promise<AppendResult> {
    const record: MessageLog = {
      id: newId(),
      createdAt: nowTs(),
      updatedAt: nowTs(),
      deletedAt: null,
      source: input.source,
      externalId: input.externalId,
      receivedAt: input.receivedAt ?? nowTs(),
      text: input.text,
      status: 'pending',
      resultEntityType: null,
      resultEntityId: null,
      error: null,
    }

    try {
      await db.messageLog.add(record)
      return { created: true, record }
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'ConstraintError') {
        const existing = await this.findByExternalId(input.source, input.externalId)
        if (existing) return { created: false, record: existing }
      }
      throw toRepositoryError('messageLog', error, 'appendIfNew')
    }
  },

  /** Strict variant: rejects a duplicate instead of reporting it. */
  async append(input: InboundMessageInput): Promise<MessageLog> {
    const result = await this.appendIfNew(input)
    if (!result.created) {
      throw new ConstraintError(
        'messageLog',
        `message ${input.source}:${input.externalId} has already been recorded`,
      )
    }
    return result.record
  },

  async findByExternalId(
    source: MessageSource,
    externalId: string,
  ): Promise<MessageLog | undefined> {
    try {
      return await db.messageLog.where('[source+externalId]').equals([source, externalId]).first()
    } catch (error) {
      throw toRepositoryError('messageLog', error, 'findByExternalId')
    }
  },

  async listByStatus(status: MessageStatus): Promise<MessageLog[]> {
    try {
      const rows = await db.messageLog.where('status').equals(status).toArray()
      return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.receivedAt - b.receivedAt)
    } catch (error) {
      throw toRepositoryError('messageLog', error, 'listByStatus')
    }
  },

  async markProcessed(
    id: Id,
    result: { entityType: string; entityId: Id } | null,
  ): Promise<MessageLog> {
    return this.setStatus(id, 'done', { result })
  },

  async markFailed(id: Id, error: string): Promise<MessageLog> {
    return this.setStatus(id, 'failed', { error })
  },

  async setStatus(
    id: Id,
    status: MessageStatus,
    extra: { result?: { entityType: string; entityId: Id } | null; error?: string } = {},
  ): Promise<MessageLog> {
    try {
      const current = await db.messageLog.get(id)
      if (!current) throw new ConstraintError('messageLog', `no message with id ${id}`)
      const next: MessageLog = {
        ...current,
        status,
        updatedAt: nowTs(),
        resultEntityType: extra.result?.entityType ?? current.resultEntityType,
        resultEntityId: extra.result?.entityId ?? current.resultEntityId,
        error: extra.error ?? (status === 'failed' ? current.error : null),
      }
      await db.messageLog.put(next)
      return next
    } catch (error) {
      throw toRepositoryError('messageLog', error, 'setStatus')
    }
  },

  async count(): Promise<number> {
    return db.messageLog.count()
  },
}
