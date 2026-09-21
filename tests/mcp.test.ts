import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildMcpSnapshot, MCP_SNAPSHOT_SCHEMA_VERSION } from '@/services'
import { completeTask, createTask } from '@/services/taskService'
import { createProject } from '@/services/projectService'
import { getDashboard } from '@/services/dashboard/dashboardQueryService'
import { getTaskView } from '@/services/taskQueryService'
import { clamp, MAX, registerTools, TOOL_NAMES } from '../mcp/src/tools.ts'
import { readSnapshot, snapshotPath, SnapshotError, snapshotSchema } from '../mcp/src/snapshot.ts'
import { freezeClock, resetDatabase } from './helpers'
import { taskInput } from './factories'

/**
 * M18.1's boundary, checked rather than described.
 *
 * The claims worth machine-checking are the ones a reviewer would otherwise
 * take on trust: that the MCP surface is three read-only tools and cannot grow
 * a fourth by accident, that a model cannot widen a limit or aim the server at
 * another file, and that no credential can reach a tool result — because the
 * snapshot that feeds it has no field to carry one.
 */

const MCP_DIR = fileURLToPath(new URL('../mcp/src', import.meta.url))
const sourceOf = (file: string) => readFileSync(join(MCP_DIR, file), 'utf8')

/** A snapshot file on disk, so the server reads exactly what it will in life. */
async function snapshotFile(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vaultwork-mcp-'))
  const path = join(dir, 'mcp-snapshot.json')
  await writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8')
  return path
}

/** A client wired to the real server over an in-memory pair. */
async function connect(path: string) {
  const server = new McpServer({ name: 'vaultwork', version: 'test' })
  registerTools(server, path)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, close: () => Promise.all([client.close(), server.close()]) }
}

const textOf = (result: unknown): string => {
  const content = (result as { content: { type: string; text?: string }[] }).content
  return content.map((part) => part.text ?? '').join('')
}
const jsonOf = (result: unknown): Record<string, unknown> =>
  JSON.parse(textOf(result)) as Record<string, unknown>

/** A valid snapshot, with a generous number of rows so caps are observable. */
function validSnapshot(overrides: Record<string, unknown> = {}) {
  const task = (index: number) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    status: 'todo',
    priority: 'none',
    dueDate: '2026-09-20',
    dueTime: null,
    estimateMin: null,
    projectId: null,
    projectName: null,
    tags: [],
  })
  const project = (index: number) => ({
    id: `project-${index}`,
    name: `Project ${index}`,
    status: index === 0 ? 'archived' : 'active',
    deadline: null,
    total: 3,
    completed: 1,
    remaining: 2,
    overdue: 0,
    dueToday: 1,
    progress: 33,
    nextDueDate: null,
  })
  const many = (count: number) => Array.from({ length: count }, (_, index) => task(index))

  return {
    schemaVersion: MCP_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    today: {
      date: '2026-09-20',
      dueTodayCount: 100,
      overdueCount: 100,
      habits: {
        scheduled: 2,
        completed: 1,
        remaining: 1,
        percent: 50,
        items: Array.from({ length: 50 }, (_, index) => ({
          name: `Habit ${index}`,
          completed: false,
        })),
      },
      focus: { active: null, completedToday: 2, minutesToday: 50 },
    },
    tasks: { today: many(100), overdue: many(100), upcoming: many(100), active: many(100) },
    projects: Array.from({ length: 100 }, (_, index) => project(index)),
    ...overrides,
  }
}

describe('the MCP tool surface', () => {
  it('exposes exactly the three read-only tools of M18.1', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort())
    expect(tools).toHaveLength(3)
    await close()
  })

  it('declares every tool read-only, and offers no tool that mutates', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))
    const { tools } = await client.listTools()

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} must be read-only`).toBe(true)
      expect(tool.annotations?.destructiveHint).toBe(false)
      // The names are the surface a model sees; a write verb in one would be a
      // capability M18.1 does not have.
      expect(tool.name).not.toMatch(/create|add|update|delete|remove|set|write|complete|edit/i)
    }
    await close()
  })

  it('has no write path in its own source, to Vaultwork or to disk', () => {
    // The tools call `readSnapshot` and nothing else. A `writeFile` here would
    // mean the read-only server had grown a way to change something.
    for (const file of ['tools.ts', 'server.ts']) {
      const source = sourceOf(file)
      expect(source, `${file} must not write`).not.toMatch(/writeFile|appendFile|\bunlink\b|rmdir/)
      expect(source, `${file} must not reach a database`).not.toMatch(/dexie|indexeddb|sqlite/i)
    }
  })

  it('opens no network listener and imports no network transport', () => {
    for (const file of ['tools.ts', 'server.ts', 'snapshot.ts']) {
      const source = sourceOf(file)
      for (const banned of [
        'node:http',
        'node:https',
        'node:net',
        'createServer',
        '.listen(',
        'StreamableHTTP',
        'SSEServerTransport',
        'WebSocket',
        'fetch(',
      ]) {
        expect(source, `${file} must not contain ${banned}`).not.toContain(banned)
      }
    }
    // Only the stdio transport is ever constructed.
    expect(sourceOf('server.ts')).toContain('StdioServerTransport')
  })

  it('takes no path from the caller: the snapshot location is computed', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))
    const { tools } = await client.listTools()

    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>
      for (const name of Object.keys(properties)) {
        expect(name, `${tool.name} must not accept ${name}`).not.toMatch(/path|file|dir|url/i)
      }
    }

    // And the resolved path is the application's own, not something passed in.
    expect(snapshotPath({} as NodeJS.ProcessEnv)).toMatch(/app\.vaultwork\.desktop/)
    expect(snapshotPath({} as NodeJS.ProcessEnv)).toMatch(/mcp-snapshot\.json$/)
    await close()
  })
})

describe('the server as Claude Desktop launches it', () => {
  it('starts as a real stdio process and lists its three tools', async () => {
    // The in-memory tests above drive the same code, but only this one proves
    // the thing Claude Desktop actually does: spawn `node mcp/src/server.ts`,
    // speak MCP over stdin and stdout, and get an answer.
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const path = await snapshotFile(validSnapshot())
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../mcp/src/server.ts', import.meta.url))],
      env: { ...process.env, VAULTWORK_MCP_SNAPSHOT: path } as Record<string, string>,
    })
    const client = new Client({ name: 'test', version: '1.0.0' })

    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort())

      // And it answers from the snapshot the environment pointed it at, which
      // is the path resolution working end to end.
      const result = await client.callTool({ name: 'vaultwork_get_today', arguments: {} })
      expect(result.isError).toBeFalsy()
      expect(jsonOf(result)['date']).toBe('2026-09-20')
    } finally {
      await client.close()
    }
  }, 30_000)
})

describe('argument validation and bounds', () => {
  it('rejects arguments outside the declared schema', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))

    // An unknown filter, a fractional limit, a negative limit and a wrong type.
    for (const args of [
      { filter: 'everything' },
      { filter: 'today', limit: 2.5 },
      { filter: 'today', limit: -5 },
      { filter: 'today', limit: 'twenty' },
    ]) {
      const result = await client.callTool({ name: 'vaultwork_get_tasks', arguments: args })
      expect(result.isError, `${JSON.stringify(args)} must be refused`).toBe(true)
    }
    await close()
  })

  it('clamps a limit the model supplies instead of trusting it', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))

    const huge = await client.callTool({
      name: 'vaultwork_get_tasks',
      arguments: { filter: 'today', limit: 10_000 },
    })
    expect((jsonOf(huge)['tasks'] as unknown[]).length).toBe(MAX.tasks)

    const projects = await client.callTool({
      name: 'vaultwork_get_projects',
      arguments: { limit: 10_000, includeArchived: true },
    })
    expect((jsonOf(projects)['projects'] as unknown[]).length).toBe(MAX.projects)

    // The clamp itself, including the values a schema would have caught first.
    expect(clamp(10_000, 20, 40)).toBe(40)
    expect(clamp(0, 20, 40)).toBe(1)
    expect(clamp(Number.POSITIVE_INFINITY, 20, 40)).toBe(20)
    expect(clamp(undefined, 20, 40)).toBe(20)
    expect(clamp('40' as unknown, 20, 40)).toBe(20)
    await close()
  })

  it('bounds every tool result, whatever the snapshot holds', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))

    const today = jsonOf(await client.callTool({ name: 'vaultwork_get_today', arguments: {} }))
    expect((today['tasksDueToday'] as unknown[]).length).toBe(MAX.tasks)
    expect((today['overdueTasks'] as unknown[]).length).toBe(MAX.tasks)
    expect((today['habits'] as { items: unknown[] }).items.length).toBe(MAX.habits)

    // Even with no arguments at all, the default is a bounded page.
    const tasks = jsonOf(await client.callTool({ name: 'vaultwork_get_tasks', arguments: {} }))
    expect((tasks['tasks'] as unknown[]).length).toBeLessThanOrEqual(MAX.tasks)
    expect(tasks['availableInSnapshot']).toBe(100)
    await close()
  })

  it('hides archived projects unless they are asked for', async () => {
    const { client, close } = await connect(await snapshotFile(validSnapshot()))
    const result = jsonOf(await client.callTool({ name: 'vaultwork_get_projects', arguments: {} }))
    const statuses = (result['projects'] as { status: string }[]).map((row) => row.status)
    expect(statuses).not.toContain('archived')
    await close()
  })
})

describe('snapshot handling', () => {
  it('explains a missing snapshot instead of failing', async () => {
    const { client, close } = await connect(join(tmpdir(), 'vaultwork-does-not-exist.json'))
    const result = await client.callTool({ name: 'vaultwork_get_today', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/Open the Vaultwork desktop app once/)
    expect(textOf(result)).toContain('problem: missing')

    // The process is still answering afterwards: an absent file is not fatal.
    const second = await client.callTool({ name: 'vaultwork_get_tasks', arguments: {} })
    expect(second.isError).toBe(true)
    await close()
  })

  it('handles a malformed snapshot safely', async () => {
    const notJson = await connect(await snapshotFile('{"schemaVersion": 1, broken'))
    const first = await notJson.client.callTool({ name: 'vaultwork_get_today', arguments: {} })
    expect(first.isError).toBe(true)
    expect(textOf(first)).toContain('problem: malformed')
    await notJson.close()

    // Valid JSON of the wrong shape is refused by the schema, not half-read.
    const wrongShape = await connect(
      await snapshotFile({ schemaVersion: 1, generatedAt: 'now', tasks: 'all of them' }),
    )
    const second = await wrongShape.client.callTool({ name: 'vaultwork_get_tasks', arguments: {} })
    expect(second.isError).toBe(true)
    expect(textOf(second)).toContain('problem: malformed')
    await wrongShape.close()
  })

  it('refuses a schema version it does not understand', async () => {
    const path = await snapshotFile(validSnapshot({ schemaVersion: 99 }))
    const { client, close } = await connect(path)
    const result = await client.callTool({ name: 'vaultwork_get_today', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('problem: unsupported-version')
    expect(textOf(result)).toMatch(/version 99/)
    await close()
  })

  it('labels a stale snapshot rather than passing it off as live', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { client, close } = await connect(await snapshotFile(validSnapshot({ generatedAt: old })))

    const result = jsonOf(await client.callTool({ name: 'vaultwork_get_today', arguments: {} }))
    const freshness = result['freshness'] as Record<string, unknown>
    expect(freshness['stale']).toBe(true)
    expect(freshness['generatedAt']).toBe(old)
    expect(freshness['ageSeconds']).toBeGreaterThan(3000)
    expect(String(freshness['note'])).toMatch(/may not be running/)

    // A snapshot written moments ago is not labelled stale.
    const fresh = await connect(await snapshotFile(validSnapshot()))
    const now = jsonOf(await fresh.client.callTool({ name: 'vaultwork_get_today', arguments: {} }))
    expect((now['freshness'] as Record<string, unknown>)['stale']).toBe(false)
    await fresh.close()
    await close()
  })

  it('reads the last snapshot when Vaultwork is not running', async () => {
    // Nothing in the read path asks whether the application is alive: the file
    // is the whole interface, which is what makes this work at all.
    const path = await snapshotFile(validSnapshot())
    const fresh = await readSnapshot(path)
    expect(fresh.snapshot.tasks.today.length).toBe(100)
    expect(fresh.stale).toBe(false)
  })

  it('reports a snapshot with an unusable timestamp as malformed', async () => {
    const path = await snapshotFile(validSnapshot({ generatedAt: 'whenever' }))
    await expect(readSnapshot(path)).rejects.toBeInstanceOf(SnapshotError)
  })
})

describe('the snapshot Vaultwork actually writes', () => {
  beforeEach(async () => {
    await resetDatabase()
    freezeClock(new Date('2026-09-20T09:00:00+05:30'))
  })
  afterEach(async () => {
    await resetDatabase()
  })

  it('matches the schema the MCP server validates', async () => {
    const project = await createProject('DSA Mastery')
    await createTask(taskInput({ title: 'Study trees', dueDate: '2026-09-20' }))
    await createTask(taskInput({ title: 'Overdue thing', dueDate: '2026-09-01' }))
    await createTask(taskInput({ title: 'In a project', projectId: project.id }))

    const snapshot = await buildMcpSnapshot()

    // The drift guard: the writer and the reader are separate programs, and
    // this is the assertion that keeps them describing the same document.
    const parsed = snapshotSchema.safeParse(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true)
    expect(snapshot.schemaVersion).toBe(MCP_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.tasks.today.map((task) => task.title)).toContain('Study trees')
    expect(snapshot.tasks.overdue.map((task) => task.title)).toContain('Overdue thing')
    expect(snapshot.projects.map((row) => row.name)).toContain('DSA Mastery')
  })

  it('carries no credential, no secret and no filesystem path', async () => {
    await createTask(taskInput({ title: 'Study trees', vaultPath: 'Vaultwork/Tasks/study.md' }))
    await createProject('DSA Mastery')

    const snapshot = await buildMcpSnapshot()
    const serialised = JSON.stringify(snapshot)

    for (const forbidden of [
      'token',
      'apiKey',
      'api_key',
      'secret',
      'password',
      'credential',
      'telegram',
      'vaultPath',
      'groq',
      'Bearer',
    ]) {
      expect(serialised.toLowerCase(), `the snapshot must not mention ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      )
    }
    // Specifically: the vault paths those rows really do hold never travel.
    expect(serialised).not.toContain('Vaultwork/Tasks/study.md')
    expect(serialised).not.toContain('.md')
  })

  it('is bounded by the limits it declares, not by how much exists', async () => {
    for (let index = 0; index < 60; index += 1) {
      await createTask(taskInput({ title: `Task ${index}`, dueDate: '2026-09-20' }))
    }
    const snapshot = await buildMcpSnapshot()
    expect(snapshot.tasks.today.length).toBe(40)
    expect(snapshot.today.dueTodayCount).toBe(60)
  })

  it('survives a round trip through a file, as the real integration does', async () => {
    await createTask(taskInput({ title: 'Study trees', dueDate: '2026-09-20' }))
    const path = await snapshotFile(await buildMcpSnapshot())

    const { client, close } = await connect(path)
    const result = jsonOf(await client.callTool({ name: 'vaultwork_get_today', arguments: {} }))
    const titles = (result['tasksDueToday'] as { title: string }[]).map((task) => task.title)

    expect(titles).toContain('Study trees')
    expect(await readFile(path, 'utf8')).toContain('schemaVersion')
    await close()
  })
})

/**
 * M18.1 regression: the snapshot's overdue set is Vaultwork's overdue set.
 *
 * Written after a report of 30 overdue tasks on the Dashboard and 0 in the
 * snapshot. The cause turned out to be two different databases — a dev build
 * publishing while the packaged app held the real data — but the claim the
 * incident put in doubt is worth holding down permanently: whatever the
 * Dashboard calls overdue, the snapshot carries, task for task.
 *
 * Both sides are read through the application's own services. Nothing here
 * recomputes "overdue" from dates, because a second definition written in a
 * test is exactly the drift this asserts against.
 */
describe('the snapshot agrees with the Dashboard about overdue work', () => {
  beforeEach(async () => {
    await resetDatabase()
    // Late evening in India — 18:00 UTC on the *previous* day. A projection
    // that reached for a UTC date would call today 2026-09-19 and quietly move
    // the boundary; this is the shape of the timezone bug the report suspected.
    freezeClock(new Date('2026-09-20T23:30:00+05:30'))
  })
  afterEach(async () => {
    await resetDatabase()
  })

  it('carries every task the Dashboard counts as overdue', async () => {
    // The real fixture: incomplete, due the previous Wednesday.
    await createTask(taskInput({ title: 'Wed 16 Sep task', dueDate: '2026-09-16' }))
    await createTask(taskInput({ title: 'Also late', dueDate: '2026-09-01' }))
    await createTask(taskInput({ title: 'Due today', dueDate: '2026-09-20' }))
    await createTask(taskInput({ title: 'Due tomorrow', dueDate: '2026-09-21' }))
    await createTask(taskInput({ title: 'No due date' }))
    const finished = await createTask(
      taskInput({ title: 'Late but finished', dueDate: '2026-09-02' }),
    )
    await completeTask(finished.id)

    const [dashboard, view, snapshot] = await Promise.all([
      getDashboard(),
      getTaskView('overdue'),
      buildMcpSnapshot(),
    ])

    // The three agree on the count…
    expect(dashboard.summary.overdue).toBe(2)
    expect(view.tasks).toHaveLength(2)
    expect(snapshot.tasks.overdue).toHaveLength(dashboard.summary.overdue)

    // The counts the snapshot publishes are the Dashboard's counts. This is
    // the assertion that failed in the field: `dueTodayCount` was reporting the
    // Today *view* (overdue folded in), so thirty late tasks were announced as
    // thirty due today while the Dashboard showed none.
    expect(snapshot.today.overdueCount).toBe(dashboard.summary.overdue)
    expect(snapshot.today.dueTodayCount).toBe(dashboard.summary.dueToday)
    expect(snapshot.today.dueTodayCount).toBe(1)
    expect(snapshot.tasks.today.map((task) => task.title)).toEqual(['Due today'])

    // …and on which tasks, not merely how many. A snapshot that reported the
    // right number with the wrong rows would pass a count check and mislead
    // anyone who read it.
    expect(snapshot.tasks.overdue.map((task) => task.id).sort()).toEqual(
      dashboard.overdue.map((task) => task.id).sort(),
    )
    expect(snapshot.tasks.overdue.map((task) => task.title).sort()).toEqual([
      'Also late',
      'Wed 16 Sep task',
    ])
  })

  it('keeps the other buckets honest, and the local date with them', async () => {
    await createTask(taskInput({ title: 'Wed 16 Sep task', dueDate: '2026-09-16' }))
    await createTask(taskInput({ title: 'Due today', dueDate: '2026-09-20' }))
    await createTask(taskInput({ title: 'Due tomorrow', dueDate: '2026-09-21' }))
    await createTask(taskInput({ title: 'No due date' }))
    const finished = await createTask(
      taskInput({ title: 'Late but finished', dueDate: '2026-09-02' }),
    )
    await completeTask(finished.id)

    const snapshot = await buildMcpSnapshot()
    const titles = (bucket: { title: string }[]) => bucket.map((task) => task.title).sort()

    // 23:30 in Kolkata is still the 20th, however UTC feels about it.
    expect(snapshot.today.date).toBe('2026-09-20')

    // Strictly today: the overdue row belongs to the overdue field, exactly as
    // the Dashboard keeps it on its own card.
    expect(titles(snapshot.tasks.today)).toEqual(['Due today'])
    expect(snapshot.today.dueTodayCount).toBe(1)
    expect(titles(snapshot.tasks.upcoming)).toEqual(['Due tomorrow'])
    expect(titles(snapshot.tasks.active)).toEqual([
      'Due today',
      'Due tomorrow',
      'No due date',
      'Wed 16 Sep task',
    ])

    // The three negatives the report asked to pin down.
    const overdueTitles = titles(snapshot.tasks.overdue)
    expect(overdueTitles, 'a completed task is not overdue').not.toContain('Late but finished')
    expect(overdueTitles, 'a future task is not overdue').not.toContain('Due tomorrow')
    expect(overdueTitles, 'an undated task is not overdue').not.toContain('No due date')
    expect(overdueTitles, "today's work is not overdue").not.toContain('Due today')
    expect(overdueTitles).toEqual(['Wed 16 Sep task'])
  })

  it('reports the same count through the MCP tool a client calls', async () => {
    for (let index = 0; index < 30; index += 1) {
      await createTask(taskInput({ title: `Late ${index}`, dueDate: '2026-09-16' }))
    }
    const dashboard = await getDashboard()
    const path = await snapshotFile(await buildMcpSnapshot())
    const { client, close } = await connect(path)

    const result = jsonOf(
      await client.callTool({
        name: 'vaultwork_get_tasks',
        arguments: { filter: 'overdue', limit: MAX.tasks },
      }),
    )

    expect(dashboard.summary.overdue).toBe(30)
    // 30 real rows travel, not a number copied from a counter.
    expect((result['tasks'] as unknown[]).length).toBe(30)
    expect(result['availableInSnapshot']).toBe(30)

    // And the reported day is the user's day: 30 late, none due today.
    const today = jsonOf(await client.callTool({ name: 'vaultwork_get_today', arguments: {} }))
    const counts = today['counts'] as Record<string, number>
    expect(counts['overdue']).toBe(30)
    expect(counts['dueToday']).toBe(0)
    expect((today['overdueTasks'] as unknown[]).length).toBe(30)
    expect((today['tasksDueToday'] as unknown[]).length).toBe(0)
    await close()
  })
})
