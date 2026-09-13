import { describe, expect, it } from 'vitest'
import { isKnownCommand, parseTelegramText, TELEGRAM_HELP } from './telegramCommands'

/**
 * The translator, on its own.
 *
 * The property under test is restraint: almost everything is handed onward to
 * the command router rather than interpreted here, and anything unrecognised is
 * refused rather than guessed at.
 */

describe('conversational commands', () => {
  it.each([
    ['/start', 'start'],
    ['/help', 'help'],
    ['/h', 'help'],
    ['/status', 'status'],
    ['/cancel', 'cancel'],
    ['/confirm', 'confirm'],
    ['/yes', 'confirm'],
    ['/habits', 'habits'],
    ['/projects', 'projects'],
    ['/goals', 'goals'],
  ])('reads %s as %s', (text, kind) => {
    expect(parseTelegramText(text).kind).toBe(kind)
  })

  it('ignores case and surrounding space', () => {
    expect(parseTelegramText('  /HELP  ').kind).toBe('help')
  })

  it('accepts a command addressed to the bot, as Telegram sends in groups', () => {
    expect(parseTelegramText('/help@vaultwork_bot').kind).toBe('help')
  })
})

describe('list commands map onto views the UI already has', () => {
  it.each([
    ['/today', 'today'],
    ['/inbox', 'inbox'],
    ['/upcoming', 'upcoming'],
    ['/overdue', 'overdue'],
    ['/completed', 'completed'],
    ['/tasks', 'all'],
  ])('reads %s as the %s view', (text, view) => {
    const action = parseTelegramText(text)
    expect(action).toEqual({ kind: 'list', view })
  })
})

describe('references', () => {
  it('reads a bare number as a position in the last list', () => {
    expect(parseTelegramText('/done 2')).toEqual({ kind: 'complete', ref: { by: 'index', index: 2 } })
  })

  it('reads text as something to resolve by name', () => {
    expect(parseTelegramText('/done Study Java')).toEqual({
      kind: 'complete',
      ref: { by: 'text', query: 'Study Java' },
    })
  })

  it('reads a missing reference as none, rather than inventing one', () => {
    expect(parseTelegramText('/done')).toEqual({ kind: 'complete', ref: { by: 'none' } })
  })

  it('does not mistake a long number for a position', () => {
    // Four digits is not a list index; it is a search, and will simply not match.
    expect(parseTelegramText('/done 12345')).toEqual({
      kind: 'complete',
      ref: { by: 'text', query: '12345' },
    })
  })

  it('treats delete the same way, so both share one reference rule', () => {
    expect(parseTelegramText('/delete 3')).toEqual({ kind: 'delete', ref: { by: 'index', index: 3 } })
    expect(parseTelegramText('/rm dentist')).toEqual({
      kind: 'delete',
      ref: { by: 'text', query: 'dentist' },
    })
  })
})

describe('capture is handed to the existing parser', () => {
  it('passes /add through untouched, tokens and all', () => {
    expect(parseTelegramText('/add Study Java tomorrow 7pm #dsa !high ~45m')).toEqual({
      kind: 'route',
      text: '/add Study Java tomorrow 7pm #dsa !high ~45m',
    })
  })

  it('treats plain text as quick capture', () => {
    expect(parseTelegramText('study Java tomorrow at 7 #dsa')).toEqual({
      kind: 'route',
      text: 'study Java tomorrow at 7 #dsa',
    })
  })

  it('refuses a bare /add rather than capturing an empty task', () => {
    expect(parseTelegramText('/add').kind).toBe('unknown')
    expect(parseTelegramText('/new   ').kind).toBe('unknown')
  })
})

describe('notes', () => {
  it('takes the first line as the title', () => {
    expect(parseTelegramText('/note Java recursion notes')).toEqual({
      kind: 'note',
      title: 'Java recursion notes',
      body: '',
    })
  })

  it('takes the remaining lines as the body', () => {
    expect(parseTelegramText('/note Recursion\nIt is useful because...\nAnd also this.')).toEqual({
      kind: 'note',
      title: 'Recursion',
      body: 'It is useful because...\nAnd also this.',
    })
  })

  it('refuses a bare /note', () => {
    expect(parseTelegramText('/note').kind).toBe('unknown')
  })
})

describe('unknown input is refused, never guessed', () => {
  it.each(['/frobnicate', '/deleteeverything', '/dropdatabase', '/'])(
    'refuses %s',
    (text) => {
      expect(parseTelegramText(text).kind).toBe('unknown')
    },
  )

  it('refuses an empty message', () => {
    expect(parseTelegramText('   ').kind).toBe('unknown')
    expect(parseTelegramText('')).toEqual({ kind: 'unknown', command: '' })
  })

  it('does not fuzzy-match a near miss onto a destructive command', () => {
    // `/deleteeverything` must not become `/delete everything`.
    expect(parseTelegramText('/deleteeverything').kind).not.toBe('delete')
  })
})

describe('unicode survives', () => {
  it.each(['/add Café ☕', '/add 日本語のタスク', '/add naïve — résumé', '/add 🎯 focus'])(
    'passes %s through unchanged',
    (text) => {
      expect(parseTelegramText(text)).toEqual({ kind: 'route', text })
    },
  )
})

describe('the help text', () => {
  it('lists every command the parser answers', () => {
    const documented = TELEGRAM_HELP.map((entry) => entry.usage.split(' ')[0])
    for (const command of ['/add', '/done', '/delete', '/today', '/inbox', '/note', '/help']) {
      expect(documented).toContain(command)
    }
  })

  it('documents nothing the parser would refuse', () => {
    for (const entry of TELEGRAM_HELP) {
      const [verb = '', ...rest] = entry.usage.split(' ')
      // A usage line that shows an argument is exercised *with* one: `/add`
      // alone is refused on purpose, and that refusal is the documented
      // behaviour rather than a gap in it.
      const sample = rest.length > 0 ? `${verb} something` : verb
      expect(parseTelegramText(sample).kind, `${entry.usage} is documented`).not.toBe('unknown')
    }
  })
})

describe('the known-verb list and the parser agree', () => {
  /*
   * `isKnownCommand` exists so the assistant fallback can tell "never heard of
   * it" from "you used a command I know, but wrongly" — and it only works if it
   * lists exactly what the parser handles. Two lists that drift would either
   * send a syntax error to a provider or refuse a real command.
   */
  const HANDLED = [
    'start', 'help', 'h', 'status', 'cancel', 'confirm', 'yes',
    'habits', 'projects', 'goals',
    'done', 'complete', 'check',
    'delete', 'del', 'rm',
    'ask', 'note',
    'add', 'a', 'new', 'search',
    'today', 'inbox', 'upcoming', 'overdue', 'completed', 'tasks',
  ]

  it('recognises every verb the parser answers', () => {
    for (const verb of HANDLED) {
      expect(isKnownCommand(`/${verb}`), verb).toBe(true)
      // However badly used, it is still a known command.
      expect(isKnownCommand(`/${verb}   `), verb).toBe(true)
    }
  })

  it('recognises none the parser does not', () => {
    for (const verb of ['wibble', 'deleteeverything', 'askk', 'plan', 'ai']) {
      expect(isKnownCommand(`/${verb} something`), verb).toBe(false)
    }
  })

  it('never claims plain text is a command', () => {
    // Plain text is quick capture, not a verb — so it is not "known" here and
    // never reaches the unknown-command seam at all.
    for (const text of ['Buy milk', '1', '', '   ']) {
      expect(isKnownCommand(text), JSON.stringify(text)).toBe(false)
    }
  })

  it('agrees with the parser about which verbs are understood', () => {
    for (const verb of HANDLED) {
      const action = parseTelegramText(`/${verb} something`)
      // `unknown` is only ever reached for a *malformed* known verb, never for
      // one the list does not contain.
      if (action.kind === 'unknown') {
        expect(isKnownCommand(`/${verb} something`), verb).toBe(true)
      }
    }
  })
})
