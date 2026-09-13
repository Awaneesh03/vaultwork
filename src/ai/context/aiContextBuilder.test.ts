import { describe, expect, it } from 'vitest'
import type { Id, Task } from '@/types/entities'
import { buildAiContext, clip, sectionsFor, serializeAiContext } from './aiContextBuilder'
import { AI_CONTEXT_LIMITS } from './aiContextLimits'
import { AI_CONTEXT_PURPOSES, type AiSourceData } from './aiContextTypes'

/**
 * What a model is allowed to see.
 *
 * These tests treat the builder as a security boundary rather than a formatter.
 * The questions are "can a note body get out?", "can a filesystem path get
 * out?", "is this bounded?" and "is it the same every time?" — a convenience
 * formatter would fail none of them loudly, which is precisely why they are
 * written down.
 *
 * Everything runs against a plain snapshot object: no database, no IndexedDB
 * shim, no clock to freeze. That is the payoff of the read-model inversion —
 * the layer that decides what leaves the machine can be tested without one.
 */

const NOW = 1_757_000_000_000
const TODAY = '2026-09-05'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    title: 'Revise Java collections',
    description: null,
    status: 'todo',
    priority: 'high',
    dueDate: '2026-09-06',
    dueTime: '19:00',
    startDate: null,
    estimateMin: 45,
    projectId: 'project-1' as Id,
    milestoneId: null,
    tagIds: ['tag-1' as Id],
    recurrence: null,
    seriesId: null,
    isTemplate: false,
    sortOrder: 1000,
    completedAt: null,
    reminderAt: null,
    vaultPath: 'Vaultwork/Tasks/revise-java.md',
    ...overrides,
  }
}

function source(overrides: Partial<AiSourceData> = {}): AiSourceData {
  const tasks = overrides.rankedOpenTasks ?? [task()]
  return {
    today: TODAY,
    now: NOW,
    rankedOpenTasks: tasks,
    projects: [
      {
        name: 'DSA Mastery',
        status: 'active',
        deadline: '2026-12-01',
        openTasks: 3,
        totalTasks: 9,
      },
    ],
    goals: [
      { title: 'Become strong in DSA', targetDate: '2026-12-31', percent: 20, health: 'on-track' },
    ],
    habits: [{ name: 'Study', completedToday: false }],
    documents: [],
    notes: [{ title: 'Binary trees', updatedAt: NOW }],
    counts: { openTasks: 9, dueToday: 2, overdue: 1 },
    totals: { tasks: tasks.length, projects: 1, goals: 1, habits: 1, notes: 1, documents: 0 },
    projectNames: new Map([['project-1' as Id, 'DSA Mastery']]),
    tagNames: new Map([['tag-1' as Id, 'java']]),
    ...overrides,
  }
}

describe('context profiles', () => {
  it('gives a general request the date and the counts, and nothing else', () => {
    const context = buildAiContext(source(), 'general')

    expect(context.today).toBe(TODAY)
    expect(context.counts).toEqual({ openTasks: 9, dueToday: 2, overdue: 1 })
    expect(context.tasks).toEqual([])
    expect(context.projects).toEqual([])
    expect(context.goals).toEqual([])
    expect(context.habits).toEqual([])
    expect(context.notes).toEqual([])
  })

  it('gives a task request its tasks and projects — but no goals, habits or notes', () => {
    // Information minimisation, stated as a test. Adding a task is not a reason
    // to send someone's goals to a third party.
    const context = buildAiContext(source(), 'tasks')

    expect(context.tasks).toHaveLength(1)
    expect(context.projects).toHaveLength(1)
    expect(context.goals).toEqual([])
    expect(context.habits).toEqual([])
    expect(context.notes).toEqual([])
  })

  it('gives a planning request the widest profile', () => {
    const context = buildAiContext(source(), 'planning')

    expect(context.tasks).toHaveLength(1)
    expect(context.projects).toHaveLength(1)
    expect(context.goals).toHaveLength(1)
    expect(context.habits).toHaveLength(1)
    expect(context.notes).toHaveLength(1)
  })

  it('always returns every section, empty rather than absent', () => {
    // A stable shape means two contexts can be diffed, and a missing section is
    // never mistaken for an empty one.
    for (const purpose of AI_CONTEXT_PURPOSES) {
      const context = buildAiContext(source(), purpose)
      expect(Object.keys(context).sort()).toEqual([
        'counts',
        'documents',
        'goals',
        'habits',
        'notes',
        'now',
        'projects',
        'purpose',
        'tasks',
        'today',
        'truncated',
      ])
    }
  })

  it('names a fixed section set per purpose', () => {
    expect([...sectionsFor('general')]).toEqual([])
    expect([...sectionsFor('tasks')].sort()).toEqual(['projects', 'tasks'])
    expect([...sectionsFor('planning')].sort()).toEqual([
      'goals',
      'habits',
      'notes',
      'projects',
      'tasks',
    ])
  })
})

describe('redaction', () => {
  it('never carries a task’s vault path', () => {
    // `Task.vaultPath` is a filesystem location. It reaches this layer because
    // it is on the entity, and it must not reach a provider.
    const context = buildAiContext(source(), 'planning')

    expect(serializeAiContext(context)).not.toContain('Vaultwork/Tasks')
    expect(serializeAiContext(context)).not.toContain('vaultPath')
  })

  it('never carries a row id, of any kind', () => {
    // A model that is never shown an id cannot echo one back — which is what
    // makes M15.2's "the model knows no real ids" rule true by construction.
    const context = buildAiContext(source(), 'planning')
    const json = serializeAiContext(context)

    for (const id of ['task-1', 'project-1', 'tag-1']) {
      expect(json).not.toContain(id)
    }
    expect(context.tasks[0]).not.toHaveProperty('id')
    expect(context.projects[0]).not.toHaveProperty('id')
    expect(context.goals[0]).not.toHaveProperty('id')
  })

  it('projects a task onto named fields rather than spreading the row', () => {
    // The guarantee behind the two tests above: whatever else `Task` grows, the
    // projection carries exactly these keys until someone edits it.
    const context = buildAiContext(source(), 'tasks')

    expect(Object.keys(context.tasks[0] ?? {}).sort()).toEqual([
      'dueDate',
      'dueTime',
      'estimateMin',
      'priority',
      'project',
      'status',
      'tags',
      'title',
    ])
  })

  it('carries no internal bookkeeping', () => {
    const json = serializeAiContext(buildAiContext(source(), 'planning'))

    for (const field of [
      'sortOrder',
      'seriesId',
      'isTemplate',
      'reminderAt',
      'milestoneId',
      'deletedAt',
      'createdAt',
    ]) {
      expect(json, `${field} is internal`).not.toContain(field)
    }
  })

  it('cannot carry a secret, because there is no field one could arrive in', () => {
    /*
     * The structural argument. A token or a key would have to reach this layer
     * through `AiSourceData`, and that interface has no field for one — so a
     * snapshot carrying extra properties still produces a clean context,
     * because every value is copied out by name.
     */
    const contaminated = {
      ...source(),
      groqApiKey: 'sk-should-never-appear',
      telegramBotToken: '123456:should-never-appear',
      keychain: { entry: 'should-never-appear' },
      vaultHandle: { path: '/Users/someone/Vault' },
    } as AiSourceData

    const json = serializeAiContext(buildAiContext(contaminated, 'planning'))

    for (const secret of [
      'sk-should-never-appear',
      'should-never-appear',
      'groqApiKey',
      'telegramBotToken',
      'keychain',
      'vaultHandle',
      '/Users/someone',
    ]) {
      expect(json, `${secret} must not reach a provider`).not.toContain(secret)
    }
  })
})

describe('the note policy', () => {
  it('sends note titles and timestamps only — never a body or an excerpt', () => {
    const context = buildAiContext(source(), 'planning')

    expect(Object.keys(context.notes[0] ?? {}).sort()).toEqual(['title', 'updatedAt'])
    expect(context.notes[0]).not.toHaveProperty('body')
    expect(context.notes[0]).not.toHaveProperty('excerpt')
  })

  it('has no field a body could be placed in, even if a snapshot offered one', () => {
    // `RecentNote` carries an `excerpt` of the body. It reaches the read model
    // and stops there: the projection copies two fields by name.
    const withBodies = source({
      notes: [
        {
          title: 'Binary trees',
          updatedAt: NOW,
          // Extra fields a future snapshot might carry.
          ...({ excerpt: 'PRIVATE-NOTE-CONTENT', body: 'PRIVATE-NOTE-CONTENT' } as object),
        },
      ],
    })

    expect(serializeAiContext(buildAiContext(withBodies, 'planning'))).not.toContain(
      'PRIVATE-NOTE-CONTENT',
    )
  })

  it('sends no notes at all for a task request', () => {
    expect(buildAiContext(source(), 'tasks').notes).toEqual([])
  })
})

describe('bounds', () => {
  const manyTasks = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      task({ id: `task-${i}` as Id, title: `Task ${String(i).padStart(3, '0')}` }),
    )

  it('caps every collection at its documented limit', () => {
    const big = source({
      rankedOpenTasks: manyTasks(500),
      projects: Array.from({ length: 100 }, (_, i) => ({
        name: `Project ${i}`,
        status: 'active',
        deadline: null,
        openTasks: 1,
        totalTasks: 2,
      })),
      goals: Array.from({ length: 50 }, (_, i) => ({
        title: `Goal ${i}`,
        targetDate: null,
        percent: 0,
        health: 'on-track',
      })),
      habits: Array.from({ length: 50 }, (_, i) => ({ name: `Habit ${i}`, completedToday: false })),
      notes: Array.from({ length: 50 }, (_, i) => ({ title: `Note ${i}`, updatedAt: NOW })),
      totals: { tasks: 500, projects: 100, goals: 50, habits: 50, notes: 50, documents: 0 },
    })

    const context = buildAiContext(big, 'planning')

    expect(context.tasks.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.tasks)
    expect(context.projects.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.projects)
    expect(context.goals.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.goals)
    expect(context.habits.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.habits)
    expect(context.notes.length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.notes)
  })

  it('keeps the front of the ranked list, never a sample', () => {
    const context = buildAiContext(
      source({
        rankedOpenTasks: manyTasks(100),
        totals: { tasks: 100, projects: 1, goals: 1, habits: 1, notes: 1, documents: 0 },
      }),
      'tasks',
    )

    expect(context.tasks[0]?.title).toBe('Task 000')
    expect(context.tasks.at(-1)?.title).toBe(
      `Task ${String(AI_CONTEXT_LIMITS.tasks - 1).padStart(3, '0')}`,
    )
  })

  it('says out loud when a section was cut', () => {
    const context = buildAiContext(
      source({
        rankedOpenTasks: manyTasks(100),
        totals: { tasks: 100, projects: 1, goals: 1, habits: 1, notes: 1, documents: 0 },
      }),
      'tasks',
    )

    expect(context.truncated).toContainEqual({
      section: 'tasks',
      kept: AI_CONTEXT_LIMITS.tasks,
      total: 100,
    })
  })

  it('reports nothing as truncated when nothing was', () => {
    expect(buildAiContext(source(), 'planning').truncated).toEqual([])
  })

  it('caps the tags on any one task', () => {
    const tagNames = new Map(
      Array.from({ length: 40 }, (_, i) => [`tag-${i}` as Id, `tag${i}`] as const),
    )
    const context = buildAiContext(
      source({
        rankedOpenTasks: [task({ tagIds: [...tagNames.keys()] })],
        tagNames,
      }),
      'tasks',
    )

    expect(context.tasks[0]?.tags.length).toBe(AI_CONTEXT_LIMITS.tagsPerTask)
  })

  it('respects the total character budget, dropping whole sections', () => {
    const long = 'x'.repeat(AI_CONTEXT_LIMITS.text)
    const heavy = source({
      rankedOpenTasks: Array.from({ length: 200 }, (_, i) =>
        task({ id: `task-${i}` as Id, title: `${long}${i}` }),
      ),
      projects: Array.from({ length: 100 }, () => ({
        name: long,
        status: 'active',
        deadline: null,
        openTasks: 1,
        totalTasks: 2,
      })),
      goals: Array.from({ length: 50 }, () => ({
        title: long,
        targetDate: null,
        percent: 0,
        health: 'on-track',
      })),
      habits: Array.from({ length: 50 }, () => ({ name: long, completedToday: false })),
      notes: Array.from({ length: 50 }, () => ({ title: long, updatedAt: NOW })),
      totals: { tasks: 200, projects: 100, goals: 50, habits: 50, notes: 50, documents: 0 },
    })

    const context = buildAiContext(heavy, 'planning')

    expect(serializeAiContext(context).length).toBeLessThanOrEqual(AI_CONTEXT_LIMITS.totalChars)
    // Notes go first, and tasks are never given up.
    expect(context.notes).toEqual([])
    expect(context.tasks.length).toBeGreaterThan(0)
    expect(context.truncated.some((entry) => entry.section === 'notes')).toBe(true)
  })
})

describe('text truncation', () => {
  it('clips deterministically, and marks the cut', () => {
    const long = 'a'.repeat(AI_CONTEXT_LIMITS.text + 50)
    const clipped = clip(long)

    expect(clipped).toHaveLength(AI_CONTEXT_LIMITS.text)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clip(long)).toBe(clipped)
  })

  it('leaves a short title exactly as written', () => {
    expect(clip('Revise Java collections')).toBe('Revise Java collections')
  })

  it('clips a task title inside the context', () => {
    const context = buildAiContext(
      source({ rankedOpenTasks: [task({ title: 'b'.repeat(1000) })] }),
      'tasks',
    )

    expect(context.tasks[0]?.title.length).toBe(AI_CONTEXT_LIMITS.text)
  })
})

describe('determinism', () => {
  it('produces byte-identical output for identical input', () => {
    const a = serializeAiContext(buildAiContext(source(), 'planning'))
    const b = serializeAiContext(buildAiContext(source(), 'planning'))

    expect(a).toBe(b)
  })

  it('preserves the ranking it was given rather than reordering', () => {
    // The AI layer has no ranking of its own. `rankForNextAction` decides, and
    // this only decides how much of that order survives.
    const ordered = [
      task({ id: 'a' as Id, title: 'first' }),
      task({ id: 'b' as Id, title: 'second' }),
      task({ id: 'c' as Id, title: 'third' }),
    ]
    const context = buildAiContext(source({ rankedOpenTasks: ordered }), 'tasks')

    expect(context.tasks.map((row) => row.title)).toEqual(['first', 'second', 'third'])
  })

  it('serializes its keys in a stable order', () => {
    const json = serializeAiContext(buildAiContext(source(), 'planning'))
    expect(json.indexOf('"today"')).toBeLessThan(json.indexOf('"counts"'))
    expect(json.indexOf('"counts"')).toBeLessThan(json.indexOf('"tasks"'))
    expect(json.indexOf('"tasks"')).toBeLessThan(json.indexOf('"truncated"'))
  })

  it('mutates nothing it was handed', () => {
    // Building context is a read. If it edited the snapshot, a second build
    // would differ from the first and the application would drift.
    const snapshot = source({ rankedOpenTasks: [task(), task({ id: 'task-2' as Id })] })
    const before = JSON.stringify(snapshot.rankedOpenTasks)

    buildAiContext(snapshot, 'planning')
    buildAiContext(snapshot, 'tasks')

    expect(JSON.stringify(snapshot.rankedOpenTasks)).toBe(before)
    expect(snapshot.rankedOpenTasks).toHaveLength(2)
    expect(snapshot.notes).toHaveLength(1)
  })
})

describe('an empty application', () => {
  it('produces a valid, minimal context rather than failing', () => {
    const empty = source({
      rankedOpenTasks: [],
      projects: [],
      goals: [],
      habits: [],
      notes: [],
      counts: { openTasks: 0, dueToday: 0, overdue: 0 },
      totals: { tasks: 0, projects: 0, goals: 0, habits: 0, notes: 0, documents: 0 },
      projectNames: new Map(),
      tagNames: new Map(),
    })

    const context = buildAiContext(empty, 'planning')

    expect(context.tasks).toEqual([])
    expect(context.truncated).toEqual([])
    expect(context.today).toBe(TODAY)
    expect(() => JSON.parse(serializeAiContext(context))).not.toThrow()
  })

  it('handles a task whose project and tags no longer resolve', () => {
    const orphan = source({
      rankedOpenTasks: [task({ projectId: 'gone' as Id, tagIds: ['missing' as Id] })],
      projectNames: new Map(),
      tagNames: new Map(),
    })

    const context = buildAiContext(orphan, 'tasks')
    expect(context.tasks[0]?.project).toBeNull()
    expect(context.tasks[0]?.tags).toEqual([])
  })
})

describe('serialization', () => {
  it('is plain JSON: no functions, classes, maps or circular references', () => {
    const context = buildAiContext(source(), 'planning')
    const round = JSON.parse(serializeAiContext(context)) as unknown

    expect(round).toEqual(context)
    expect(serializeAiContext(context)).not.toContain('[object')
  })
})
