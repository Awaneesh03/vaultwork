import type {
  AiEntityLookup,
  AiRefResolution,
  AiRefScope,
} from '@/ai/bridge/aiBridgeTypes'
import type { Task } from '@/types/entities'
import { resolveTaskByText, taskChoices } from '../commands/entityResolver'
import { getTaskView, type TaskViewData } from '../taskQueryService'

/**
 * Turning a model's phrase into a row, using the resolver the application
 * already uses for everything else.
 *
 * There is exactly one definition of "which task did you mean?" in Vaultwork —
 * `entityResolver`'s five ranked tiers, with its refusal to commit unless the
 * best-matching tier holds exactly one candidate — and this reaches for it
 * rather than approximating it. That matters beyond avoiding duplication: it
 * means the assistant and the command palette answer the same question the same
 * way, so a phrase that is ambiguous when typed is ambiguous when a model says
 * it, and neither one guesses.
 *
 * The adapter half of `AiEntityLookup`, declared in `src/ai/bridge`. The AI
 * layer receives this rather than reaching for it, which is what keeps it free
 * of services, repositories and Dexie.
 */

/**
 * One read for the whole resolution pass.
 *
 * Two reasons, and the second is the important one. A plan with four steps
 * should not cost four scans — but more than that, four separate reads could
 * each see a different database, and a plan resolved against a shifting picture
 * is a plan nobody can reason about. Memoising per instance gives every step of
 * one pass a single consistent view.
 *
 * It is scoped to the instance rather than the module, so it is not a cache:
 * the next request builds a new lookup and reads again. Nothing stale survives
 * a call.
 */
export function createAiEntityLookup(): AiEntityLookup {
  let pending: Promise<TaskViewData> | null = null

  // The `all` view is `status: 'all'` over live rows, which is the same pool
  // `taskRepo.listLive()` gives the executor — templates and deleted rows are
  // already excluded by the repository.
  const load = () => (pending ??= getTaskView('all'))

  const poolFor = (tasks: Task[], scope: AiRefScope) =>
    scope === 'open' ? tasks.filter((task) => task.status === 'todo') : tasks

  return {
    async resolveTask(query: string, scope: AiRefScope): Promise<AiRefResolution> {
      const trimmed = query.trim()
      if (trimmed.length === 0) return { status: 'not_found', query }

      const view = await load()
      const resolution = resolveTaskByText(poolFor(view.tasks, scope), trimmed)

      if (resolution.status === 'resolved') {
        return { status: 'resolved', id: resolution.entity.id }
      }
      if (resolution.status === 'ambiguous') {
        return {
          status: 'ambiguous',
          query: trimmed,
          // The same numbered choices the executor produces, capped at
          // `MAX_CHOICES` by the resolver. No hint, matching how the Telegram
          // adapter previews an ambiguous reference.
          choices: taskChoices(resolution.candidates, () => null),
        }
      }
      return { status: 'not_found', query: trimmed }
    },
  }
}

/**
 * The lookup a caller uses when it has no reason to hold one.
 *
 * Still a fresh instance per call, so "one consistent read per pass" holds
 * without the convenience turning into a shared cache.
 */
export const aiEntityLookup: AiEntityLookup = {
  resolveTask: (query, scope) => createAiEntityLookup().resolveTask(query, scope),
}
