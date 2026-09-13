import { PortNotSupportedError, type FileSystemPort } from '../ports'

/**
 * The browser's honest baseline: it can hand you a file, and that is all.
 *
 * Reading a vault needs either the File System Access API (M12, Chromium only,
 * after you grant a folder) or Tauri (M13). Pretending otherwise here would
 * only move the failure somewhere less obvious.
 */
export const downloadFileSystem: FileSystemPort = {
  id: 'browser-download',
  capabilities: { canRead: false, canWrite: true, canWatch: false, canChooseFolder: false },

  async readFile() {
    throw new PortNotSupportedError('downloadFileSystem', 'readFile')
  },

  async listDir() {
    throw new PortNotSupportedError('downloadFileSystem', 'listDir')
  },

  async exists() {
    return false
  },

  async writeFile(path, contents) {
    if (typeof document === 'undefined') {
      throw new PortNotSupportedError('downloadFileSystem', 'writeFile outside a document')
    }
    const filename = path.split('/').pop() || 'vaultwork.txt'
    const blob = new Blob([contents], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoke on the next tick: revoking synchronously cancels the download in
    // some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
