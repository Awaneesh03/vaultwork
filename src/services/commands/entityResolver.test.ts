import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/entities'
import { taskInput } from '../../../tests/factories'
import {
  describeChoices,
  matchTier,
  pickChoice,
  resolveByName,
  resolveTaskByText,
  taskChoices,
} from './entityResolver'

/**
 * The resolver is pure, so these are plain objects rather than database rows.
 * What is being tested is a policy, not a query: **never silently pick a
 * plausible-looking task.**
 */
let counter = 0
function task(title: string, extra: Partial<Task> = {}): Task {
  counter += 1
  return {
    ...taskInput({ title }),
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    createdAt: counter,
    updatedAt: counter,
    deletedAt: null,
    ...extra,
  } as Task
}

const BINARY_TREES = [
  task('Study Binary Trees'),
  task('Revise Binary Trees'),
  task('Practice Binary Trees'),
]

describe('the ambiguity case from the specification', () => {
  const resolution = resolveTaskByText(BINARY_TREES, 'binary trees')

  it('refuses to choose between three equally good matches', () => {
    expect(resolution.status).toBe('ambiguous')
  })

  it('offers every match, numbered from one, in list order', () => {
    if (resolution.status !== 'ambiguous') throw new Error('expected an ambiguity')
    const choices = taskChoices(resolution.candidates, () => null)

    expect(choices.map((choice) => [choice.index, choice.label])).toEqual([
      [1, 'Study Binary Trees'],
      [2, 'Revise Binary Trees'],
      [3, 'Practice Binary Trees'],
    ])
  })

  it('renders as the prompt the specification asks for', () => {
    if (resolution.status !== 'ambiguous') throw new Error('expected an ambiguity')
    const text = describeChoices(
      'Which task did you mean?',
      taskChoices(resolution.candidates, () => null),
    )

    expect(text).toBe(
      [
        'Which task did you mean?',
        '1. Study Binary Trees',
        '2. Revise Binary Trees',
        '3. Practice Binary Trees',
      ].join('\n'),
    )
  })

  it('maps a chosen number back to the right row', () => {
    if (resolution.status !== 'ambiguous') throw new Error('expected an ambiguity')
    const second = resolution.candidates[1] as Task
    expect(pickChoice(resolution.candidates, second.id)?.title).toBe('Revise Binary Trees')
  })
})

describe('resolving to one task', () => {
  it('resolves when only one task matches at all', () => {
    const resolution = resolveTaskByText(BINARY_TREES, 'revise')
    expect(resolution).toMatchObject({
      status: 'resolved',
      entity: { title: 'Revise Binary Trees' },
    })
  })

  it('prefers an exact title over a longer one that contains it', () => {
    const tasks = [task('Study Binary Trees'), task('Study Binary Trees Advanced')]
    const resolution = resolveTaskByText(tasks, 'study binary trees')
    expect(resolution).toMatchObject({
      status: 'resolved',
      entity: { title: 'Study Binary Trees' },
    })
  })

  it('prefers a prefix match over a mid-string one', () => {
    const tasks = [task('Submit OS lab record'), task('Ask about the OS lab')]
    const resolution = resolveTaskByText(tasks, 'submit os')
    expect(resolution).toMatchObject({
      status: 'resolved',
      entity: { title: 'Submit OS lab record' },
    })
  })

  it('is case- and whitespace-insensitive', () => {
    const resolution = resolveTaskByText(BINARY_TREES, '  STUDY   binary trees ')
    expect(resolution).toMatchObject({
      status: 'resolved',
      entity: { title: 'Study Binary Trees' },
    })
  })

  it('reports nothing at all rather than a bad guess', () => {
    expect(resolveTaskByText(BINARY_TREES, 'quantum mechanics')).toEqual({ status: 'none' })
  })

  it('treats an empty query as no match', () => {
    expect(resolveTaskByText(BINARY_TREES, '   ')).toEqual({ status: 'none' })
  })

  it('handles an empty candidate list', () => {
    expect(resolveTaskByText([], 'anything')).toEqual({ status: 'none' })
  })
})

describe('tiers', () => {
  it('ranks exact above prefix above word-set above substring above fuzzy', () => {
    expect(matchTier('Study Binary Trees', 'study binary trees')).toBe(4)
    expect(matchTier('Study Binary Trees', 'study bin')).toBe(3)
    expect(matchTier('Study Binary Trees', 'trees study')).toBe(2)
    expect(matchTier('Study Binary Trees', 'nary tre')).toBe(1)
    expect(matchTier('Study Binary Trees', 'sbt')).toBe(0)
  })

  it('returns null when the characters are not even in order', () => {
    expect(matchTier('Study Binary Trees', 'zzz')).toBeNull()
  })
})

describe('resolveByName is entity-agnostic', () => {
  it('works over anything with a label', () => {
    const projects = [{ name: 'DSA Mastery' }, { name: 'Semester 5' }]
    expect(resolveByName(projects, 'dsa', (p) => p.name)).toMatchObject({
      status: 'resolved',
      entity: { name: 'DSA Mastery' },
    })
  })

  it('reports an ambiguity across two projects sharing a prefix', () => {
    const projects = [{ name: 'DSA Mastery' }, { name: 'DSA Contests' }]
    const resolution = resolveByName(projects, 'dsa', (p) => p.name)
    expect(resolution.status).toBe('ambiguous')
  })
})
