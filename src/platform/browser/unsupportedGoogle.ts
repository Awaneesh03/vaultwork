import { GoogleError, type GooglePort, type GoogleStatus } from '../ports'

/**
 * Google in a browser (M19.2): not available, and saying so.
 *
 * A browser bundle is public, so it cannot hold a Google client or a grant.
 * Reading the status never throws; everything else refuses.
 */

const IDLE: GoogleStatus = {
  configuredInBuild: false,
  authorized: false,
  connecting: false,
  reconnectRequired: false,
  calendar: false,
  gmail: false,
  account: null,
  connectedAt: null,
  lastCheckedAt: null,
  lastError: null,
  keychainReads: 0,
}

const refuse = async (): Promise<never> => {
  throw new GoogleError('unavailable', 'Google is available in the desktop app only.')
}

export const unsupportedGoogle: GooglePort = {
  id: 'google-unsupported',
  isAvailable: false,
  async status() {
    return IDLE
  },
  connect: refuse,
  cancelConnect: refuse,
  disconnect: refuse,
}
