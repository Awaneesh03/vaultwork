import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  readSnapshot,
  SnapshotError,
  snapshotPath,
  type FreshSnapshot,
  type Snapshot,
  type SnapshotTask,
} from './snapshot.ts'

/**
 * The three read-only tools of M18.1.
 *
 * Every one of them answers from the snapshot file and nothing else. There is
 * no tool that writes, no tool that takes a path, no tool that takes a query,
 * and no tool that returns a row this server has not named field by field.
 *
 * Limits are applied here as well as in the snapshot, on purpose. The snapshot
 * is bounded because Vaultwork projects it that way; these caps hold even if a
 * future snapshot arrives larger, and they hold against a `limit` a model
 * supplies — which is clamped, never trusted.
 */

/** Hard ceilings. A request above one of these is lowered to it, not refused. */
export const MAX = { tasks: 40, projects: 20, habits: 20 } as const
const DEFAULT = { tasks: 20, projects: 10 } as const

/**
 * Clamps a model-supplied count into range.
 *
 * Written to take `unknown` rather than `number`: schema validation already
 * rejects the obvious nonsense, and this is the second wall, so it must not
 * assume the first one held.
 */
export function clamp(requested: unknown, fallback: number, max: number): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback
  const floored = Math.floor(requested)
  if (floored < 1) return 1
  return Math.min(floored, max)
}

/** The freshness every tool result carries. Stale data is labelled, never hidden. */
function freshness(fresh: FreshSnapshot) {
  return {
    generatedAt: fresh.generatedAt,
    ageSeconds: fresh.ageSeconds,
    stale: fresh.stale,
    ...(fresh.stale
      ? {
          note: 'This snapshot is older than 15 minutes. Vaultwork may not be running, so it may not reflect the current state.',
        }
      : {}),
  }
}

const ok = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
})

/**
 * Turns a snapshot failure into a tool result rather than an exception.
 *
 * The process stays alive whatever the file is doing: a missing snapshot is an
 * answerable question ("open Vaultwork once"), not a reason for Claude Desktop
 * to show a dead server.
 */
const problem = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text:
        error instanceof SnapshotError
          ? `${error.message} (problem: ${error.problem})`
          : 'The Vaultwork snapshot could not be read.',
    },
  ],
  isError: true,
})

type TaskBucket = keyof Snapshot['tasks']

const taskFilter = z
  .enum(['today', 'overdue', 'upcoming', 'active'])
  .describe('Which of Vaultwork’s own task views to read.')

/** Model-supplied limits are unbounded in the schema and clamped in code. */
const limitArg = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('Maximum rows to return. Clamped to a hard server-side maximum.')

export function registerTools(server: McpServer, path: string = snapshotPath()): void {
  server.registerTool(
    'vaultwork_get_today',
    {
      title: 'Vaultwork: today',
      description:
        'What is on the user’s Vaultwork day: tasks due today, overdue tasks, habit progress and focus time. Read-only.',
      inputSchema: {},
      // `readOnlyHint` is advisory, so it is not the boundary — the boundary is
      // that no write path exists. It is declared because a client that reads
      // annotations should be told the truth.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const fresh = await readSnapshot(path)
        const { today, tasks } = fresh.snapshot
        return ok({
          date: today.date,
          freshness: freshness(fresh),
          counts: { dueToday: today.dueTodayCount, overdue: today.overdueCount },
          tasksDueToday: tasks.today.slice(0, MAX.tasks),
          overdueTasks: tasks.overdue.slice(0, MAX.tasks),
          habits: { ...today.habits, items: today.habits.items.slice(0, MAX.habits) },
          focus: today.focus,
        })
      } catch (error) {
        return problem(error)
      }
    },
  )

  server.registerTool(
    'vaultwork_get_tasks',
    {
      title: 'Vaultwork: tasks',
      description:
        'Tasks from one of Vaultwork’s task views: today, overdue, upcoming or active. Read-only.',
      inputSchema: { filter: taskFilter.default('today'), limit: limitArg },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ filter, limit }) => {
      try {
        const fresh = await readSnapshot(path)
        const bucket: TaskBucket = filter
        const rows: SnapshotTask[] = fresh.snapshot.tasks[bucket]
        const count = clamp(limit, DEFAULT.tasks, MAX.tasks)
        return ok({
          filter,
          freshness: freshness(fresh),
          returned: Math.min(rows.length, count),
          availableInSnapshot: rows.length,
          tasks: rows.slice(0, count),
        })
      } catch (error) {
        return problem(error)
      }
    },
  )

  server.registerTool(
    'vaultwork_get_projects',
    {
      title: 'Vaultwork: projects',
      description: 'Projects with their task counts and progress. Read-only.',
      inputSchema: {
        limit: limitArg,
        includeArchived: z
          .boolean()
          .default(false)
          .describe('Include archived projects. Active projects only by default.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ limit, includeArchived }) => {
      try {
        const fresh = await readSnapshot(path)
        const all = fresh.snapshot.projects
        const rows = includeArchived ? all : all.filter((entry) => entry.status !== 'archived')
        const count = clamp(limit, DEFAULT.projects, MAX.projects)
        return ok({
          freshness: freshness(fresh),
          returned: Math.min(rows.length, count),
          availableInSnapshot: rows.length,
          projects: rows.slice(0, count),
        })
      } catch (error) {
        return problem(error)
      }
    },
  )
}

/** The exact tool surface, named once so a test can assert on it. */
export const TOOL_NAMES = [
  'vaultwork_get_today',
  'vaultwork_get_tasks',
  'vaultwork_get_projects',
] as const
