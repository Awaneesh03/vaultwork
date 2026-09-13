import { VaultError, type VaultPort } from '../ports'

/**
 * The vault port for a browser that has no File System Access API.
 *
 * Firefox and Safari implement neither `showDirectoryPicker` nor the handle
 * types, so there is nothing to fall back to — and pretending otherwise would
 * be worse than saying so. Every operation refuses with the same readable
 * message rather than throwing a `TypeError` from somewhere deep in a service.
 *
 * The rest of the application is unaffected: notes live in Dexie, and Obsidian
 * is an optional adapter that this build simply does not have.
 */
const MESSAGE =
  'Obsidian filesystem access is not supported in this browser. Chromium-based browsers (Chrome, Edge, Arc, Brave) support it; Firefox and Safari do not.'

const refuse = (): never => {
  throw new VaultError('unsupported', MESSAGE)
}

export const unsupportedVault: VaultPort = {
  id: 'unsupported-vault',
  isSupported: false,

  async connect() {
    return refuse()
  },
  async disconnect() {
    // Disconnecting nothing is not an error, and making it throw would force
    // every caller to special-case a no-op.
  },
  current: () => null,
  async permission() {
    return 'unavailable'
  },
  async requestPermission() {
    return 'unavailable'
  },
  async readPdfText() {
    return refuse()
  },
  async restore() {
    return null
  },
  async readFile() {
    return refuse()
  },
  async writeFile() {
    return refuse()
  },
  async deleteFile() {
    return refuse()
  },
  async exists() {
    return false
  },
  async createDirectory() {
    return refuse()
  },
  async listDirectory() {
    return refuse()
  },
}
