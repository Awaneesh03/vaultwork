import { describe, expect, it } from 'vitest'
import type { Project } from '@/types/entities'
import {
  classifyCapture,
  proposalToIntent,
  validateInboxProposal,
  type InboxProposal,
} from './inboxProposal'

/**
 * The inbox's pure decisions: what a capture looks like, what a proposal may
 * say, and which existing command it becomes. Monday 21 September 2026, local
 * time, so "Friday" and "tomorrow" have one right answer.
 */

const NOW = new Date(2026, 8, 21, 10, 0, 0)

const project = (id: string, name: string): Project =>
  ({ id, name, status: 'active', deletedAt: null }) as Project

const PROJECTS = [
  project('p-vw', 'Vaultwork'),
  project('p-c5', 'College Semester 5'),
  project('p-c6', 'College Semester 6'),
]

const classify = (text: string, projects: Project[] = PROJECTS) =>
  classifyCapture(text, { now: NOW, projects })

describe('classification', () => {
  it('reads a plain action with a day as a task, dated and untimed', () => {
    const { proposal, question } = classify('Submit DBMS assignment Friday')
    expect(proposal).toEqual({
      type: 'task',
      title: 'Submit DBMS assignment',
      dueDate: '2026-09-25',
      dueTime: null,
      projectId: null,
    })
    expect(question).toBeNull()
  })

  it('reads a plain action with nothing else as an undated task', () => {
    expect(classify('Buy a laptop stand').proposal).toMatchObject({
      type: 'task',
      title: 'Buy a laptop stand',
      dueDate: null,
    })
  })

  it('reads "remember that…" as a note to keep', () => {
    const { proposal } = classify('Remember that our Supabase auth uses row level security')
    expect(proposal).toEqual({
      type: 'note',
      title: 'Our Supabase auth uses row level security',
      body: 'Our Supabase auth uses row level security',
    })
  })

  it('reads research and learning as knowledge, not tasks', () => {
    expect(classify('Research RAG architectures').proposal).toEqual({
      type: 'knowledge',
      title: 'Research RAG architectures',
      kind: 'research',
      projectId: null,
    })
    expect(classify('Learn Rust lifetimes').proposal).toMatchObject({
      type: 'knowledge',
      kind: 'learning',
    })
  })

  it('reads an explicit time on a named day as a calendar event', () => {
    expect(classify('Meeting with Rahul tomorrow at 4pm').proposal).toEqual({
      type: 'event',
      title: 'Meeting with Rahul',
      dueDate: '2026-09-22',
      dueTime: '16:00',
      projectId: null,
    })
  })

  it('asks AM or PM for a bare "at 4" rather than choosing', () => {
    const { proposal, question, confidence } = classify('Meeting with E-Cell tomorrow at 4')

    expect(confidence).toBe('low')
    expect(question?.kind).toBe('detail')
    expect(question?.question).toMatch(/morning or the afternoon/)
    expect(question?.options.map((option) => option.proposal)).toEqual([
      {
        type: 'event',
        title: 'Meeting with E-Cell',
        dueDate: '2026-09-22',
        dueTime: '04:00',
        projectId: null,
      },
      {
        type: 'event',
        title: 'Meeting with E-Cell',
        dueDate: '2026-09-22',
        dueTime: '16:00',
        projectId: null,
      },
    ])
    // Until answered, the proposal cannot run: an event without a time is invalid.
    expect(validateInboxProposal(proposal).ok).toBe(false)
  })

  it('asks the time of a meeting that has a day but no time', () => {
    const { proposal, question } = classify('Meeting with Rahul tomorrow')
    expect(proposal).toMatchObject({ type: 'event', dueDate: '2026-09-22', dueTime: null })
    expect(question).toMatchObject({ kind: 'detail', question: 'What time is it?' })
  })

  it('never turns "next week" into an exact day', () => {
    const { proposal, reason } = classify('Follow up with Rahul next week')
    expect(proposal).toMatchObject({
      type: 'task',
      title: 'Follow up with Rahul next week',
      dueDate: null,
    })
    expect(reason).toMatch(/not a day/)
  })

  it('offers a choice for an open question instead of guessing', () => {
    const { question, confidence } = classify("I don't know what to do about FixKaru pricing")
    expect(confidence).toBe('low')
    expect(question?.kind).toBe('choice')
    expect(question?.options.map((option) => option.proposal.type)).toEqual([
      'note',
      'knowledge',
      'task',
    ])
  })

  it('asks whether a venture is a project or a task', () => {
    const { question } = classify('Build a startup around student productivity')
    expect(question?.options.map((option) => option.proposal.type)).toEqual(['project', 'task'])
  })

  it('reads a daily routine as a habit', () => {
    expect(classify('Study DBMS every day').proposal).toEqual({ type: 'habit', name: 'Study DBMS' })
  })

  it('takes an explicit prefix at its word', () => {
    expect(classify('Project: FixKaru').proposal).toEqual({ type: 'project', name: 'FixKaru' })
    expect(classify('goal: ship v1').proposal).toEqual({ type: 'goal', title: 'ship v1' })
  })
})

describe('resolution against real projects', () => {
  it('resolves an @project mention to the real id', () => {
    expect(classify('Write MCP docs @Vaultwork').proposal).toMatchObject({
      type: 'task',
      title: 'Write MCP docs',
      projectId: 'p-vw',
    })
  })

  it('asks which project when a mention matches several, offering only real ids', () => {
    const { proposal, question } = classify('Revise notes @College')
    expect(proposal).toMatchObject({ projectId: null })
    expect(question).toMatchObject({ kind: 'choice', question: 'Which project did you mean?' })
    expect(
      question?.options.map((option) =>
        'projectId' in option.proposal ? option.proposal.projectId : null,
      ),
    ).toEqual(['p-c5', 'p-c6'])
  })

  it('invents no id for a project that does not exist', () => {
    const { proposal, reason } = classify('Plan launch @Nowhere')
    expect(proposal).toMatchObject({ projectId: null })
    expect(reason).toMatch(/no project called “Nowhere”/)
  })
})

describe('validation', () => {
  const task: InboxProposal = {
    type: 'task',
    title: 'Ship',
    dueDate: '2026-09-25',
    dueTime: null,
    projectId: null,
  }

  it('accepts a well-formed proposal', () => {
    expect(validateInboxProposal(task)).toEqual({ ok: true, proposal: task })
  })

  it('refuses an entity type the application cannot create', () => {
    for (const type of ['calendar_series', 'email', 'delete', 'task.delete', '', null]) {
      expect(validateInboxProposal({ ...task, type }).ok, String(type)).toBe(false)
    }
  })

  it('refuses a field the type does not have, rather than ignoring it', () => {
    expect(validateInboxProposal({ ...task, taskId: 'real-looking-id' }).ok).toBe(false)
    expect(validateInboxProposal({ type: 'note', title: 'x', body: '', command: 'rm' }).ok).toBe(
      false,
    )
  })

  it('refuses a malformed model-style proposal', () => {
    for (const bad of [
      'task',
      [],
      { type: 'task' },
      { ...task, dueDate: 'next friday' },
      { ...task, dueTime: '4' },
      { ...task, title: '   ' },
      { ...task, title: 'x'.repeat(201) },
      { type: 'knowledge', title: 'x', kind: 'manifesto', projectId: null },
      { type: 'event', title: 'x', dueDate: '2026-09-25', dueTime: null, projectId: null },
    ]) {
      expect(validateInboxProposal(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('the command a proposal becomes', () => {
  it('maps every type onto an existing creation command, attributed to the inbox', () => {
    const cases: [InboxProposal, string][] = [
      [{ type: 'task', title: 't', dueDate: null, dueTime: null, projectId: 'p-vw' }, 'task.add'],
      [
        { type: 'event', title: 'e', dueDate: '2026-09-22', dueTime: '16:00', projectId: null },
        'task.add',
      ],
      [{ type: 'note', title: 'n', body: 'b' }, 'note.add'],
      [{ type: 'knowledge', title: 'k', kind: 'research', projectId: null }, 'note.add'],
      [{ type: 'project', name: 'p' }, 'project.add'],
      [{ type: 'goal', title: 'g' }, 'goal.add'],
      [{ type: 'habit', name: 'h' }, 'habit.add'],
    ]
    for (const [proposal, kind] of cases) {
      const intent = proposalToIntent(proposal, 'cap-1')
      expect(intent.kind).toBe(kind)
      expect(intent.source).toBe('inbox')
    }
  })

  it('files a task under the resolved project id, not a name', () => {
    const intent = proposalToIntent(
      { type: 'task', title: 't', dueDate: null, dueTime: null, projectId: 'p-vw' },
      'cap-1',
    )
    expect(intent).toMatchObject({ defaultProjectId: 'p-vw', draft: { projectName: null } })
  })

  it('stamps notes and knowledge with the capture as their provenance', () => {
    const intent = proposalToIntent(
      { type: 'knowledge', title: 'RAG', kind: 'research', projectId: 'p-vw' },
      'cap-9',
    )
    expect(intent).toMatchObject({
      kind: 'note.add',
      knowledgeKind: 'research',
      links: [{ refType: 'project', refId: 'p-vw' }],
      provenance: { source: 'inbox', sourceId: 'cap-9', sourceUrl: null, capturedAt: null },
    })
  })
})
