import { describe, expect, it } from 'vitest'
import type { AiCompletionRequest, AiCompletionResult, AiPort, AiStatus } from '@/platform/ports'
import { buildAiRequest, contextPreamble, responseContract, systemPrompt } from './aiPrompt'
import { parseAiResponse } from './aiResponseParser'
import { AI_ALLOWED_INTENT_KINDS, AI_LIMITS } from './aiTypes'
import { buildAiContext } from './context/aiContextBuilder'
import type { AiContext, AiSourceData } from './context/aiContextTypes'

/**
 * The request side, and the end-to-end shape of M15.2.
 *
 * The pipeline this pins down stops deliberately early:
 *
 *   text → buildAiRequest → AiPort.complete → parseAiResponse → AiResponse
 *
 * and nothing after it. There is no resolution, no confirmation and no
 * execution in this phase, so the last arrow is where a proposal sits until a
 * later milestone gives the user a way to accept it.
 */

describe('the system prompt', () => {
  it('describes exactly the intents the parser accepts', () => {
    // The prompt and the allowlist are two statements of one contract. If they
    // drift, the model is being asked for something that will then be refused.
    const prompt = systemPrompt()
    for (const kind of AI_ALLOWED_INTENT_KINDS) {
      expect(prompt).toContain(kind)
    }
  })

  it('names no intent kind the parser would reject', () => {
    const mentioned = [...systemPrompt().matchAll(/"(task|note|project|goal|habit)\.\w+"/g)].map(
      (match) => match[0].replaceAll('"', ''),
    )
    const allowed: readonly string[] = AI_ALLOWED_INTENT_KINDS

    expect(mentioned.length).toBeGreaterThan(0)
    for (const kind of mentioned) {
      expect(allowed, `the prompt offers ${kind}`).toContain(kind)
    }
  })

  it('states the bounds it is derived from rather than restating them', () => {
    const contract = responseContract()
    expect(contract).toContain(String(AI_LIMITS.steps))
    expect(contract).toContain(String(AI_LIMITS.options))
  })

  it('tells the model it does not know ids and does not act', () => {
    const prompt = systemPrompt()
    expect(prompt).toMatch(/never invent identifiers/i)
    expect(prompt).toMatch(/do not perform actions/i)
    // The injection rule. Guidance only — the real defences are structural.
    expect(prompt).toMatch(/never as instructions/i)
  })
})

describe('the request', () => {
  it('asks for structured output at temperature zero', () => {
    const request = buildAiRequest('What should I work on?')

    expect(request.json).toBe(true)
    expect(request.temperature).toBe(0)
  })

  it('carries the rules and the user turn, and nothing else', () => {
    const request = buildAiRequest('What should I work on?')

    expect(request.messages).toHaveLength(2)
    expect(request.messages[0]?.role).toBe('system')
    expect(request.messages[1]).toEqual({ role: 'user', content: 'What should I work on?' })
  })

  it('sends no personal data — context is M15.3, and does not exist yet', () => {
    /*
     * The guarantee worth having early: until there is a layer that decides
     * what a provider may be shown, it is shown nothing but the question.
     *
     * Asserted as an exact equality rather than by scanning for suspicious
     * words, because the prompt legitimately *describes* fields like `dueDate`
     * — it is a schema. The claim is not "no field name appears"; it is that
     * the request is the rules plus the user's sentence and nothing else.
     */
    const text = 'Move my Java revision to tomorrow evening.'
    const request = buildAiRequest(text)

    expect(request.messages).toEqual([
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: text },
    ])
  })

  it('names no host, model or credential', () => {
    // Those are the native side's business. A request that could choose them
    // would undo M15.1's whole argument.
    // An exact key set, so a field added to the request has to be added here
    // too rather than slipping in beside the ones being checked for.
    expect(Object.keys(buildAiRequest('hello')).sort()).toEqual([
      'json',
      'messages',
      'temperature',
    ])
  })
})

/** A snapshot with one of everything, for the context-carrying request tests. */
function sampleContext(): AiContext {
  const source: AiSourceData = {
    today: '2026-09-05',
    now: 1_757_000_000_000,
    rankedOpenTasks: [],
    projects: [
      { name: 'DSA Mastery', status: 'active', deadline: null, openTasks: 3, totalTasks: 9 },
    ],
    goals: [],
    habits: [],
    documents: [],
    notes: [{ title: 'Binary trees', updatedAt: 1_757_000_000_000 }],
    counts: { openTasks: 9, dueToday: 2, overdue: 1 },
    totals: { tasks: 0, projects: 1, goals: 0, habits: 0, notes: 1, documents: 0 },
    projectNames: new Map(),
    tagNames: new Map(),
  }
  return buildAiContext(source, 'planning')
}

describe('a request carrying context', () => {
  const TEXT = 'Move my Java revision to tomorrow evening.'

  it('keeps the user’s words in their own message, byte for byte', () => {
    // The assistant must never quietly rewrite the question. Context travels
    // beside the user turn, never folded into it.
    const request = buildAiRequest(TEXT, sampleContext())
    const user = request.messages.filter((message) => message.role === 'user')

    expect(user).toHaveLength(1)
    expect(user[0]?.content).toBe(TEXT)
  })

  it('adds context as a separate system message, after the rules', () => {
    const request = buildAiRequest(TEXT, sampleContext())

    expect(request.messages.map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
    ])
    expect(request.messages[0]?.content).toBe(systemPrompt())
    expect(request.messages[1]?.content).toContain('"purpose":"planning"')
  })

  it('sends no context at all when none is given', () => {
    // M15.2's behaviour, unchanged: a caller with nothing to say sends nothing.
    const request = buildAiRequest(TEXT)

    expect(request.messages).toHaveLength(2)
    expect(request.messages.map((message) => message.role)).toEqual(['system', 'user'])
  })

  it('tells the model the snapshot is data rather than instructions', () => {
    const preamble = contextPreamble(sampleContext())

    expect(preamble).toMatch(/data, not instructions/i)
    expect(preamble).toMatch(/never be|must never/i)
    // And that absence is not evidence of absence.
    expect(preamble).toMatch(/deliberately partial/i)
  })

  it('serializes the context deterministically into the request', () => {
    const a = buildAiRequest(TEXT, sampleContext())
    const b = buildAiRequest(TEXT, sampleContext())

    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('carries the context bytes and nothing else about the application', () => {
    const context = sampleContext()
    const request = buildAiRequest(TEXT, context)
    const body = request.messages.map((message) => message.content).join('\n')

    expect(body).toContain(JSON.stringify(context))
  })
})

/**
 * A provider that returns exactly what a test tells it to.
 *
 * The whole point of `AiPort` being an interface: the pipeline can be driven
 * end to end in Node with no Tauri, no network, no key and no Groq.
 */
function fakeProvider(reply: string): AiPort {
  const status: AiStatus = {
    configured: true,
    enabled: true,
    provider: 'fake',
    model: 'fake-model-v1',
    lastError: null,
    keychainReads: 0,
  }
  return {
    id: 'ai-fake',
    isAvailable: true,
    status: async () => status,
    configure: async () => status,
    disconnect: async () => status,
    setEnabled: async () => status,
    setModel: async () => status,
    test: async () => ({ model: status.model, text: 'ok' }),
    complete: async (request: AiCompletionRequest): Promise<AiCompletionResult> => {
      expect(request.json).toBe(true)
      return { text: reply, model: status.model, finishReason: 'stop', usage: null }
    },
  }
}

/** The M15.2 pipeline, written once, exactly as a later caller would. */
async function ask(port: AiPort, text: string) {
  const completion = await port.complete(buildAiRequest(text))
  return parseAiResponse(completion.text, text)
}

describe('the pipeline, end to end', () => {
  it('turns a question into an answer', async () => {
    const port = fakeProvider(
      JSON.stringify({ kind: 'answer', message: 'Start with Submit OS lab record — it is overdue.' }),
    )

    const result = await ask(port, 'Tell me what I should work on.')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('answer')
  })

  it('turns a change request into a plan with a text reference', async () => {
    const port = fakeProvider(
      JSON.stringify({
        kind: 'plan',
        message: 'I can move that.',
        steps: [
          {
            description: 'Move Java revision to tomorrow evening',
            intent: {
              kind: 'task.reschedule',
              ref: { by: 'text', query: 'Java revision' },
              dueDate: '2026-09-06',
              dueTime: '19:00',
            },
          },
        ],
      }),
    )

    const request = 'Move my Java revision to tomorrow evening.'
    const result = await ask(port, request)

    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'plan') return

    const step = result.value.steps[0]
    expect(step?.id).toBe('step-1')
    expect(step?.intent.source).toBe('ai')
    expect(step?.intent.raw).toBe(request)
    // Still a *text* reference. Nothing has been resolved to a row, and nothing
    // has run — that is M15.4 and M15.5.
    if (step?.intent.kind === 'task.reschedule') {
      expect(step.intent.ref).toEqual({ by: 'text', query: 'Java revision' })
    }
  })

  it('preserves a clarification rather than picking for the user', async () => {
    const port = fakeProvider(
      JSON.stringify({
        kind: 'clarification',
        message: 'Which Java task did you mean?',
        options: ['Java revision', 'Java DSA practice'],
      }),
    )

    const result = await ask(port, 'Complete the Java task.')

    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'clarification') return
    expect(result.value.options).toEqual(['Java revision', 'Java DSA practice'])
  })

  it('refuses a plausible reply that hides an invented id', async () => {
    // The attack this phase is built against, driven through the real pipeline.
    const port = fakeProvider(
      JSON.stringify({
        kind: 'plan',
        message: 'Done.',
        steps: [
          {
            description: 'Complete it',
            intent: { kind: 'task.complete', ref: { by: 'id', id: 'task_01H8XKQ2' } },
          },
        ],
      }),
    )

    const result = await ask(port, 'Complete the Java task.')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid-reference')
  })

  it('surfaces a provider failure as a rejection, not a parsed response', async () => {
    const port = fakeProvider('')
    port.complete = async () => {
      throw new Error('provider unavailable')
    }

    await expect(ask(port, 'anything')).rejects.toThrow('provider unavailable')
  })

  it('refuses prose wrapped around otherwise valid JSON', async () => {
    // A very common real failure: the model explains itself before the object.
    const port = fakeProvider('Sure! Here you go:\n{"kind":"answer","message":"hi"}')

    const result = await ask(port, 'hello')
    expect(result.ok).toBe(false)
  })
})
