import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Project, Tag, Task } from '@/types/entities'
import { taskInput } from '../../../../tests/factories'
import { TaskRow } from './TaskRow'

/**
 * TaskRow is rendered once per task in every one of the six views, so its
 * behaviour is worth pinning: it is purely presentational, which is exactly
 * what makes it testable without a database.
 */

const TODAY = '2026-09-03'

function task(overrides: Partial<Task> = {}): Task {
  return {
    ...taskInput(),
    id: 'task-1',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  } as Task
}

const TAGS: Tag[] = [
  { id: 'tag-1', name: 'dsa', color: null, createdAt: 1, updatedAt: 1, deletedAt: null },
  { id: 'tag-2', name: 'java', color: null, createdAt: 1, updatedAt: 1, deletedAt: null },
]

const PROJECTS = [
  {
    id: 'project-1',
    name: 'DSA Mastery',
    description: null,
    color: 'teal',
    icon: 'binary',
    status: 'active',
    deadline: null,
    goalId: null,
    tagIds: [],
    sortOrder: 1000,
    vaultPath: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  } as Project,
]

const handlers = () => ({
  onToggle: vi.fn(),
  onOpen: vi.fn(),
  onDelete: vi.fn(),
})

function renderRow(row: Task, extra: Partial<Parameters<typeof TaskRow>[0]> = {}) {
  const calls = handlers()
  const result = render(
    <TaskRow task={row} tags={TAGS} projects={PROJECTS} today={TODAY} {...calls} {...extra} />,
  )
  return { ...result, ...calls }
}

describe('the checkbox', () => {
  it('reports its state to assistive technology', () => {
    renderRow(task({ title: 'Study Binary Trees' }))
    const checkbox = screen.getByRole('checkbox', { name: 'Complete Study Binary Trees' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('offers to reopen a completed task instead', () => {
    renderRow(task({ title: 'Study Binary Trees', status: 'done' }))
    const checkbox = screen.getByRole('checkbox', { name: 'Reopen Study Binary Trees' })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('calls back exactly once per click', () => {
    const { onToggle } = renderRow(task())
    screen.getByRole('checkbox').click()
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

describe('what the row shows', () => {
  it('renders the metadata a task carries', () => {
    renderRow(
      task({
        title: 'Study Binary Trees',
        dueDate: TODAY,
        dueTime: '19:00',
        estimateMin: 45,
        projectId: 'project-1',
        tagIds: ['tag-1'],
      }),
      { progress: { done: 1, total: 3 } },
    )

    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('7 pm')).toBeTruthy()
    expect(screen.getByText('45m')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
    expect(screen.getByText('DSA Mastery')).toBeTruthy()
    expect(screen.getByText('#dsa')).toBeTruthy()
  })

  it('shows no metadata line for a bare task', () => {
    renderRow(task({ title: 'Book dentist' }))
    expect(screen.queryByText('Today')).toBeNull()
    expect(screen.queryByText('#dsa')).toBeNull()
  })

  it('leaves out tags the task does not have', () => {
    renderRow(task({ tagIds: ['tag-1'] }))
    expect(screen.queryByText('#java')).toBeNull()
  })

  it('hides the due date where the view already states it', () => {
    renderRow(task({ dueDate: TODAY }), { hideDueDate: true })
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('names the priority for a screen reader, since the dot is decorative', () => {
    renderRow(task({ priority: 'urgent' }))
    expect(screen.getByText('Urgent')).toBeTruthy()
  })

  it('says "No priority" rather than drawing a meaningless mark', () => {
    const { container } = renderRow(task({ priority: 'none' }))
    expect(screen.getByText('No priority')).toBeTruthy()
    expect(container.querySelectorAll('[title$="priority"]')).toHaveLength(0)
  })
})

describe('the actions', () => {
  it('opens the editor from the title and the pencil alike', () => {
    const { onOpen } = renderRow(task({ title: 'Study' }))
    screen.getByRole('button', { name: 'Study' }).click()
    screen.getByRole('button', { name: 'Edit Study' }).click()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('deletes without asking, because the delete is undoable', () => {
    const { onDelete } = renderRow(task({ title: 'Study' }))
    screen.getByRole('button', { name: 'Delete Study' }).click()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
