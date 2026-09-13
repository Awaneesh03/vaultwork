import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform, type AiStatus } from '@/platform'
import { createTask } from '@/services/taskService'
import { resetAiConfirmations } from '@/services'
import { useToastStore } from '@/store/toastStore'
import { resetDatabase, freezeClock } from '../../../../tests/helpers'
import { AiView } from './AiView'

/**
 * What the Assistant screen *says about itself*.
 *
 * `AiView.dom.test.tsx` proves the pipeline: that a proposal cannot execute
 * itself, that the summary is the application's and not the model's, that a
 * vanished target is reported rather than retried. This proves the part the
 * redesign is responsible for — that a reader can tell an answer from a
 * question from a proposal without decoding shapes, and that the moment
 * Vaultwork is about to change data does not look like the moments before it.
 */

const NOW = new Date(2026, 8, 6, 10, 0, 0)

const READY: AiStatus = {
  configured: true,
  enabled: true,
  provider: 'groq',
  model: 'fake-model-v1',
  lastError: null,
  keychainReads: 1,
}

function fakeProvider(reply: unknown, status: AiStatus = READY) {
  vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(true)
  vi.spyOn(platform.ai, 'status').mockResolvedValue(status)
  return vi.spyOn(platform.ai, 'complete').mockResolvedValue({
    text: typeof reply === 'string' ? reply : JSON.stringify(reply),
    model: status.model,
    finishReason: 'stop',
    usage: null,
  })
}

beforeEach(async () => {
  await resetDatabase()
  resetAiConfirmations()
  freezeClock(NOW)
  useToastStore.setState({ toasts: [], undoStack: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const view = () =>
  render(
    <MemoryRouter initialEntries={['/ai']}>
      <AiView />
    </MemoryRouter>,
  )

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
}

describe('the starting state', () => {
  it('separates what is answered from what is proposed', async () => {
    fakeProvider({ kind: 'answer', message: 'hi' })
    view()
    await screen.findByText('Assistant')

    // The single most important thing to learn here is that some prompts come
    // back as prose and others come back as a gate.
    const asking = screen.getByRole('heading', { name: 'Ask about your work' })
    const changing = screen.getByRole('heading', { name: 'Propose a change' })

    const askGroup = asking.closest('section') as HTMLElement
    const changeGroup = changing.closest('section') as HTMLElement

    expect(within(askGroup).getByRole('button', { name: "What's overdue?" })).toBeTruthy()
    expect(within(changeGroup).getByRole('button', { name: 'Complete my Java task' })).toBeTruthy()
    expect(within(changeGroup).getByText(/proposal you confirm or discard/)).toBeTruthy()
  })

  it('names the model answering, beside the name of the thing answering', async () => {
    fakeProvider({ kind: 'answer', message: 'hi' })
    view()

    const heading = await screen.findByText('Assistant')
    const header = heading.closest('header') as HTMLElement
    expect(within(header).getByText('groq')).toBeTruthy()
    expect(within(header).getByText('fake-model-v1')).toBeTruthy()
  })
})

describe('naming what came back', () => {
  it('records the request rather than staging a conversation', async () => {
    fakeProvider({ kind: 'answer', message: 'Two are due.' })
    view()
    await screen.findByText('Assistant')
    await ask("What's due?")

    expect(await screen.findByText('You asked')).toBeTruthy()
    expect(screen.getByText("What's due?")).toBeTruthy()
  })

  it('calls an answer an answer, and says it changed nothing', async () => {
    fakeProvider({ kind: 'answer', message: 'Two are due.' })
    view()
    await screen.findByText('Assistant')
    await ask("What's due?")

    expect(await screen.findByText('Answer')).toBeTruthy()
    // The one outcome that changes nothing should not have to be deduced from
    // an absence of buttons.
    expect(screen.getByText(/this is an answer/)).toBeTruthy()
  })

  it('calls a clarification a clarification', async () => {
    fakeProvider({
      kind: 'clarification',
      message: 'Which Java task did you mean?',
      options: ['Study Java', 'Java Assignment'],
    })
    view()
    await screen.findByText('Assistant')
    await ask('complete java')

    expect(await screen.findByText('Needs a detail')).toBeTruthy()
  })

  it('calls a failure a failure without calling it an answer', async () => {
    fakeProvider('not json at all')
    view()
    await screen.findByText('Assistant')
    await ask('anything')

    expect(await screen.findByText('Could not answer')).toBeTruthy()
    expect(screen.queryByText('Answer')).toBeNull()
  })
})

describe('the moment data is about to change', () => {
  const proposal = {
    kind: 'plan',
    message: 'I can do that.',
    steps: [
      {
        description: 'Tidy up a few old things',
        intent: { kind: 'task.complete', ref: { by: 'text', query: 'Study Java' } },
      },
    ],
  }

  it('does not look like the assistant talking', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(proposal)
    view()
    await screen.findByText('Assistant')
    await ask('complete study java')

    const card = await screen.findByRole('group', { name: 'Confirm proposed changes' })

    // Stated, not implied by a border colour: these words are Vaultwork's.
    expect(within(card).getByText(/not by the assistant/)).toBeTruthy()

    // The numbered list — the thing being agreed to — is the application's
    // wording. The model's own description exists, but one disclosure away,
    // as reasoning rather than as the action.
    const actions = card.querySelector('ol') as HTMLElement
    expect(within(actions).getByText('Complete task: “Study Java”')).toBeTruthy()
    expect(within(actions).queryByText('Tidy up a few old things')).toBeNull()

    const why = card.querySelector('details') as HTMLElement
    expect(within(why).getByText('Tidy up a few old things')).toBeTruthy()
  })

  it('says in words that it has not happened yet', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(proposal)
    view()
    await screen.findByText('Assistant')
    await ask('complete study java')

    const card = await screen.findByRole('group', { name: 'Confirm proposed changes' })
    expect(within(card).getByText('Not applied yet')).toBeTruthy()
    expect(within(card).getByText(/Nothing has changed yet/)).toBeTruthy()
  })

  it('points undo at the one stack rather than growing a second', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(proposal)
    view()
    await screen.findByText('Assistant')
    await ask('complete study java')

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/Undo is on the toast/)).toBeTruthy()
    // And the claim is true: the undo is the ordinary toast action, carrying
    // the inverse intent, exactly as any other completion would.
    await waitFor(() => {
      const toast = useToastStore.getState().toasts[0]
      expect(toast?.action?.label).toBe('Undo')
      expect(toast?.action?.intent.kind).toBe('task.uncomplete')
    })
  })
})
