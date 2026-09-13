import {
  AI_DISABLED,
  AI_EXPIRED,
  AI_NOT_CONFIGURED,
  AI_NO_CHOICE,
  AI_UNSUPPORTED,
  aiChoices,
  aiClarification,
  aiProposal,
  ambiguity,
  CANCELLED,
  clamp,
  confirmDelete,
  GREETING,
  goalList,
  groupedTaskList,
  habitList,
  help,
  NO_SUCH_TASK,
  NOTHING_TO_CANCEL,
  NOTHING_TO_CONFIRM,
  projectList,
  status as statusText,
  taskCreated,
  taskList,
  UNKNOWN_COMMAND,
} from '@/integrations/telegram/telegramFormat'
import {
  isKnownCommand,
  parseTelegramText,
  TELEGRAM_HELP,
  type TelegramRef,
} from '@/integrations/telegram/telegramCommands'
import { platform, type IncomingTelegramMessage } from '@/platform'
import { messageLogRepo, taskRepo } from '@/repositories'
import type { Id, Task } from '@/types/entities'
import { execute, resolveChoice } from './commands/commandExecutor'
import { parseCommand } from './commands/commandRouter'
import { resolveTaskByText, taskChoices } from './commands/entityResolver'
import type { CommandChoice, CommandIntent, CommandResult, EntityRef } from './commands/intents'
import { byId } from './commands/intents'
import { getGoalsView } from './goalQueryService'
import { getHabitsView } from './habitQueryService'
import { getProjectsView } from './projectQueryService'
import { getTaskCounts, getTaskView } from './taskQueryService'
import { askAi, proposeAiChoices, type AiUnavailableReason } from './ai/aiAssistantService'
import { cancelAiConfirmation, confirmAiAction } from './ai/aiConfirmationService'
import type { AiStepOutcome } from '@/ai/bridge/aiBridgeTypes'
import { TASK_VIEW_LABELS, type TaskViewId } from './tasks/taskViews'

/**
 * Telegram, as a remote control for the application that already exists.
 *
 * The whole point of this file is how little it does. It deduplicates, it
 * decides whether the sender is allowed to speak, it turns a chat line into a
 * command the application already understands, and it turns the answer back
 * into a sentence. It does not know how to create a task, complete one, or
 * parse "tomorrow at 7pm" — `parseCommand` and `execute` do, and they are the
 * same functions the Quick Add box and the command palette call.
 *
 * Three properties are load-bearing:
 *
 *  1. **Exactly-once effect on an at-least-once transport.** Telegram redelivers
 *     any update whose offset was not advanced, which happens every time the
 *     app dies mid-processing. The unique `[source+externalId]` index on the
 *     message log — built in M1 for precisely this — decides, so a duplicate is
 *     rejected by the database rather than by remembering to check.
 *
 *  2. **The cursor moves last.** `ack` is only called after the mutation *and*
 *     the message log row have committed. A crash before that costs a replayed
 *     update, which (1) makes harmless. A crash after it would cost a lost
 *     message, which is why the order is not the other way round.
 *
 *  3. **Reading changes nothing.** `/today` runs a query service and emits no
 *     event. Receiving a message is not itself a mutation, so it does not
 *     appear in the event log either.
 */

const SOURCE = 'telegram' as const

// ------------------------------------------------------------ chat session
//
// Ephemeral, per-chat, in memory. Deliberately not persisted: a pending
// "delete this?" that survived a restart would be a confirmation the user had
// forgotten agreeing to, and a stale list reference could complete the wrong
// task. Losing this on restart is the safe failure.

const PENDING_TTL_MS = 5 * 60 * 1000

interface ChatSession {
  /** The tasks the chat was last shown, in the order they were numbered. */
  lastList: Id[]
  /** A destructive action waiting for /confirm, with its expiry. */
  pendingConfirm: { intent: CommandIntent; title: string; expiresAt: number } | null
  /** An ambiguous command waiting for a number, with its expiry. */
  pendingChoice: { intent: CommandIntent; choices: CommandChoice[]; expiresAt: number } | null

  /*
   * The assistant's two pieces of transport state, and nothing more.
   *
   * Note what is absent: no prompt, no answer, no context, no conversation. The
   * chat remembers which numbered options it printed and which proposal it is
   * waiting on — everything else about an AI turn lives in the layers that own
   * it. In particular the proposal is referenced by *id*: the pinned intent
   * stays in M15.5, so a restart cannot revive it and nothing here could
   * re-target it.
   */
  pendingAi: { confirmationId: string } | null
  /**
   * Ambiguous assistant steps waiting for a number.
   *
   * `chosen` accumulates the answers, because a plan may be unsure about more
   * than one thing and a chat can only ask one question at a time.
   */
  pendingAiChoices: {
    steps: AiStepOutcome[]
    chosen: Map<string, Id>
    expiresAt: number
  } | null
}

const sessions = new Map<string, ChatSession>()

function sessionFor(chatId: string): ChatSession {
  const existing = sessions.get(chatId)
  if (existing) return existing
  const fresh: ChatSession = {
    lastList: [],
    pendingConfirm: null,
    pendingChoice: null,
    pendingAi: null,
    pendingAiChoices: null,
  }
  sessions.set(chatId, fresh)
  return fresh
}

/** Test seam, and what `disconnect` uses to forget a conversation. */
export function resetTelegramSessions(): void {
  sessions.clear()
}

const live = <T extends { expiresAt: number }>(pending: T | null, now: number): T | null =>
  pending !== null && pending.expiresAt > now ? pending : null

// ------------------------------------------------------------------ replies

export interface TelegramReply {
  chatId: string
  text: string
}

export interface ProcessOutcome {
  /** False when the update had already been handled. */
  processed: boolean
  reply: TelegramReply | null
  /** The message log row's id, when one was written. */
  messageId: Id | null
}

function rememberList(chatId: string, tasks: Task[]): void {
  sessionFor(chatId).lastList = tasks.map((task) => task.id)
}

/** Turns `/done 2` into an id, using the list this chat was last shown. */
function resolveRef(chatId: string, ref: TelegramRef): EntityRef | null {
  if (ref.by === 'none') return null
  if (ref.by === 'text') return { by: 'text', query: ref.query }

  const list = sessionFor(chatId).lastList
  const id = list[ref.index - 1]
  return id === undefined ? null : byId(id)
}

/** Rebuilds a ref-carrying intent against a chosen id, as M3's resolveChoice does. */
const withId = (intent: CommandIntent, id: Id): CommandIntent =>
  ('ref' in intent ? { ...intent, ref: byId(id) } : intent) as CommandIntent

// ----------------------------------------------------------------- queries

async function listReply(view: TaskViewId, chatId: string): Promise<string> {
  const data = await getTaskView(view)
  const open = data.tasks.filter((task) => task.status !== 'done')
  rememberList(chatId, open)

  const label = TASK_VIEW_LABELS[view]

  if (view === 'upcoming') {
    const groups = data.groups.map((group) => ({
      label: group.label,
      tasks: group.tasks.filter((task) => task.status !== 'done'),
    }))
    rememberList(
      chatId,
      groups.flatMap((group) => group.tasks),
    )
    return groupedTaskList(label, groups, data.today, 'Nothing scheduled.')
  }

  const empty =
    view === 'overdue'
      ? 'No overdue tasks.'
      : view === 'inbox'
        ? 'Inbox is empty.'
        : `Nothing in ${label}.`

  return taskList(label, open, data.today, empty)
}

async function statusReply(): Promise<string> {
  const [counts, habits] = await Promise.all([getTaskCounts(), getHabitsView()])
  return statusText({
    today: counts.today,
    inbox: counts.inbox,
    overdue: counts.overdue,
    habitsDone: habits.summary.completed,
    habitsTotal: habits.summary.scheduled,
  })
}

// ---------------------------------------------------------------- results

/** Turns a CommandResult into something to say, and records any follow-up. */
function describe(result: CommandResult, chatId: string): string {
  if (result.status === 'ambiguous') {
    // The executor already produced the numbered choices; Telegram renders the
    // same list the command palette would, rather than deciding for itself.
    const session = sessionFor(chatId)
    session.pendingChoice = {
      intent: result.intent,
      choices: result.choices,
      expiresAt: Date.now() + PENDING_TTL_MS,
    }
    rememberList(chatId, [])
    return ambiguity(result.choices.map((choice) => ({ title: choice.label })))
  }

  if (result.status === 'not_found') return NO_SUCH_TASK
  if (result.status === 'error') return result.message

  return result.message
}

// --------------------------------------------------------------- assistant
//
// Telegram's whole contribution to the assistant is this section: it decides
// *when* to ask, remembers which numbers it printed, and turns application
// values into sentences. It builds no context, sends no provider request,
// parses no reply, resolves no reference and executes nothing — `askAi` does
// the first four and M15.5 does the last, exactly as they do for the desktop
// screen. There is one pipeline, and this is a caller of it.

const UNAVAILABLE: Record<AiUnavailableReason, string> = {
  unsupported: AI_UNSUPPORTED,
  'not-configured': AI_NOT_CONFIGURED,
  disabled: AI_DISABLED,
}

/** Clears whichever pending thing this chat was previously waiting on. */
function clearPending(session: ChatSession): void {
  session.pendingConfirm = null
  session.pendingChoice = null
  session.pendingAi = null
  session.pendingAiChoices = null
}

/** What the executor did, said plainly. Never claims more than it can. */
function describeExecution(outcome: Awaited<ReturnType<typeof confirmAiAction>>): string {
  if (outcome.status === 'refused') {
    return outcome.reason === 'expired' ? AI_EXPIRED : outcome.message
  }
  if (outcome.status === 'executed') {
    return clamp(outcome.results.map((result) => result.message).join('\n'))
  }

  // Sequential, not atomic: the steps before the failure did happen, and saying
  // otherwise would be a lie the user could not check.
  const done = outcome.results.filter((result) => result.status === 'ok')
  const lines = done.map((result) => result.message)
  return clamp(
    [
      ...lines,
      done.length > 0 ? '' : null,
      `Stopped: ${outcome.message}`,
      done.length > 0 ? 'The steps above were applied. Nothing after them ran.' : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  )
}

/**
 * One question to the assistant, and whatever it comes back with.
 *
 * Exactly one provider call. Ambiguity and confirmation are answered from
 * application state afterwards, never by asking again.
 */
async function aiReply(
  text: string,
  session: ChatSession,
  now: number,
  /**
   * What to say instead when the assistant cannot be reached.
   *
   * `/ask` passes `null` and hears the real reason, because asking for the
   * assistant deserves an answer about the assistant. The unknown-command seam
   * passes M14's own reply, so a chat with no assistant configured — which is
   * every chat by default — answers exactly as it did before rather than
   * advertising a feature that is not switched on.
   */
  whenUnavailable: string | null,
): Promise<string> {
  const result = await askAi(text)

  switch (result.kind) {
    case 'unavailable':
      return whenUnavailable ?? UNAVAILABLE[result.reason]

    case 'answer':
      // Plain text: M14 sends without a parse mode, so Markdown would arrive as
      // literal asterisks rather than emphasis.
      return clamp(result.message)

    case 'clarification':
      return aiClarification(result.message, result.options)

    case 'choices': {
      clearPending(session)
      session.pendingAiChoices = {
        steps: result.steps,
        chosen: new Map(),
        expiresAt: now + PENDING_TTL_MS,
      }
      return askNextChoice(session.pendingAiChoices)
    }

    case 'proposal': {
      clearPending(session)
      // Only the id is kept. The pinned intent stays in M15.5, so this chat
      // cannot re-target it and a restart cannot revive it.
      session.pendingAi = { confirmationId: result.confirmation.id }
      return aiProposal(result.confirmation.summary)
    }

    case 'unresolved':
    case 'error':
      return clamp(result.message)
  }
}

/**
 * Turns "1" into a proposal, without asking the model anything.
 *
 * Deliberately not `resolveChoice`, which rebuilds an ambiguous intent *and
 * executes it*. That is right for a command the user typed, where the number is
 * the decision; it is wrong here, where the number only settles which row was
 * meant. The pinned intent still has to pass M15.5.
 */
type PendingChoices = NonNullable<ChatSession['pendingAiChoices']>

/** The first step still waiting for an answer, or `null` when all are settled. */
function nextUnanswered(pending: PendingChoices) {
  for (const step of pending.steps) {
    if (step.status === 'ambiguous' && !pending.chosen.has(step.id)) return step
  }
  return null
}

/**
 * Asks about one uncertainty at a time.
 *
 * A plan may be unsure about several things, and a chat has one reply box. The
 * UI can show every question at once; here they are asked in plan order, which
 * is also the order the user will see them applied.
 */
function askNextChoice(pending: PendingChoices): string {
  const step = nextUnanswered(pending)
  if (step === null) return AI_NO_CHOICE

  const remaining = pending.steps.filter(
    (candidate) => candidate.status === 'ambiguous' && !pending.chosen.has(candidate.id),
  ).length

  const question = aiChoices(
    step.query,
    step.choices.map((choice) => choice.label),
  )
  return remaining > 1 ? `${question}\n\n(${remaining} to settle)` : question
}

/**
 * Records one answer and either asks the next question or proposes the plan.
 *
 * Deliberately not `resolveChoice`, which rebuilds an ambiguous intent *and
 * executes it*. That is right for a command the user typed, where the number is
 * the decision; it is wrong here, where the number only settles which row was
 * meant. The pinned plan still has to pass M15.5, and no provider is asked
 * anything at any point in this function.
 */
async function aiChoiceReply(
  pending: PendingChoices,
  index: number,
  session: ChatSession,
): Promise<string> {
  const step = nextUnanswered(pending)
  if (step === null) return AI_NO_CHOICE

  const picked = step.choices[index - 1]
  if (picked === undefined) {
    // A number nobody offered settles nothing, so the question stands.
    session.pendingAiChoices = pending
    return `${AI_NO_CHOICE}\n\n${askNextChoice(pending)}`
  }

  pending.chosen.set(step.id, picked.id)

  if (nextUnanswered(pending) !== null) {
    session.pendingAiChoices = pending
    return askNextChoice(pending)
  }

  const confirmation = await proposeAiChoices(pending.steps, pending.chosen)
  if (confirmation === null) return AI_NO_CHOICE

  session.pendingAi = { confirmationId: confirmation.id }
  return aiProposal(confirmation.summary)
}

// --------------------------------------------------------------- the entry

/**
 * Handles one Telegram update.
 *
 * The order below is the correctness argument: log first (which rejects a
 * duplicate), then mutate, then mark the log row done. The caller advances the
 * Telegram cursor only after this resolves.
 */
export async function processTelegramMessage(
  message: IncomingTelegramMessage,
  options: { authorizedChatId: string | null } = { authorizedChatId: null },
): Promise<ProcessOutcome> {
  // Defence in depth. The native worker already refuses an unknown chat before
  // emitting, so reaching here with the wrong id would mean a bug upstream —
  // and a bug upstream is exactly when a second check earns its keep.
  if (options.authorizedChatId !== null && message.chatId !== options.authorizedChatId) {
    return { processed: false, reply: null, messageId: null }
  }

  // The database decides whether this is new. A check-then-insert would race
  // itself against a redelivery arriving while the first is still running.
  const logged = await messageLogRepo.appendIfNew({
    source: SOURCE,
    externalId: message.externalId,
    text: message.text,
    receivedAt: message.receivedAt,
  })

  if (!logged.created) {
    // Already handled. Say nothing — the user got their answer the first time,
    // and a second identical reply would be more confusing than silence.
    return { processed: false, reply: null, messageId: logged.record.id }
  }

  try {
    const text = await respond(message)
    await messageLogRepo.markProcessed(logged.record.id, null)
    return {
      processed: true,
      reply: text === null ? null : { chatId: message.chatId, text },
      messageId: logged.record.id,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await messageLogRepo.markFailed(logged.record.id, reason)
    return {
      processed: true,
      reply: { chatId: message.chatId, text: 'Something went wrong handling that.' },
      messageId: logged.record.id,
    }
  }
}

/** Decides what one authorized line of text means, and does it. */
async function respond(message: IncomingTelegramMessage): Promise<string | null> {
  const chatId = message.chatId
  const session = sessionFor(chatId)
  const now = Date.now()
  const action = parseTelegramText(message.text)
  const today = platform.clock.today()

  /*
   * A bare number answers a "which one?" question before it means anything
   * else. The assistant's list is checked first only because the two are
   * mutually exclusive — proposing one clears the other — so this is reading
   * whichever question is actually outstanding, not a new precedence rule.
   */
  const aiChoice = live(session.pendingAiChoices, now)
  if (aiChoice !== null) {
    /*
     * A bare "1" is quick capture everywhere else — and stays so, because this
     * only reads it while a numbered assistant question is actually
     * outstanding. `/done 1` is accepted too, since that is the form M14 taught
     * for its own numbered lists.
     */
    const bare = /^\d{1,3}$/.exec(message.text.trim())
    const index =
      bare !== null
        ? Number(bare[0])
        : action.kind === 'complete' && action.ref.by === 'index'
          ? action.ref.index
          : null

    if (index !== null) {
      session.pendingAiChoices = null
      return aiChoiceReply(aiChoice, index, session)
    }
  }

  const choice = live(session.pendingChoice, now)
  if (choice !== null && action.kind === 'complete' && action.ref.by === 'index') {
    const picked = choice.choices[action.ref.index - 1]
    session.pendingChoice = null
    if (picked === undefined) return NO_SUCH_TASK
    const result = await resolveChoice(choice.intent, picked.id)
    return describe(result, chatId)
  }

  switch (action.kind) {
    case 'start':
      return GREETING

    case 'help':
      return help(TELEGRAM_HELP)

    case 'status':
      return statusReply()

    case 'cancel': {
      const had =
        live(session.pendingConfirm, now) !== null ||
        live(session.pendingChoice, now) !== null ||
        session.pendingAi !== null ||
        live(session.pendingAiChoices, now) !== null

      // A withdrawn proposal is withdrawn in the gate too, not merely forgotten
      // here — otherwise it would sit pending until its own expiry.
      if (session.pendingAi !== null) cancelAiConfirmation(session.pendingAi.confirmationId)
      clearPending(session)
      return had ? CANCELLED : NOTHING_TO_CANCEL
    }

    case 'confirm': {
      /*
       * An assistant proposal is authorised by M15.5, never here. This branch
       * hands over an id and reports what came back: the gate owns expiry,
       * single use and the pinned intent, so a replayed /confirm is refused by
       * the same code the desktop screen relies on rather than by a second
       * counter kept in this file.
       */
      const proposal = session.pendingAi
      if (proposal !== null) {
        session.pendingAi = null
        return describeExecution(await confirmAiAction(proposal.confirmationId))
      }

      const pending = live(session.pendingConfirm, now)
      // Single-use and time-boxed: a stale or replayed /confirm deletes nothing.
      session.pendingConfirm = null
      if (pending === null) return NOTHING_TO_CONFIRM
      const result = await execute(pending.intent)
      return describe(result, chatId)
    }

    case 'list':
      return listReply(action.view, chatId)

    case 'habits': {
      const data = await getHabitsView()
      return habitList(
        data.active.map((item) => ({ habit: item.habit, doneToday: item.completedToday })),
      )
    }

    case 'projects': {
      const data = await getProjectsView()
      return projectList(
        data.active.map((item) => ({ project: item.project, open: item.stats.remaining })),
      )
    }

    case 'goals': {
      const data = await getGoalsView()
      return goalList(
        data.goals.map((item) => ({
          goal: item.goal,
          done: item.milestones.done,
          total: item.milestones.total,
        })),
      )
    }

    case 'complete': {
      const ref = resolveRef(chatId, action.ref)
      if (ref === null) return NO_SUCH_TASK
      const result = await execute({
        kind: 'task.complete',
        source: SOURCE,
        raw: message.text,
        ref,
      })
      return describe(result, chatId)
    }

    case 'delete': {
      const ref = resolveRef(chatId, action.ref)
      if (ref === null) return NO_SUCH_TASK

      // Deleting is destructive, so it is proposed rather than performed. The
      // task is resolved *now* — so the confirmation names a real row and the
      // later /confirm cannot drift onto a different one — but nothing is
      // written until the user says so.
      const intent: CommandIntent = {
        kind: 'task.delete',
        source: SOURCE,
        raw: message.text,
        ref,
      }
      const preview = await previewTask(ref)
      if (preview === null) return NO_SUCH_TASK
      if (preview.kind === 'ambiguous') {
        session.pendingChoice = {
          intent,
          choices: preview.choices,
          expiresAt: now + PENDING_TTL_MS,
        }
        return ambiguity(preview.choices.map((choice) => ({ title: choice.label })))
      }

      // Pinned to the resolved id, so the later /confirm cannot drift onto a
      // different task if the list changed in between.
      // One pending action per chat, which is already how M14 behaves when a
      // second /delete replaces the first. Without this, a /confirm meant for
      // this deletion could land on an assistant proposal made in between.
      if (session.pendingAi !== null) cancelAiConfirmation(session.pendingAi.confirmationId)
      session.pendingAi = null
      session.pendingAiChoices = null

      session.pendingConfirm = {
        intent: withId(intent, preview.task.id),
        title: preview.task.title,
        expiresAt: now + PENDING_TTL_MS,
      }
      return confirmDelete(preview.task.title)
    }

    case 'note': {
      // The existing note.add intent, executed by the existing executor. The
      // note that comes out is an ordinary Vaultwork note, vault path and all.
      const result = await execute({
        kind: 'note.add',
        source: SOURCE,
        raw: message.text,
        title: action.title,
        body: action.body,
        tagIds: [],
        links: [],
      })
      return describe(result, chatId)
    }

    case 'route': {
      // Parsed first, executed second, so the *intent* is known when the answer
      // is formatted. `parseCommand` is the same function Quick Add and the
      // command palette call — Telegram inherits every token they support.
      const intent = parseCommand(action.text, { source: SOURCE })
      const result = await execute(intent)

      if (result.status === 'ok' && result.kind === 'task' && intent.kind === 'task.add') {
        return taskCreated(result.task, today)
      }
      // A view command typed at Telegram should answer with the list, not with
      // "opened Today" — there is no screen to open in a chat.
      if (result.status === 'ok' && result.kind === 'view') {
        return listReply(result.view, chatId)
      }
      if (result.status === 'ok' && result.kind === 'navigate') {
        return result.message
      }
      return describe(result, chatId)
    }

    case 'ask':
      return aiReply(action.text, session, now, null)

    case 'unknown':
      /*
       * The established seam, unchanged in meaning: this is still "I did not
       * understand that". M14 answered with the help hint; now the assistant is
       * given the line first, and its own failure falls back to a readable
       * message of its own.
       *
       * Note what does *not* arrive here. Plain text is quick capture and has
       * been since M14 — turning it into a question would break the thing this
       * chat is fastest at — so a natural-language request is asked with /ask.
       */
      return action.command.length === 0 || isKnownCommand(message.text)
        ? UNKNOWN_COMMAND
        : aiReply(message.text, session, now, UNKNOWN_COMMAND)
  }
}

/**
 * Looks up what a delete would hit, without touching it.
 *
 * Uses `resolveTaskByText` and `taskChoices` — the same functions the executor
 * calls — over the same live-task pool, so "which task?" is answered by one set
 * of rules. It stops before the mutation, which is the only difference.
 */
async function previewTask(
  ref: EntityRef,
): Promise<{ kind: 'one'; task: Task } | { kind: 'ambiguous'; choices: CommandChoice[] } | null> {
  if (ref.by === 'id') {
    const task = await taskRepo.get(ref.id)
    return task === undefined ? null : { kind: 'one', task }
  }

  const query = ref.query.trim()
  if (query.length === 0) return null

  const resolution = resolveTaskByText(await taskRepo.listLive(), query)
  if (resolution.status === 'resolved') return { kind: 'one', task: resolution.entity }
  if (resolution.status === 'ambiguous') {
    return { kind: 'ambiguous', choices: taskChoices(resolution.candidates, () => null) }
  }
  return null
}
