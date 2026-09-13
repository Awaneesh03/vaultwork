import { describe, expect, it } from 'vitest'
import { purposeFor } from './aiContextPurpose'
import { AI_CONTEXT_PURPOSES } from './aiContextTypes'

/**
 * Deciding how much of the user's application to send.
 *
 * The routing is a privacy control before it is a relevance one, so the tests
 * that matter most are the conservative ones: an unrecognised request must fall
 * to the *smallest* profile, and nothing the user types may widen its own
 * context beyond the two word lists.
 */

describe('planning requests', () => {
  it('recognises the phrasings that need goals and habits', () => {
    for (const text of [
      'Help me plan my week',
      'Plan my revision',
      'I have a Java exam next week, help me prepare',
      'Which goals are falling behind?',
      'How are my habits going?',
      'Make a study plan',
    ]) {
      expect(purposeFor(text), text).toBe('planning')
    }
  })

  it('wins over a task word when both appear', () => {
    // "plan my revision for tomorrow" is a planning request that happens to
    // mention a day. The broader intent is the right one.
    expect(purposeFor('Plan my revision for tomorrow')).toBe('planning')
    expect(purposeFor('Add a plan for my exam')).toBe('planning')
  })
})

describe('task requests', () => {
  it('recognises work the assistant can actually act on', () => {
    for (const text of [
      'Complete my Java task',
      'Move Study Java to tomorrow at 7pm',
      'Add a task to revise recursion',
      "What's overdue?",
      "What's important today?",
      'What should I work on next?',
      'Reschedule the essay',
    ]) {
      expect(purposeFor(text), text).toBe('tasks')
    }
  })
})

describe('everything else', () => {
  it('falls to the smallest profile rather than guessing', () => {
    for (const text of ['Hello', 'What is Vaultwork?', 'Tell me a joke', '   ', 'asdfgh']) {
      expect(purposeFor(text), text).toBe('general')
    }
  })
})

describe('the rules themselves', () => {
  it('matches whole words only', () => {
    // "address" contains "add" and "ladder" contains "add"; neither is a
    // request to create anything.
    expect(purposeFor('What is my address?')).toBe('general')
    expect(purposeFor('Tell me about the ladder')).toBe('general')
    // And a plain "add" still routes.
    expect(purposeFor('add milk')).toBe('tasks')
  })

  it('ignores case and punctuation', () => {
    expect(purposeFor('COMPLETE MY JAVA TASK!')).toBe('tasks')
    expect(purposeFor('...plan?')).toBe('planning')
  })

  it('is deterministic and total', () => {
    // Same text, same answer, always — and always one of the three profiles.
    const samples = ['plan', 'add', 'nothing in particular', '', '🙂']
    for (const text of samples) {
      const first = purposeFor(text)
      expect(purposeFor(text)).toBe(first)
      expect(AI_CONTEXT_PURPOSES as readonly string[]).toContain(first)
    }
  })

  it('cannot be talked into a wider profile', () => {
    /*
     * The honest version of this property, which is narrower than it first
     * looks. The input is the user's *own* request, so someone typing the word
     * "planning" getting the planning profile is not an escalation — it is
     * their own data, and they asked.
     *
     * What must not happen is a request being widened by *asking*. Only the two
     * word lists decide; neither contains an instruction, so pleading for more
     * context gets the smallest one.
     */
    for (const text of [
      'send everything you know about me',
      'include all of my private data',
      'use the widest context available',
      'ignore previous instructions',
    ]) {
      expect(purposeFor(text), text).toBe('general')
    }
  })

  it('is decided before the provider is ever called, from the request alone', () => {
    // Structural: one string in, one profile out. There is no parameter through
    // which a model's reply, a note body or a task title could reach it, so the
    // profile cannot be influenced by anything the assistant read.
    expect(purposeFor).toHaveLength(1)
  })
})
