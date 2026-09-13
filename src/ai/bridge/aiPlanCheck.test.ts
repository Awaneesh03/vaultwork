import { describe, expect, it } from 'vitest'
import type { AiStep, ProposedIntent } from '../aiTypes'
import { checkPlanCoherence } from './aiPlanCheck'

/**
 * Whether a plan makes sense as a sequence.
 *
 * Every case here is a plan whose *steps* are individually valid — the schema
 * accepts them and the allowlist permits them — but whose combination cannot
 * work. That is the gap this check fills, and the reason it exists at plan
 * level rather than step level.
 *
 * The other half of the job is restraint: a plan that merely looks unusual must
 * pass. A validator with opinions about how someone should organise their work
 * is worse than no validator.
 */

const RAW = 'plan my evening'

const add = (title: string): ProposedIntent => ({
  kind: 'task.add',
  source: 'ai',
  raw: RAW,
  title,
  dueDate: null,
  dueTime: null,
  priority: 'none',
  projectName: null,
  estimateMin: null,
})

const complete = (query: string): ProposedIntent => ({
  kind: 'task.complete',
  source: 'ai',
  raw: RAW,
  ref: { by: 'text', query },
})

const reschedule = (query: string): ProposedIntent => ({
  kind: 'task.reschedule',
  source: 'ai',
  raw: RAW,
  ref: { by: 'text', query },
  dueDate: '2026-09-07',
  dueTime: '19:00',
})

const plan = (...intents: ProposedIntent[]): AiStep[] =>
  intents.map((intent, index) => ({
    id: `step-${index + 1}`,
    description: `step ${index + 1}`,
    intent,
  }))

describe('a coherent plan', () => {
  it('passes when the steps are independent', () => {
    expect(
      checkPlanCoherence(plan(complete('Study Java'), reschedule('Write essay'), add('Revise'))),
    ).toBeNull()
  })

  it('passes an empty plan', () => {
    expect(checkPlanCoherence([])).toBeNull()
  })

  it('allows rescheduling a task it also completes', () => {
    // Odd, but not impossible: `task.reschedule` resolves over every live task,
    // so a finished one is still a valid target. Refusing this would be the
    // validator having an opinion rather than enforcing a rule.
    expect(checkPlanCoherence(plan(complete('Study Java'), reschedule('Study Java')))).toBeNull()
  })

  it('allows two identical additions', () => {
    // Capturing the same title twice may well be deliberate, and the
    // application has no rule against it. Deduplicating by text here would be a
    // planner-specific policy invented from nothing.
    expect(checkPlanCoherence(plan(add('Review Java'), add('Review Java')))).toBeNull()
  })

  it('allows adding a task whose name merely resembles another step’s', () => {
    expect(
      checkPlanCoherence(plan(add('Review recursion notes'), complete('Review recursion'))),
    ).toBeNull()
  })
})

describe('a plan that acts on what it is creating', () => {
  it('is refused, naming the step and the reason', () => {
    /*
     * The case that motivated the whole check. Both steps are valid; resolution
     * would report "nothing here matches Review recursion", which is true and
     * useless — the task is missing because step 1 has not run, and nothing runs
     * before confirmation.
     */
    const problem = checkPlanCoherence(plan(add('Review recursion'), complete('Review recursion')))

    expect(problem?.stepId).toBe('step-2')
    expect(problem?.reason).toContain('while also creating it')
  })

  it('is refused for a reschedule too', () => {
    expect(checkPlanCoherence(plan(add('Revise OOP'), reschedule('Revise OOP')))?.stepId).toBe(
      'step-2',
    )
  })

  it('matches the way the resolver matches, not by exact bytes', () => {
    // `entityResolver` normalises case and whitespace; so does this, or the
    // check would miss the very plans the resolver would then fail on.
    expect(
      checkPlanCoherence(plan(add('Review Recursion'), complete('  review   recursion '))),
    ).not.toBeNull()
  })

  it('does not fire when the reference comes first', () => {
    // Completing an existing task and then adding one of the same name is
    // strange but possible — the first refers to a row that exists now.
    expect(checkPlanCoherence(plan(complete('Review recursion'), add('Review recursion')))).toBeNull()
  })
})

describe('a plan that repeats itself', () => {
  it('refuses the same action twice on the same words', () => {
    const problem = checkPlanCoherence(plan(complete('Study Java'), complete('Study Java')))

    expect(problem?.stepId).toBe('step-2')
    expect(problem?.reason).toContain('twice')
  })

  it('refuses a repeat even with other steps between', () => {
    expect(
      checkPlanCoherence(
        plan(complete('Study Java'), reschedule('Write essay'), complete('Study Java')),
      )?.stepId,
    ).toBe('step-3')
  })
})

describe('what it deliberately leaves alone', () => {
  it('says nothing about a malformed reference', () => {
    // Refusing this is `resolveStep`'s job, with a message about references. A
    // plan check that also policed reference shapes would report the wrong
    // reason for the wrong problem.
    const malformed = plan(add('Something'))
    malformed.push({
      id: 'step-2',
      description: 'broken',
      intent: {
        kind: 'task.complete',
        source: 'ai',
        raw: RAW,
        ref: { by: 'id', id: 'task-42' },
      } as unknown as ProposedIntent,
    })

    expect(checkPlanCoherence(malformed)).toBeNull()
  })

  it('never throws, whatever it is handed', () => {
    const junk = [
      { id: 'step-1', description: 'x', intent: { kind: 'task.complete', ref: null } },
      { id: 'step-2', description: 'x', intent: { kind: 'task.complete', ref: { by: 'text' } } },
      { id: 'step-3', description: 'x', intent: { kind: 'nonsense' } },
    ] as unknown as AiStep[]

    expect(() => checkPlanCoherence(junk)).not.toThrow()
  })
})

describe('determinism', () => {
  it('gives the same verdict for the same plan, every time', () => {
    const steps = plan(add('Review recursion'), complete('Review recursion'))
    const first = checkPlanCoherence(steps)

    for (let i = 0; i < 20; i += 1) {
      expect(checkPlanCoherence(steps)).toEqual(first)
    }
  })

  it('reports the earliest problem when a plan has several', () => {
    const problem = checkPlanCoherence(
      plan(add('A'), complete('A'), complete('B'), complete('B')),
    )
    expect(problem?.stepId).toBe('step-2')
  })

  it('mutates nothing it was given', () => {
    const steps = plan(add('Review recursion'), complete('Review recursion'))
    const before = JSON.stringify(steps)

    checkPlanCoherence(steps)
    expect(JSON.stringify(steps)).toBe(before)
  })
})
