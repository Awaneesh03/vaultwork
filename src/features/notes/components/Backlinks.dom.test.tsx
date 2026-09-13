import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { goalRepo, habitRepo, projectRepo, taskRepo } from '@/repositories'
import { createNote, deleteNote, getBacklinks, listNotes } from '@/services'
import { useNoteUiStore } from '@/store/noteUiStore'
import { useToastStore } from '@/store/toastStore'
import { projectInput, taskInput } from '../../../../tests/factories'
import { freezeClock, resetDatabase } from '../../../../tests/helpers'
import { GoalDetailPanel } from '@/features/goals/components/GoalDetailPanel'
import { TaskDetailPanel } from '@/features/tasks/components/TaskDetailPanel'
import { getGoalDetail } from '@/services'
import { NoteComposerHost } from './NoteComposerHost'

/**
 * Backlinks, on the entity screens.
 *
 * One component serves the task, project, goal and habit panels, so the tests
 * here prove the wiring in two of them and the shared behaviour once. The
 * important properties: a backlink appears without the entity storing anything
 * about notes, and creating from a panel arrives pre-linked.
 */

const NOW = new Date(2026, 8, 4, 10, 0, 0)

beforeEach(async () => {
  await resetDatabase()
  freezeClock(NOW)
  useNoteUiStore.getState().reset()
  useToastStore.setState({ toasts: [], undoStack: [] })
})

const wrap = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      {node}
      <NoteComposerHost />
    </MemoryRouter>,
  )

describe('on a task', () => {
  it('lists the notes that reference it', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Study Trees' }))
    await createNote({
      title: 'Traversal notes',
      body: 'inorder gives sorted output',
      links: [{ refType: 'task', refId: task.id }],
    })

    wrap(<TaskDetailPanel taskId={task.id} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Linked notes')).toBeTruthy())
    expect(await screen.findByRole('link', { name: /Traversal notes/ })).toBeTruthy()
  })

  it('says so plainly when nothing references it', async () => {
    const task = await taskRepo.create(taskInput())
    wrap(<TaskDetailPanel taskId={task.id} onClose={() => {}} />)

    // "None yet" and "still loading" must not look identical.
    expect(await screen.findByText('No notes reference this yet.')).toBeTruthy()
  })

  it('creates a note already linked to the task', async () => {
    const task = await taskRepo.create(taskInput({ title: 'Study Trees' }))
    wrap(<TaskDetailPanel taskId={task.id} onClose={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Note' }))

    const dialog = await screen.findByRole('dialog', { name: 'New note' })
    fireEvent.change(screen.getByLabelText('Note title'), {
      target: { value: 'From the panel' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(async () => {
      const backlinks = await getBacklinks('task', task.id)
      expect(backlinks.map((b) => b.title)).toEqual(['From the panel'])
    })
    expect(dialog).toBeTruthy()
  })

  it('drops the backlink when the note is deleted', async () => {
    const task = await taskRepo.create(taskInput())
    const note = await createNote({
      title: 'Doomed',
      links: [{ refType: 'task', refId: task.id }],
    })

    wrap(<TaskDetailPanel taskId={task.id} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('link', { name: /Doomed/ })).toBeTruthy())

    await deleteNote(note.id)
    await waitFor(() =>
      expect(screen.getByText('No notes reference this yet.')).toBeTruthy(),
    )
  })
})

describe('on a goal', () => {
  it('lists the notes that reference it', async () => {
    const goal = await goalRepo.create({
      title: 'Become strong in DSA',
      why: null,
      horizon: 'long',
      status: 'active',
      targetDate: null,
      sortOrder: 1000,
      vaultPath: null,
    })
    await createNote({
      title: 'Study plan',
      links: [{ refType: 'goal', refId: goal.id }],
    })

    const detail = await getGoalDetail(goal.id)
    wrap(
      <GoalDetailPanel
        detail={detail!}
        onClose={() => {}}
        onComplete={() => {}}
        onEdit={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onAddMilestone={() => {}}
        onToggleMilestone={() => {}}
        onEditMilestone={() => {}}
        onDeleteMilestone={() => {}}
        onMoveMilestone={() => {}}
      />,
    )

    expect(await screen.findByRole('link', { name: /Study plan/ })).toBeTruthy()
  })
})

describe('what a backlink costs the entity', () => {
  it('stores nothing about notes on the task, project, goal or habit', async () => {
    const task = await taskRepo.create(taskInput())
    const project = await projectRepo.create(projectInput())
    const goal = await goalRepo.create({
      title: 'g',
      why: null,
      horizon: 'long',
      status: 'active',
      targetDate: null,
      sortOrder: 1000,
      vaultPath: null,
    })
    const habit = await habitRepo.create({
      name: 'h',
      color: 'teal',
      cadence: 'daily',
      daysOfWeek: [],
      targetPerWeek: null,
      kind: 'binary',
      unit: null,
      target: null,
      sortOrder: 1000,
      archivedAt: null,
    })

    await createNote({
      title: 'about everything',
      links: [
        { refType: 'task', refId: task.id },
        { refType: 'project', refId: project.id },
        { refType: 'goal', refId: goal.id },
        { refType: 'habit', refId: habit.id },
      ],
    })

    // The relationship lives in one join table; the entities are untouched, so
    // there is nothing on them that could fall out of step.
    for (const [store, id] of [
      ['tasks', task.id],
      ['projects', project.id],
      ['goals', goal.id],
      ['habits', habit.id],
    ] as const) {
      const row = await db.table(store).get(id)
      expect(JSON.stringify(row)).not.toContain('about everything')
      expect(JSON.stringify(row)).not.toContain('note')
    }

    expect(await db.noteLinks.count()).toBe(4)
    expect(await listNotes()).toHaveLength(1)
  })
})
