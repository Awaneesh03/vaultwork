import type { EmailPort } from '../ports'
import { PortNotSupportedError } from '../ports'

/**
 * The email port while no mail connector exists (M19.1).
 *
 * Same reasoning as the calendar: "no important email" and "Vaultwork cannot
 * read your email" must not look alike, so this refuses instead of answering.
 */
export const unconnectedEmail: EmailPort = {
  id: 'unconnected-email',
  isSupported: false,
  async recentSignals() {
    throw new PortNotSupportedError('email', 'recentSignals')
  },
}
