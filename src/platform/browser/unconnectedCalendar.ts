import type { CalendarPort } from '../ports'
import { PortNotSupportedError } from '../ports'

/**
 * The calendar port while no calendar connector exists (M19.1).
 *
 * Used by every build, desktop included: Vaultwork cannot read an external
 * calendar yet, and the honest adapter says so rather than returning an empty
 * list that would read as "you have no meetings today". An empty day and an
 * unknown day are different answers, and only one of them is true.
 */
export const unconnectedCalendar: CalendarPort = {
  id: 'unconnected-calendar',
  isSupported: false,
  async eventsBetween() {
    throw new PortNotSupportedError('calendar', 'eventsBetween')
  },
}
