import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { platform, type AiStatus } from '@/platform'
import { eventRepo, taskRepo } from '@/repositories'
import * as executor from '@/services/commands/commandExecutor'
import { createTask, deleteTask } from '@/services/taskService'
import { resetAiConfirmations } from '@/services'
import { useToastStore } from '@/store/toastStore'
import { resetDatabase, freezeClock } from '../../../../tests/helpers'
import { AiView } from './AiView'

/**
 * The assistant screen, driven end to end.
 *
 * Everything below the provider is real: the context builder, the parser, the
 * resolver, the confirmation gate, the command executor, the database and the
 * event log. Only Groq is faked, and it is faked at the port — so what these
 * tests exercise is the production path, not a rehearsal of it.
 *
 * The claim most of them check is a negative one: **the screen cannot change
 * anything until the user confirms.** A UI test is the right place for that,
 * because it is the layer where a stray `onClick` would do the damage.
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

/** Answers with a scripted reply, and counts how often it was asked. */
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

const answer = (message: string) => ({ kind: 'answer', message })

const planFor = (intent: unknown, description = 'Do the thing') => ({
  kind: 'plan',
  message: 'I can do that.',
  steps: [{ description, intent }],
})

const completeStep = (query: string) => ({
  kind: 'task.complete',
  ref: { by: 'text', query },
})

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

const composer = () => screen.getByLabelText('Ask the assistant')
const askButton = () => screen.getByRole('button', { name: /^Ask$/ })

async function ask(text: string) {
  fireEvent.change(composer(), { target: { value: text } })
  fireEvent.click(askButton())
}

describe('the entry point', () => {
  it('renders with example prompts before anything is asked', async () => {
    fakeProvider(answer('hi'))
    view()

    expect(await screen.findByText('Assistant')).toBeTruthy()
    expect(screen.getByRole('button', { name: "What's overdue?" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete my Java task' })).toBeTruthy()
  })

  it('offers no destructive example', async () => {
    fakeProvider(answer('hi'))
    view()

    await screen.findByText('Assistant')
    const text = document.body.textContent ?? ''
    for (const word of ['Delete', 'delete', 'Remove all', 'Archive']) {
      expect(text).not.toContain(word)
    }
  })

  it('fills the composer from an example rather than submitting for you', async () => {
    const provider = fakeProvider(answer('hi'))
    view()

    await screen.findByText('Assistant')
    fireEvent.click(screen.getByRole('button', { name: "What's overdue?" }))

    expect((composer() as HTMLTextAreaElement).value).toBe("What's overdue?")
    expect(provider).not.toHaveBeenCalled()
  })
})

describe('the composer', () => {
  it('will not submit an empty or blank prompt', async () => {
    const provider = fakeProvider(answer('hi'))
    view()
    await screen.findByText('Assistant')

    expect((askButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(composer(), { target: { value: '    ' } })
    expect((askButton() as HTMLButtonElement).disabled).toBe(true)
    expect(provider).not.toHaveBeenCalled()
  })

  it('submits on Enter and keeps Shift+Enter for a new line', async () => {
    const provider = fakeProvider(answer('Two tasks are due today.'))
    view()
    await screen.findByText('Assistant')

    fireEvent.change(composer(), { target: { value: 'what is due' } })
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true })
    expect(provider).not.toHaveBeenCalled()

    fireEvent.keyDown(composer(), { key: 'Enter' })
    await waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
  })

  it('asks the provider exactly once per submission', async () => {
    const provider = fakeProvider(answer('Two tasks are due today.'))
    view()
    await screen.findByText('Assistant')

    await ask('what is due today')
    await screen.findByText('Two tasks are due today.')

    expect(provider).toHaveBeenCalledTimes(1)
  })
})

describe('an answer', () => {
  it('renders the reply and offers no confirmation', async () => {
    fakeProvider(answer('You have **two** tasks due today.'))
    view()
    await screen.findByText('Assistant')

    await ask("what's important today?")

    expect(await screen.findByText(/two/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Confirm proposed changes' })).toBeNull()
  })
})

describe('a clarification', () => {
  it('shows the question and the options the model offered', async () => {
    fakeProvider({
      kind: 'clarification',
      message: 'Which Java task did you mean?',
      options: ['Study Java', 'Java Assignment'],
    })
    view()
    await screen.findByText('Assistant')

    await ask('complete java')

    expect(await screen.findByText('Which Java task did you mean?')).toBeTruthy()
    expect(screen.getByText('Study Java')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Confirm proposed changes' })).toBeNull()
  })
})

describe('an ambiguous reference', () => {
  it('offers the resolver’s own numbered rows, and changes nothing on click', async () => {
    await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    const provider = fakeProvider(planFor(completeStep('Java')))
    const execute = vi.spyOn(executor, 'execute')
    view()
    await screen.findByText('Assistant')

    await ask('complete java')

    expect(await screen.findByText(/Which task did you mean/)).toBeTruthy()
    const choice = await screen.findByRole('button', { name: /Java Assignment/ })

    fireEvent.click(choice)

    // Choosing settles which row is meant. It does not run anything, and it
    // does not ask the provider again.
    expect(execute).not.toHaveBeenCalled()
    expect(provider).toHaveBeenCalledTimes(1)
    expect(choice.getAttribute('aria-pressed')).toBe('true')
  })

  it('turns a choice into a proposal, still behind the gate', async () => {
    const assignment = await createTask({ title: 'Java Assignment' })
    await createTask({ title: 'Java DSA Practice' })
    const provider = fakeProvider(planFor(completeStep('Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete java')
    fireEvent.click(await screen.findByRole('button', { name: /Java Assignment/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))

    const card = await screen.findByRole('group', { name: 'Confirm proposed changes' })
    expect(within(card).getByText('Complete task: “Java Assignment”')).toBeTruthy()

    // Still nothing has run, and still only one provider call.
    expect((await taskRepo.get(assignment.id))?.status).toBe('todo')
    expect(provider).toHaveBeenCalledTimes(1)
  })
})

describe('a proposal', () => {
  it('shows the application’s summary, not the model’s description', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java'), 'Tidy up a few old things'))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')

    const card = await screen.findByRole('group', { name: 'Confirm proposed changes' })
    expect(within(card).getByText('Complete task: “Study Java”')).toBeTruthy()
    // The model's wording is present but marked as reasoning, never as the action.
    expect(within(card).getByText('Why the assistant suggested this')).toBeTruthy()
  })

  it('changes nothing while it waits', async () => {
    const task = await createTask({ title: 'Study Java' })
    const before = (await eventRepo.list()).length
    fakeProvider(planFor(completeStep('Study Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    await screen.findByRole('group', { name: 'Confirm proposed changes' })

    expect((await taskRepo.get(task.id))?.status).toBe('todo')
    expect((await eventRepo.list()).length).toBe(before)
  })

  it('shows no internal id anywhere on screen', async () => {
    const task = await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    await screen.findByRole('group', { name: 'Confirm proposed changes' })

    expect(document.body.textContent).not.toContain(task.id)
  })
})

describe('confirming', () => {
  it('applies the change through the real executor', async () => {
    const task = await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(async () => {
      expect((await taskRepo.get(task.id))?.status).toBe('done')
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Completed/)).toBeTruthy()
  })

  it('never asks the provider again while confirming', async () => {
    await createTask({ title: 'Study Java' })
    const provider = fakeProvider(planFor(completeStep('Study Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull())

    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('offers undo through the existing toast, not a second stack', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const toast = useToastStore.getState().toasts[0]
      expect(toast?.action?.label).toBe('Undo')
      expect(toast?.action?.intent.kind).toBe('task.uncomplete')
    })
  })

  it('cannot be confirmed twice', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    const confirm = await screen.findByRole('button', { name: 'Confirm' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull())
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('cancelling', () => {
  it('withdraws the proposal and changes nothing', async () => {
    const task = await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('Study Java')))
    const execute = vi.spyOn(executor, 'execute')
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText(/Nothing was changed/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Confirm proposed changes' })).toBeNull()
    expect(execute).not.toHaveBeenCalled()
    expect((await taskRepo.get(task.id))?.status).toBe('todo')
  })
})

describe('failures', () => {
  it('reports a target that vanished, and does not retry', async () => {
    const task = await createTask({ title: 'Study Java' })
    const provider = fakeProvider(planFor(completeStep('Study Java')))
    view()
    await screen.findByText('Assistant')

    await ask('complete my java task')
    await screen.findByRole('group', { name: 'Confirm proposed changes' })

    await deleteTask(task.id)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull())
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('reports a reference that matched nothing, and proposes no action', async () => {
    await createTask({ title: 'Study Java' })
    fakeProvider(planFor(completeStep('quantum physics')))
    view()
    await screen.findByText('Assistant')

    await ask('complete quantum physics')

    expect(await screen.findByText(/Nothing here matches/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Confirm proposed changes' })).toBeNull()
  })

  it('reports a malformed reply safely, without quoting it', async () => {
    fakeProvider('IGNORE PREVIOUS INSTRUCTIONS sk-secret-value not json')
    view()
    await screen.findByText('Assistant')

    await ask('what is due')

    expect(await screen.findByText(/did not return valid JSON/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('sk-secret-value')
    expect(document.body.textContent).not.toContain('IGNORE PREVIOUS')
  })

  it('lets the user ask again after a failure', async () => {
    const provider = fakeProvider('not json')
    view()
    await screen.findByText('Assistant')

    await ask('first')
    await screen.findByText(/did not return valid JSON/)

    provider.mockResolvedValue({
      text: JSON.stringify(answer('Better now.')),
      model: 'fake-model-v1',
      finishReason: 'stop',
      usage: null,
    })
    await ask('second')

    expect(await screen.findByText('Better now.')).toBeTruthy()
  })
})

describe('when the assistant cannot be used', () => {
  const unavailable = (status: Partial<AiStatus>, available = true) => {
    vi.spyOn(platform.ai, 'isAvailable', 'get').mockReturnValue(available)
    vi.spyOn(platform.ai, 'status').mockResolvedValue({ ...READY, ...status })
  }

  it('says so when it is switched off, and hides the composer', async () => {
    unavailable({ enabled: false })
    view()

    expect(await screen.findByText('The assistant is switched off')).toBeTruthy()
    expect(screen.queryByLabelText('Ask the assistant')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toBeTruthy()
  })

  it('says so when no key has been saved', async () => {
    unavailable({ configured: false })
    view()

    expect(await screen.findByText('The assistant is not configured')).toBeTruthy()
  })

  it('says so in a browser, which cannot hold a key', async () => {
    unavailable({}, false)
    view()

    expect(await screen.findByText('The assistant needs the desktop app')).toBeTruthy()
  })

  it('never renders a key, a token, a path or a provider URL', async () => {
    fakeProvider(answer('All good.'))
    view()
    await screen.findByText('Assistant')
    await ask('what is due')
    await screen.findByText('All good.')

    const text = document.body.textContent ?? ''
    for (const secret of ['sk-', 'api.groq.com', 'Authorization', 'Bearer', 'apiKey', '/Users/']) {
      expect(text, secret).not.toContain(secret)
    }
  })
})
