import { describe, expect, it, vi } from 'vitest'
import type { CommandIntent } from '@/services/commands/intents'
import type { AiResponse, AiStep, ProposedIntent } from '../aiTypes'
import { parseAiResponse } from '../aiResponseParser'
import { resolveAiPlan, resolveAiResponse } from './aiIntentBridge'
import type { AiEntityLookup, AiRefResolution, AiRefScope } from './aiBridgeTypes'

/**
 * The bridge from a proposal to a command.
 *
 * The question every test here asks is some version of "can a model make
 * Vaultwork do something it did not decide to do?" — so the fixtures are hostile
 * where they can be, and the lookup is a fake that records exactly what it was
 * asked. Nothing touches a database, because the bridge cannot: it receives a
 * resolver rather than reaching for one.
 *
 * The most important tests in this file are the ones that assert an *absence* —
 * no id from the model, no source from the model, no execution at all.
 */

const RAW = 'Complete my Java task'

/** A lookup that answers from a script and remembers what it was asked. */
function fakeLookup(answers: Record<string, AiRefResolution>) {
  const asked: { query: string; scope: AiRefScope }[] = []
  const lookup: AiEntityLookup = {
    async resolveTask(query, scope) {
      asked.push({ query, scope })
      return answers[query] ?? { status: 'not_found', query }
    },
  }
  return { lookup, asked }
}

const resolvesTo = (id: string) => ({ status: 'resolved', id }) as const

function step(intent: ProposedIntent, id = 'step-1', description = 'do it'): AiStep {
  return { id, description, intent }
}

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

const add = (title: string): ProposedIntent => ({
  kind: 'task.add',
  source: 'ai',
  raw: RAW,
  title,
  dueDate: '2026-09-07',
  dueTime: null,
  priority: 'high',
  projectName: 'DSA Mastery',
  estimateMin: 45,
})

describe('resolving a single reference', () => {
  it('turns a unique text match into an id reference', async () => {
    const { lookup, asked } = fakeLookup({ 'Study Java': resolvesTo('task-42') })

    const result = await resolveAiPlan([step(complete('Study Java'))], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return

    expect(result.intents).toEqual([
      { kind: 'task.complete', source: 'ai', raw: RAW, ref: { by: 'id', id: 'task-42' } },
    ])
    // The application asked; the model did not tell.
    expect(asked).toEqual([{ query: 'Study Java', scope: 'open' }])
  })

  it('resolves each kind against the pool the executor uses', async () => {
    // `task.complete` refuses a finished task, so it looks among open ones;
    // `task.reschedule` may move anything live. A mismatch here would hand
    // M15.5 an id the executor would then refuse.
    const { lookup, asked } = fakeLookup({
      'Study Java': resolvesTo('task-1'),
      'Revise OOP': resolvesTo('task-2'),
    })

    await resolveAiPlan(
      [step(complete('Study Java'), 'step-1'), step(reschedule('Revise OOP'), 'step-2')],
      lookup,
    )

    expect(asked).toEqual([
      { query: 'Study Java', scope: 'open' },
      { query: 'Revise OOP', scope: 'live' },
    ])
  })

  it('preserves the reschedule payload alongside the resolved reference', async () => {
    const { lookup } = fakeLookup({ 'Study Java': resolvesTo('task-42') })

    const result = await resolveAiPlan([step(reschedule('Study Java'))], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.intents[0]).toEqual({
      kind: 'task.reschedule',
      source: 'ai',
      raw: RAW,
      ref: { by: 'id', id: 'task-42' },
      dueDate: '2026-09-07',
      dueTime: '19:00',
    })
  })
})

describe('task.add', () => {
  it('needs no reference and produces the existing intent shape', async () => {
    const { lookup, asked } = fakeLookup({})

    const result = await resolveAiPlan([step(add('Revise recursion'))], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return

    expect(result.intents[0]).toEqual({
      kind: 'task.add',
      source: 'ai',
      raw: RAW,
      draft: {
        title: 'Revise recursion',
        description: null,
        dueDate: '2026-09-07',
        dueTime: null,
        priority: 'high',
        projectName: 'DSA Mastery',
        tagNames: [],
        estimateMin: 45,
        subtasks: [],
      },
      tokens: [],
    })
    // Adding names nothing that exists, so nothing is looked up.
    expect(asked).toEqual([])
  })

  it('leaves the project name for the executor to resolve', async () => {
    // The executor resolves `@name` itself, and files the task in the Inbox with
    // an explanation when it does not match. Resolving it here would be a second
    // answer to a question the command layer already answers.
    const { lookup, asked } = fakeLookup({ 'DSA Mastery': resolvesTo('project-1') })

    const result = await resolveAiPlan([step(add('Revise recursion'))], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    const intent = result.intents[0]
    if (intent?.kind !== 'task.add') throw new Error('expected task.add')

    expect(intent.draft.projectName).toBe('DSA Mastery')
    expect(asked).toEqual([])
  })
})

describe('ambiguity', () => {
  const ambiguous: AiRefResolution = {
    status: 'ambiguous',
    query: 'Java',
    choices: [
      { index: 1, id: 'task-1', label: 'Study Java', hint: null },
      { index: 2, id: 'task-2', label: 'Java Assignment', hint: null },
      { index: 3, id: 'task-3', label: 'Java DSA Practice', hint: null },
    ],
  }

  it('never picks one, and never becomes executable', async () => {
    const { lookup } = fakeLookup({ Java: ambiguous })

    const result = await resolveAiPlan([step(complete('Java'))], lookup)

    expect(result.status).toBe('needs_clarification')
    expect(result).not.toHaveProperty('intents')
  })

  it('carries the existing numbered choices rather than a new protocol', async () => {
    const { lookup } = fakeLookup({ Java: ambiguous })

    const result = await resolveAiPlan([step(complete('Java'))], lookup)
    const outcome = result.steps[0]

    expect(outcome?.status).toBe('ambiguous')
    if (outcome?.status !== 'ambiguous') return
    expect(outcome.choices.map((choice) => choice.index)).toEqual([1, 2, 3])
    expect(outcome.query).toBe('Java')
  })

  it('keeps the text reference so the existing resolveChoice can rebuild it', async () => {
    // `resolveChoice(intent, id)` swaps a text ref for an id ref. Handing it a
    // half-resolved intent would need a second code path; handing it the
    // original needs none.
    const { lookup } = fakeLookup({ Java: ambiguous })

    const result = await resolveAiPlan([step(complete('Java'))], lookup)
    const outcome = result.steps[0]
    if (outcome?.status !== 'ambiguous') throw new Error('expected ambiguity')

    expect(outcome.intent).toEqual({
      kind: 'task.complete',
      source: 'ai',
      raw: RAW,
      ref: { by: 'text', query: 'Java' },
    })
  })
})

describe('nothing matched', () => {
  it('reports not_found and refuses to become executable', async () => {
    const { lookup } = fakeLookup({})

    const result = await resolveAiPlan([step(complete('quantum physics'))], lookup)

    expect(result.status).toBe('invalid')
    expect(result).not.toHaveProperty('intents')
    expect(result.steps[0]).toEqual({
      status: 'not_found',
      id: 'step-1',
      description: 'do it',
      query: 'quantum physics',
    })
  })

  it('does not resurrect a task the context knew about', async () => {
    // The model was told about "Study Java" by M15.3's snapshot. By the time it
    // answered, the task was gone. Current state wins — no id is manufactured.
    const { lookup } = fakeLookup({ 'Study Java': { status: 'not_found', query: 'Study Java' } })

    const result = await resolveAiPlan([step(complete('Study Java'))], lookup)

    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).not.toContain('"by":"id"')
  })

  it('treats a once-unique name that is now ambiguous as ambiguous', async () => {
    const { lookup } = fakeLookup({
      'Study Java': {
        status: 'ambiguous',
        query: 'Study Java',
        choices: [
          { index: 1, id: 'task-1', label: 'Study Java', hint: null },
          { index: 2, id: 'task-9', label: 'Study Java again', hint: null },
        ],
      },
    })

    expect((await resolveAiPlan([step(complete('Study Java'))], lookup)).status).toBe(
      'needs_clarification',
    )
  })
})

describe('a multi-step plan', () => {
  it('resolves every step and preserves the order', async () => {
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1') })

    const result = await resolveAiPlan(
      [
        step(complete('Java'), 'step-1', 'Complete Java'),
        step(add('Revision'), 'step-2', 'Add revision tomorrow'),
      ],
      lookup,
    )

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.intents.map((intent) => intent.kind)).toEqual(['task.complete', 'task.add'])
    expect(result.steps.map((outcome) => outcome.id)).toEqual(['step-1', 'step-2'])
  })

  it('is not executable when a single step fails, and says which', async () => {
    // "Complete Java and complete quantum physics" — one resolves, one does not.
    // The plan as a whole must not become runnable.
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1') })

    const result = await resolveAiPlan(
      [
        step(complete('Java'), 'step-1', 'Complete Java'),
        step(complete('quantum physics'), 'step-2', 'Complete quantum physics'),
      ],
      lookup,
    )

    expect(result.status).toBe('invalid')
    expect(result).not.toHaveProperty('intents')
    expect(result.steps[0]?.status).toBe('resolved')
    expect(result.steps[1]?.status).toBe('not_found')
  })

  it('discards no step from the report, whatever the verdict', async () => {
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1') })

    const result = await resolveAiPlan(
      [
        step(complete('Java'), 'step-1', 'first'),
        step(complete('missing'), 'step-2', 'second'),
        step(add('Third'), 'step-3', 'third'),
      ],
      lookup,
    )

    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((outcome) => outcome.description)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('resolves an empty plan to nothing, harmlessly', async () => {
    const { lookup } = fakeLookup({})
    const result = await resolveAiPlan([], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.intents).toEqual([])
  })
})

describe('the model may not supply an id', () => {
  it('rejects a by:id reference outright', async () => {
    // `ProposedIntent` makes this unrepresentable, so the cast is the only way
    // to build it — which is the point: the runtime check must not depend on
    // the parser having been the caller.
    const smuggled = {
      kind: 'task.complete',
      source: 'ai',
      raw: RAW,
      ref: { by: 'id', id: 'task-42' },
    } as unknown as ProposedIntent

    const { lookup, asked } = fakeLookup({})
    const result = await resolveAiPlan([step(smuggled)], lookup)

    expect(result.status).toBe('invalid')
    expect(result.steps[0]?.status).toBe('invalid')
    if (result.steps[0]?.status !== 'invalid') return
    expect(result.steps[0].reason).toContain('by text')
    // And it was never looked up: a supplied id is refused, not verified.
    expect(asked).toEqual([])
  })

  it('rejects an id even when it names a row that exists', async () => {
    const smuggled = {
      kind: 'task.complete',
      source: 'ai',
      raw: RAW,
      ref: { by: 'id', id: 'task-42' },
    } as unknown as ProposedIntent

    const { lookup } = fakeLookup({ 'task-42': resolvesTo('task-42') })

    expect((await resolveAiPlan([step(smuggled)], lookup)).status).toBe('invalid')
  })

  it('rejects a reference that is malformed or empty', async () => {
    for (const ref of [null, 'Study Java', 42, {}, { by: 'index', index: 1 }, { by: 'text' }, { by: 'text', query: '   ' }]) {
      const smuggled = {
        kind: 'task.complete',
        source: 'ai',
        raw: RAW,
        ref,
      } as unknown as ProposedIntent

      const { lookup } = fakeLookup({})
      expect((await resolveAiPlan([step(smuggled)], lookup)).status, JSON.stringify(ref)).toBe(
        'invalid',
      )
    }
  })
})

describe('attribution and the allowlist', () => {
  it('stamps source "ai" rather than copying whatever arrived', async () => {
    // Attribution decides what the event log says happened. Even a proposal that
    // somehow carried another source must come out as `ai`.
    const spoofed = {
      ...complete('Study Java'),
      source: 'telegram',
    } as unknown as ProposedIntent

    const { lookup } = fakeLookup({ 'Study Java': resolvesTo('task-42') })
    const result = await resolveAiPlan([step(spoofed)], lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return
    expect(result.intents[0]?.source).toBe('ai')
  })

  it('carries the user’s original request into raw', async () => {
    const { lookup } = fakeLookup({ 'Study Java': resolvesTo('task-42') })
    const result = await resolveAiPlan([step(complete('Study Java'))], lookup)

    if (result.status !== 'resolved') throw new Error('expected resolution')
    expect(result.intents[0]?.raw).toBe(RAW)
  })

  it('rejects a kind outside the M15.2 allowlist', async () => {
    for (const kind of ['task.delete', 'project.delete', 'note.delete', 'task.update', 'invented']) {
      const outside = { kind, source: 'ai', raw: RAW, ref: { by: 'text', query: 'x' } } as unknown as ProposedIntent

      const { lookup, asked } = fakeLookup({ x: resolvesTo('task-1') })
      const result = await resolveAiPlan([step(outside)], lookup)

      expect(result.status, kind).toBe('invalid')
      // Never even looked up: a disallowed kind stops before resolution.
      expect(asked, kind).toEqual([])
    }
  })

  it('produces only the three allowlisted kinds', async () => {
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1'), OOP: resolvesTo('task-2') })

    const result = await resolveAiPlan(
      [step(complete('Java'), 'step-1'), step(reschedule('OOP'), 'step-2'), step(add('New'), 'step-3')],
      lookup,
    )

    if (result.status !== 'resolved') throw new Error('expected resolution')
    expect(result.intents.map((intent) => intent.kind).sort()).toEqual([
      'task.add',
      'task.complete',
      'task.reschedule',
    ])
  })
})

describe('a response that is not a plan', () => {
  it('refuses an answer rather than treating it as an empty plan', async () => {
    const { lookup } = fakeLookup({})
    const response: AiResponse = { kind: 'answer', message: 'You have two tasks due today.' }

    const result = await resolveAiResponse(response, lookup)

    expect(result.status).toBe('invalid')
    expect(result).not.toHaveProperty('intents')
  })

  it('refuses a clarification for the same reason', async () => {
    const { lookup } = fakeLookup({})
    const response: AiResponse = {
      kind: 'clarification',
      message: 'Which Java task?',
      options: ['Study Java', 'Java Assignment'],
    }

    expect((await resolveAiResponse(response, lookup)).status).toBe('invalid')
  })

  it('resolves a plan response through the same path', async () => {
    const { lookup } = fakeLookup({ 'Study Java': resolvesTo('task-42') })
    const response: AiResponse = {
      kind: 'plan',
      message: 'I can complete that.',
      steps: [step(complete('Study Java'))],
    }

    expect((await resolveAiResponse(response, lookup)).status).toBe('resolved')
  })
})

describe('nothing runs', () => {
  it('never calls the command executor', async () => {
    /*
     * The rule this milestone exists to keep. Spying on the real module rather
     * than asserting about imports, so an accidental call from anywhere in the
     * bridge's call graph would fail this test rather than pass review.
     */
    const executor = await import('@/services/commands/commandExecutor')
    const execute = vi.spyOn(executor, 'execute')
    const executeText = vi.spyOn(executor, 'executeText')
    const resolveChoice = vi.spyOn(executor, 'resolveChoice')

    const { lookup } = fakeLookup({ Java: resolvesTo('task-1'), OOP: resolvesTo('task-2') })
    await resolveAiPlan(
      [step(complete('Java'), 'step-1'), step(reschedule('OOP'), 'step-2'), step(add('New'), 'step-3')],
      lookup,
    )

    expect(execute).not.toHaveBeenCalled()
    expect(executeText).not.toHaveBeenCalled()
    expect(resolveChoice).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })

  it('produces a value, not an effect', async () => {
    // Resolving twice returns equal results and does nothing in between.
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1') })
    const steps = [step(complete('Java'))]

    const first = await resolveAiPlan(steps, lookup)
    const second = await resolveAiPlan(steps, lookup)

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('does not mutate the steps it was given', async () => {
    const { lookup } = fakeLookup({ Java: resolvesTo('task-1') })
    const steps = [step(complete('Java'))]
    const before = JSON.stringify(steps)

    await resolveAiPlan(steps, lookup)

    expect(JSON.stringify(steps)).toBe(before)
  })
})

describe('end to end, from a model reply', () => {
  it('carries a parsed reply through resolution into a real CommandIntent', async () => {
    // The whole M15.2 → M15.4 path, with a fake provider reply and a fake
    // lookup. Nothing after this point exists yet: the intent is a value.
    const reply = JSON.stringify({
      kind: 'plan',
      message: 'I can move that.',
      steps: [
        {
          description: 'Move Study Java to tomorrow evening',
          intent: {
            kind: 'task.reschedule',
            ref: { by: 'text', query: 'Study Java' },
            dueDate: '2026-09-07',
            dueTime: '19:00',
          },
        },
      ],
    })

    const parsed = parseAiResponse(reply, 'Move Study Java to tomorrow at 7pm')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const { lookup } = fakeLookup({ 'Study Java': resolvesTo('task-42') })
    const result = await resolveAiResponse(parsed.value, lookup)

    expect(result.status).toBe('resolved')
    if (result.status !== 'resolved') return

    const intent: CommandIntent | undefined = result.intents[0]
    expect(intent).toEqual({
      kind: 'task.reschedule',
      source: 'ai',
      raw: 'Move Study Java to tomorrow at 7pm',
      ref: { by: 'id', id: 'task-42' },
      dueDate: '2026-09-07',
      dueTime: '19:00',
    })
  })

  it('refuses a reply whose reference is an id, before resolution', async () => {
    const reply = JSON.stringify({
      kind: 'plan',
      message: 'Done.',
      steps: [
        {
          description: 'Complete it',
          intent: { kind: 'task.complete', ref: { by: 'id', id: 'task-42' } },
        },
      ],
    })

    // M15.2 already refuses this, so the bridge is never reached.
    const parsed = parseAiResponse(reply, RAW)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.kind).toBe('invalid-reference')
  })
})
