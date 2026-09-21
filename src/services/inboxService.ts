import { newId } from '@/lib/id'
import { platform } from '@/platform'
import { messageLogRepo, projectRepo } from '@/repositories'
import type { Id, MessageLog, Timestamp } from '@/types/entities'
import { eventBus } from './eventBus'
import { execute } from './commands/commandExecutor'
import { failed, type CommandResult } from './commands/intents'
import {
  classifyCapture,
  INBOX_LIMITS,
  proposalToIntent,
  validateInboxProposal,
  type Classification,
} from './inbox/inboxProposal'

/**
 * The Universal Inbox (M18.3): capture first, organise second.
 *
 * An intake queue, not a second database. A capture is a row in `messageLog` —
 * the table that already holds raw text awaiting a decision, for Telegram —
 * with `source: 'inbox'`. Resolving one runs an existing creation command
 * through the one executor every producer uses, and records which entity it
 * became. Nothing here writes a task, a note or a project itself.
 *
 * The same shape `telegramService` has, deliberately: a producer that turns
 * text into a `CommandIntent`, hands it to `execute`, and records the outcome.
 * A second producer is a new way in; a second executor would be a second way
 * to write, and there is not one.
 */

export class EmptyCaptureError extends Error {
  constructor() {
    super('Type something to capture.')
    this.name = 'EmptyCaptureError'
  }
}

export interface InboxItem {
  /** The capture's public id — `externalId` on its row, and its provenance id. */
  id: Id
  text: string
  capturedAt: Timestamp
  classification: Classification
}

async function classifyRow(row: MessageLog): Promise<InboxItem> {
  const projects = await projectRepo.listLive()
  return {
    id: row.externalId,
    text: row.text,
    capturedAt: row.receivedAt,
    classification: classifyCapture(row.text, {
      now: new Date(platform.clock.now()),
      projects,
    }),
  }
}

/**
 * Keeps the raw text, and nothing else, before any decision is made.
 *
 * The capture exists the moment Enter is pressed: closing the dialog, reloading
 * or losing power afterwards costs nothing, because deciding what it is has not
 * started yet.
 */
export async function captureText(input: string): Promise<InboxItem> {
  const text = input.trim()
  if (text.length === 0) throw new EmptyCaptureError()

  const row = await messageLogRepo.append({
    source: 'inbox',
    externalId: newId(),
    text: text.slice(0, INBOX_LIMITS.capture),
    receivedAt: platform.clock.now(),
  })

  await eventBus.emit({
    type: 'inbox.captured',
    entityType: 'capture',
    entityId: row.externalId,
    source: 'inbox',
    // The length, not the words: the event log is analytics, and the capture
    // itself is already stored where it belongs.
    payload: { chars: row.text.length },
  })

  return classifyRow(row)
}

/** Captures still waiting for a decision, oldest first. */
export async function listInbox(): Promise<InboxItem[]> {
  const pending = await messageLogRepo.listByStatus('pending')
  return Promise.all(pending.filter((row) => row.source === 'inbox').map(classifyRow))
}

async function pendingCapture(id: Id): Promise<MessageLog | null> {
  const row = await messageLogRepo.findByExternalId('inbox', id)
  return row && row.deletedAt === null && row.status === 'pending' ? row : null
}

function createdEntity(result: CommandResult): { entityType: string; entityId: Id } | null {
  if (result.status !== 'ok') return null
  switch (result.kind) {
    case 'task':
      return { entityType: 'task', entityId: result.task.id }
    case 'note':
      return { entityType: 'note', entityId: result.note.id }
    case 'project':
      return { entityType: 'project', entityId: result.project.id }
    case 'goal':
      return { entityType: 'goal', entityId: result.goal.id }
    case 'habit':
      return { entityType: 'habit', entityId: result.habit.id }
    default:
      return null
  }
}

/**
 * Turns an accepted proposal into the thing it proposes.
 *
 * `proposal` is typed `unknown` on purpose: it arrives from a form the user
 * edited, and it is validated here — at the boundary — rather than trusted
 * because a component built it. A project id must name a live project; the
 * inbox never runs a command against an id it could not find.
 *
 * The capture is marked done only after the command succeeds. A refusal or a
 * failure leaves it in the inbox, unchanged, for the user to correct.
 */
export async function resolveCapture(id: Id, proposal: unknown): Promise<CommandResult> {
  const row = await pendingCapture(id)
  if (row === null) return failed('That capture has already been dealt with.')

  const validated = validateInboxProposal(proposal)
  if (!validated.ok) return failed(validated.error)

  const chosen = validated.proposal
  if ('projectId' in chosen && chosen.projectId !== null) {
    const project = await projectRepo.get(chosen.projectId)
    if (!project || project.deletedAt !== null) return failed('That project no longer exists.')
  }

  const result = await execute(proposalToIntent(chosen, row.externalId))

  const entity = createdEntity(result)
  if (entity !== null) await messageLogRepo.markProcessed(row.id, entity)
  return result
}

/** Removes a capture from the inbox. The row is kept, soft-deleted. */
export async function dismissCapture(id: Id): Promise<void> {
  const row = await pendingCapture(id)
  if (row === null) return
  await messageLogRepo.dismiss(row.id)
  await eventBus.emit({
    type: 'inbox.dismissed',
    entityType: 'capture',
    entityId: row.externalId,
    source: 'inbox',
    payload: null,
  })
}
