import { describe, expect, it } from 'vitest'
import type { Project, Task } from '@/types/entities'
import { projectInput, taskInput } from '../../../tests/factories'
import {
  DEFAULT_PROJECT_FILTER,
  EMPTY_PROJECT_STATS,
  computeProjectStats,
  filterProjects,
  isProjectFilterActive,
  matchesProjectSearch,
  progressPercent,
  sortProjects,
  statsByProject,
  summarise,
  type ProjectSummary,
} from './projectStats'

/**
 * The project rules, tested against plain arrays.
 *
 * Not one of these touches a database, which is the point: "what does 67 %
 * mean?" and "does this project match that search?" are decisions, and a
 * decision you can only test through IndexedDB is a decision nobody tests.
 */

const TODAY = '2026-09-03'
const YESTERDAY = '2026-09-02'
const TOMORROW = '2026-09-04'

let seq = 0

function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  return {
    ...taskInput(),
    id: `task-${seq}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    ...overrides,
  } as Task
}

function project(overrides: Partial<Project> = {}): Project {
  seq += 1
  return {
    ...projectInput(),
    id: `project-${seq}`,
    createdAt: seq,
    updatedAt: seq,
    deletedAt: null,
    ...overrides,
  } as Project
}

describe('progressPercent', () => {
  it('is zero for a project with no tasks, not NaN', () => {
    expect(progressPercent(0, 0)).toBe(0)
  })

  it('reads 100 only when nothing is left', () => {
    expect(progressPercent(3, 3)).toBe(100)
    expect(progressPercent(4, 3)).toBe(100)
  })

  it('never rounds up to 100 while work remains', () => {
    // 199/200 rounds to 100 with plain Math.round. A progress bar that says
    // "100%" beside an open task is telling a lie the user can see.
    expect(progressPercent(199, 200)).toBe(99)
  })

  it('never rounds down to 0 once something is done', () => {
    expect(progressPercent(1, 500)).toBe(1)
  })

  it('rounds ordinary values normally', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(2, 3)).toBe(67)
    expect(progressPercent(1, 2)).toBe(50)
  })
})

describe('computeProjectStats', () => {
  it('returns the empty stats for no tasks', () => {
    expect(computeProjectStats([], TODAY)).toEqual(EMPTY_PROJECT_STATS)
  })

  it('splits completed from remaining', () => {
    const stats = computeProjectStats(
      [task(), task({ status: 'done' }), task({ status: 'done' })],
      TODAY,
    )
    expect(stats).toMatchObject({ total: 3, completed: 2, remaining: 1, progress: 67 })
  })

  it('counts only open tasks as overdue', () => {
    const stats = computeProjectStats(
      [
        task({ dueDate: YESTERDAY }),
        task({ dueDate: YESTERDAY, status: 'done' }),
        task({ dueDate: TODAY }),
        task({ dueDate: TOMORROW }),
      ],
      TODAY,
    )
    // A task finished late is not still late.
    expect(stats.overdue).toBe(1)
    expect(stats.dueToday).toBe(1)
    expect(stats.scheduled).toBe(3)
  })

  it('reports the earliest open due date', () => {
    const stats = computeProjectStats(
      [task({ dueDate: TOMORROW }), task({ dueDate: YESTERDAY }), task({ dueDate: null })],
      TODAY,
    )
    expect(stats.nextDueDate).toBe(YESTERDAY)
  })

  it('has no next due date when nothing open is dated', () => {
    const stats = computeProjectStats([task({ dueDate: null })], TODAY)
    expect(stats.nextDueDate).toBeNull()
  })

  it('sums the estimate of what is left, not of what is done', () => {
    const stats = computeProjectStats(
      [task({ estimateMin: 30 }), task({ estimateMin: 60, status: 'done' }), task()],
      TODAY,
    )
    expect(stats.remainingEstimateMin).toBe(30)
  })
})

describe('statsByProject', () => {
  it('groups by projectId in one pass and ignores unfiled tasks', () => {
    const stats = statsByProject(
      [
        task({ projectId: 'p1' }),
        task({ projectId: 'p1', status: 'done' }),
        task({ projectId: 'p2', dueDate: YESTERDAY }),
        task({ projectId: null }),
      ],
      TODAY,
    )

    expect(stats.get('p1')).toMatchObject({ total: 2, completed: 1, progress: 50 })
    expect(stats.get('p2')).toMatchObject({ total: 1, overdue: 1 })
    expect(stats.has('p3')).toBe(false)
  })
})

describe('summarise', () => {
  it('gives a project with no tasks the empty stats rather than omitting it', () => {
    const empty = project({ name: 'Untouched' })
    const summaries = summarise([empty], [], TODAY)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.stats).toEqual(EMPTY_PROJECT_STATS)
  })
})

describe('search', () => {
  it('matches the name', () => {
    expect(matchesProjectSearch(project({ name: 'Portfolio Site' }), 'portfolio')).toBe(true)
  })

  it('matches the description', () => {
    const row = project({ name: 'Semester 5', description: 'Coursework and labs' })
    expect(matchesProjectSearch(row, 'labs')).toBe(true)
  })

  it('requires every term, across both fields', () => {
    const row = project({ name: 'Portfolio Site', description: 'Something for recruiters' })
    expect(matchesProjectSearch(row, 'port recruiters')).toBe(true)
    expect(matchesProjectSearch(row, 'port designers')).toBe(false)
  })

  it('matches everything on a blank query', () => {
    expect(matchesProjectSearch(project(), '   ')).toBe(true)
  })
})

describe('filtering', () => {
  const build = (): ProjectSummary[] => [
    {
      project: project({ name: 'Active empty', status: 'active', sortOrder: 1000 }),
      stats: computeProjectStats([], TODAY),
    },
    {
      project: project({ name: 'In flight', status: 'active', sortOrder: 2000 }),
      stats: computeProjectStats([task(), task({ status: 'done' })], TODAY),
    },
    {
      project: project({ name: 'Late', status: 'planning', sortOrder: 3000 }),
      stats: computeProjectStats([task({ dueDate: YESTERDAY })], TODAY),
    },
    {
      project: project({ name: 'Finished', status: 'completed', sortOrder: 4000 }),
      stats: computeProjectStats([task({ status: 'done' })], TODAY),
    },
    {
      project: project({ name: 'Old', status: 'archived', sortOrder: 5000 }),
      stats: computeProjectStats([task()], TODAY),
    },
  ]

  const names = (rows: ProjectSummary[]) => rows.map((row) => row.project.name)

  it('shows only the unarchived by default', () => {
    expect(names(filterProjects(build(), DEFAULT_PROJECT_FILTER))).toEqual([
      'Active empty',
      'In flight',
      'Late',
      'Finished',
    ])
  })

  it('shows the archive on its own', () => {
    const rows = filterProjects(build(), { ...DEFAULT_PROJECT_FILTER, state: 'archived' })
    expect(names(rows)).toEqual(['Old'])
  })

  it('shows both when asked', () => {
    expect(filterProjects(build(), { ...DEFAULT_PROJECT_FILTER, state: 'all' })).toHaveLength(5)
  })

  it('filters to projects with something overdue', () => {
    const rows = filterProjects(build(), {
      ...DEFAULT_PROJECT_FILTER,
      state: 'all',
      progress: 'overdue',
    })
    expect(names(rows)).toEqual(['Late'])
  })

  it('separates "in progress" from "all done" and "no tasks"', () => {
    const base = { ...DEFAULT_PROJECT_FILTER, state: 'all' as const }
    expect(names(filterProjects(build(), { ...base, progress: 'in_progress' }))).toEqual([
      'In flight',
      'Late',
      'Old',
    ])
    expect(names(filterProjects(build(), { ...base, progress: 'complete' }))).toEqual(['Finished'])
    expect(names(filterProjects(build(), { ...base, progress: 'empty' }))).toEqual([
      'Active empty',
    ])
  })

  it('filters by status', () => {
    const rows = filterProjects(build(), {
      ...DEFAULT_PROJECT_FILTER,
      state: 'all',
      status: 'planning',
    })
    expect(names(rows)).toEqual(['Late'])
  })

  it('composes state, status, progress and search', () => {
    const rows = filterProjects(build(), {
      state: 'active',
      status: 'active',
      progress: 'in_progress',
      search: 'flight',
    })
    expect(names(rows)).toEqual(['In flight'])
  })

  it('knows when a filter is doing something — state alone is not "active"', () => {
    expect(isProjectFilterActive(DEFAULT_PROJECT_FILTER)).toBe(false)
    expect(isProjectFilterActive({ ...DEFAULT_PROJECT_FILTER, state: 'archived' })).toBe(false)
    expect(isProjectFilterActive({ ...DEFAULT_PROJECT_FILTER, search: 'x' })).toBe(true)
    expect(isProjectFilterActive({ ...DEFAULT_PROJECT_FILTER, progress: 'overdue' })).toBe(true)
  })
})

describe('sorting', () => {
  const rows = (): ProjectSummary[] => [
    {
      project: project({ name: 'Beta', sortOrder: 3000, updatedAt: 10 }),
      stats: computeProjectStats([task(), task({ status: 'done' })], TODAY),
    },
    {
      project: project({ name: 'Alpha', sortOrder: 1000, updatedAt: 30 }),
      stats: computeProjectStats([task({ dueDate: YESTERDAY }), task(), task()], TODAY),
    },
    {
      project: project({ name: 'Gamma', sortOrder: 2000, updatedAt: 20 }),
      stats: computeProjectStats([task({ status: 'done' })], TODAY),
    },
  ]

  const names = (list: ProjectSummary[]) => list.map((row) => row.project.name)

  it('sorts by manual order by default', () => {
    expect(names(sortProjects(rows(), 'manual'))).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('sorts by name', () => {
    expect(names(sortProjects(rows(), 'name'))).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts by progress, most complete first', () => {
    expect(names(sortProjects(rows(), 'progress'))).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('sorts by remaining, most outstanding first', () => {
    expect(names(sortProjects(rows(), 'remaining'))).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts by overdue, then falls back to manual order', () => {
    expect(names(sortProjects(rows(), 'overdue'))).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('sorts by most recently updated', () => {
    expect(names(sortProjects(rows(), 'updated'))).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('sorts a copy, so a shared live-query array is not reordered underneath', () => {
    const input = rows()
    const before = names(input)
    sortProjects(input, 'name')
    expect(names(input)).toEqual(before)
  })
})
