import { describe, expect, it } from 'vitest'
import { COMMAND_HELP, describeIntent, isCommandText, parseCommand } from './commandRouter'

const NOW = new Date(2026, 8, 3, 10, 0, 0)
const route = (input: string, source: 'ui' | 'quickadd' | 'palette' = 'palette') =>
  parseCommand(input, { source, now: NOW })

describe('bare text is /add', () => {
  it('treats plain text as a task to capture', () => {
    const intent = route('Study Java tomorrow 7pm')
    expect(intent.kind).toBe('task.add')
    if (intent.kind !== 'task.add') return
    expect(intent.draft.title).toBe('Study Java')
    expect(intent.draft.dueDate).toBe('2026-09-04')
    expect(intent.draft.dueTime).toBe('19:00')
  })

  it('produces the same draft as the explicit command', () => {
    const bare = route('Study Java tomorrow 7pm')
    const explicit = route('/add Study Java tomorrow 7pm')
    expect(bare.kind === 'task.add' && bare.draft).toEqual(
      explicit.kind === 'task.add' && explicit.draft,
    )
  })

  it('carries the tokens through for highlighting', () => {
    const intent = route('/add Study Java tomorrow 7pm')
    if (intent.kind !== 'task.add') throw new Error('expected task.add')
    expect(intent.tokens.map((token) => token.kind)).toEqual(['date', 'time'])
  })
})

describe('task commands', () => {
  it('routes /done to a completion by text', () => {
    expect(route('/done binary trees')).toMatchObject({
      kind: 'task.complete',
      ref: { by: 'text', query: 'binary trees' },
    })
  })

  it('routes /delete to a deletion by text', () => {
    expect(route('/delete binary trees')).toMatchObject({
      kind: 'task.delete',
      ref: { by: 'text', query: 'binary trees' },
    })
  })

  it('routes /undone to a reopen', () => {
    expect(route('/undone lab record')).toMatchObject({
      kind: 'task.uncomplete',
      ref: { by: 'text', query: 'lab record' },
    })
  })

  it('accepts the aliases', () => {
    expect(route('/complete x').kind).toBe('task.complete')
    expect(route('/rm x').kind).toBe('task.delete')
    expect(route('/reopen x').kind).toBe('task.uncomplete')
    expect(route('/a x').kind).toBe('task.add')
  })

  it('is case-insensitive about the command word', () => {
    expect(route('/DONE binary trees').kind).toBe('task.complete')
  })

  it('keeps an empty reference rather than inventing one', () => {
    expect(route('/done')).toMatchObject({ kind: 'task.complete', ref: { by: 'text', query: '' } })
  })
})

describe('view commands', () => {
  it('routes each view word', () => {
    expect(route('/today')).toMatchObject({ kind: 'view.open', view: 'today' })
    expect(route('/inbox')).toMatchObject({ kind: 'view.open', view: 'inbox' })
    expect(route('/upcoming')).toMatchObject({ kind: 'view.open', view: 'upcoming' })
    expect(route('/overdue')).toMatchObject({ kind: 'view.open', view: 'overdue' })
    expect(route('/completed')).toMatchObject({ kind: 'view.open', view: 'completed' })
    expect(route('/tasks')).toMatchObject({ kind: 'view.open', view: 'all' })
    expect(route('/all')).toMatchObject({ kind: 'view.open', view: 'all' })
  })

  it('routes /search to a navigation carrying the query', () => {
    expect(route('/search binary trees')).toMatchObject({
      kind: 'app.navigate',
      path: '/tasks?q=binary%20trees',
    })
  })
})

describe('the source is preserved', () => {
  it('stamps whichever producer asked', () => {
    expect(route('Study Java', 'quickadd').source).toBe('quickadd')
    expect(route('/today', 'palette').source).toBe('palette')
    expect(route('/done x', 'ui').source).toBe('ui')
  })

  it('keeps the raw text for the log', () => {
    expect(route('/done binary trees').raw).toBe('/done binary trees')
  })
})

describe('input the router must not misread', () => {
  it('refuses an unknown slash command instead of capturing it as a task', () => {
    // Capturing "/dlete foo" as a task titled "/dlete foo" is the failure mode
    // this guards: a typo would silently become clutter.
    expect(route('/dlete foo')).toMatchObject({ kind: 'unknown', command: 'dlete' })
  })

  it('reports empty input as nothing to run', () => {
    expect(route('   ')).toMatchObject({ kind: 'unknown', command: '' })
  })

  it('allows /add with no text so the executor can explain', () => {
    const intent = route('/add')
    expect(intent.kind).toBe('task.add')
    if (intent.kind !== 'task.add') return
    expect(intent.draft.title).toBe('')
  })

  it('ignores leading whitespace before the slash', () => {
    expect(isCommandText('   /today')).toBe(true)
    expect(route('   /today')).toMatchObject({ kind: 'view.open', view: 'today' })
  })
})

describe('describing an intent before running it', () => {
  it('gives the palette a label for each kind', () => {
    expect(describeIntent(route('Study Java'))).toBe('Add “Study Java”')
    expect(describeIntent(route('/done binary trees'))).toBe('Complete “binary trees”')
    expect(describeIntent(route('/delete lab'))).toBe('Delete “lab”')
    expect(describeIntent(route('/today'))).toBe('Go to Today')
    expect(describeIntent(route('/dlete foo'))).toBe('Unknown command /dlete')
  })
})

describe('help', () => {
  it('lists every command with a usage line', () => {
    expect(route('/help').kind).toBe('help')
    expect(COMMAND_HELP.length).toBeGreaterThan(5)
    for (const entry of COMMAND_HELP) {
      expect(entry.usage.startsWith('/')).toBe(true)
      expect(entry.summary.length).toBeGreaterThan(0)
    }
  })
})
