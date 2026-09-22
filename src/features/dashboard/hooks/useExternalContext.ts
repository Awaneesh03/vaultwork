import { useCallback, useEffect, useState } from 'react'
import {
  readCalendar,
  readEmail,
  type CalendarEvent,
  type EmailSignal,
  type ExternalState,
} from '@/services'

export interface ExternalContext {
  /** `undefined` while that source is still being asked. */
  calendar: ExternalState<CalendarEvent> | undefined
  email: ExternalState<EmailSignal> | undefined
  /** Asks both sources again (M19.2). A manual path — there is no polling. */
  checkAgain: () => void
}

/**
 * Calendar and email for Today (M19.1), each read on its own.
 *
 * Not a live query and not part of the Today context: external data is not in
 * Vaultwork's database, and a source that hangs must cost its own section and
 * nothing else. Read when Today opens and when the user asks again — never on
 * a timer; held in memory, never stored.
 */
export function useExternalContext(): ExternalContext {
  const [calendar, setCalendar] = useState<ExternalState<CalendarEvent> | undefined>(undefined)
  const [email, setEmail] = useState<ExternalState<EmailSignal> | undefined>(undefined)

  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    void readCalendar().then((state) => {
      if (alive) setCalendar(state)
    })
    void readEmail().then((state) => {
      if (alive) setEmail(state)
    })
    return () => {
      alive = false
    }
  }, [round])

  const checkAgain = useCallback(() => setRound((value) => value + 1), [])

  return { calendar, email, checkAgain }
}

/**
 * The footer's sources sentence. Names as "not connected" only what really is
 * not: a calendar that answered is read live, and said to be read live.
 */
export function sourcesSentence(
  knowledge: boolean,
  calendar: ExternalContext['calendar'],
  email: ExternalContext['email'],
): string {
  const base = knowledge
    ? 'Built from Vaultwork and your linked notes.'
    : 'Built from Vaultwork alone.'
  const cal = calendar?.state === 'ready'
  const mail = email?.state === 'ready'
  // A source that answered with an error is connected — its own line says it failed.
  const off = (state: ExternalContext['calendar'] | ExternalContext['email']) =>
    state === undefined || state.state === 'unavailable'
  const live =
    cal && mail ? 'Calendar and email are' : cal ? 'Calendar is' : mail ? 'Email is' : null
  const missing = [
    off(email) ? 'email' : null,
    off(calendar) ? 'external calendars' : null,
    'other sources',
  ].filter((name) => name !== null)
  const listed =
    missing.length === 1
      ? missing.join('')
      : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`
  const sentence = `${listed.charAt(0).toUpperCase()}${listed.slice(1)} are not connected.`
  return [base, live ? `${live} read live and not stored.` : null, sentence]
    .filter((part) => part !== null)
    .join(' ')
}
