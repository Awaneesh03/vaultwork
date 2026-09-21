import { readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Reading the snapshot Vaultwork publishes.
 *
 * This module is the entire data access of the MCP server. There is no database
 * driver here, no HTTP client and no IPC: one file is read, parsed and
 * validated, and everything the tools answer comes from what survives that.
 *
 * The path is computed, never received. No tool takes a path argument and no
 * tool result discloses one, so a model talking to this server cannot aim it at
 * another file — the worst it can do is ask for the same snapshot again.
 */

/** Matches `identifier` in `src-tauri/tauri.conf.json`. */
const APP_IDENTIFIER = 'app.vaultwork.desktop'
const FILE = 'mcp-snapshot.json'

/** The version this server understands. A different one is refused, not guessed at. */
export const SUPPORTED_SCHEMA_VERSION = 1

/**
 * After this, a snapshot is reported as stale.
 *
 * Fifteen minutes is longer than the write debounce by orders of magnitude, so
 * a running Vaultwork is never called stale, and short enough that a snapshot
 * from a closed application is flagged before anyone acts on it.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000

/**
 * Where Tauri's `app_config_dir` puts the file, per platform.
 *
 * Kept in step with the Rust side by construction: the identifier is the one in
 * `tauri.conf.json`, and the filename is the constant in `src-tauri/src/mcp.rs`.
 * `VAULTWORK_MCP_SNAPSHOT` overrides it for development and for the tests —
 * an environment variable is set by the person running the server, never by a
 * model talking to it.
 */
export function snapshotPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['VAULTWORK_MCP_SNAPSHOT']
  if (override !== undefined && override.length > 0) return override

  const home = homedir()
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', APP_IDENTIFIER, FILE)
    case 'win32':
      return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), APP_IDENTIFIER, FILE)
    default:
      return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), APP_IDENTIFIER, FILE)
  }
}

/**
 * The shape this server will accept.
 *
 * Unknown keys are stripped rather than passed through, which is the quiet
 * half of the security model: if a future snapshot ever carried a field it
 * should not, this schema drops it before a tool can return it. What Claude
 * sees is what is named here, and nothing else.
 */
const task = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  estimateMin: z.number().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  tags: z.array(z.string()),
})

const project = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  deadline: z.string().nullable(),
  total: z.number(),
  completed: z.number(),
  remaining: z.number(),
  overdue: z.number(),
  dueToday: z.number(),
  progress: z.number(),
  nextDueDate: z.string().nullable(),
})

export const snapshotSchema = z.object({
  schemaVersion: z.number(),
  generatedAt: z.string(),
  today: z.object({
    date: z.string(),
    dueTodayCount: z.number(),
    overdueCount: z.number(),
    habits: z.object({
      scheduled: z.number(),
      completed: z.number(),
      remaining: z.number(),
      percent: z.number(),
      items: z.array(z.object({ name: z.string(), completed: z.boolean() })),
    }),
    focus: z.object({
      active: z
        .object({ kind: z.string(), startedAt: z.string(), plannedMin: z.number() })
        .nullable(),
      completedToday: z.number(),
      minutesToday: z.number(),
    }),
  }),
  tasks: z.object({
    today: z.array(task),
    overdue: z.array(task),
    upcoming: z.array(task),
    active: z.array(task),
  }),
  projects: z.array(project),
})

export type Snapshot = z.infer<typeof snapshotSchema>
export type SnapshotTask = z.infer<typeof task>

/** Why a snapshot could not be used. One of these, never a stack trace. */
export type SnapshotProblem = 'missing' | 'unreadable' | 'malformed' | 'unsupported-version'

export class SnapshotError extends Error {
  /**
   * Written as a plain field rather than a constructor parameter property:
   * this file is executed by Node directly, and type stripping supports no
   * syntax that has to *emit* code. Keeping the server runnable without a
   * build step is worth one explicit assignment.
   */
  readonly problem: SnapshotProblem

  constructor(problem: SnapshotProblem, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.problem = problem
  }
}

export interface FreshSnapshot {
  snapshot: Snapshot
  generatedAt: string
  ageSeconds: number
  stale: boolean
}

/**
 * Reads, parses, validates and dates the snapshot.
 *
 * Every failure is a `SnapshotError` with a sentence a person can act on —
 * "open Vaultwork once" is a fix, "ENOENT" is not. Nothing here throws an
 * unclassified error, because an MCP server that dies on a bad file is an
 * integration that looks broken when the data is merely absent.
 */
export async function readSnapshot(
  path: string = snapshotPath(),
  now: number = Date.now(),
): Promise<FreshSnapshot> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new SnapshotError(
        'missing',
        'No Vaultwork snapshot exists yet. Open the Vaultwork desktop app once to create it.',
      )
    }
    throw new SnapshotError(
      'unreadable',
      'The Vaultwork snapshot exists but could not be read. Check that it is readable by this user.',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SnapshotError(
      'malformed',
      'The Vaultwork snapshot is not valid JSON. Reopen Vaultwork to rewrite it.',
    )
  }

  // The version is checked before the shape, so an upgrade reports "this server
  // is too old" rather than a list of fields that moved.
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new SnapshotError(
      'unsupported-version',
      `This snapshot is schema version ${String(version)}; this MCP server understands version ${SUPPORTED_SCHEMA_VERSION}. Update the Vaultwork MCP server.`,
    )
  }

  const result = snapshotSchema.safeParse(parsed)
  if (!result.success) {
    throw new SnapshotError(
      'malformed',
      'The Vaultwork snapshot does not match the expected schema. Reopen Vaultwork to rewrite it.',
    )
  }

  const generated = Date.parse(result.data.generatedAt)
  if (Number.isNaN(generated)) {
    throw new SnapshotError('malformed', 'The Vaultwork snapshot has no usable generatedAt.')
  }

  const ageSeconds = Math.max(0, Math.round((now - generated) / 1000))
  return {
    snapshot: result.data,
    generatedAt: result.data.generatedAt,
    ageSeconds,
    stale: now - generated > STALE_AFTER_MS,
  }
}
