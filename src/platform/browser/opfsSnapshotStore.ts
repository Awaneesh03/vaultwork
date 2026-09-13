import { PortNotSupportedError, type SnapshotMeta, type SnapshotStore } from '../ports'

const DIRECTORY = 'snapshots'

function opfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof globalThis.FileSystemFileHandle !== 'undefined'
  )
}

/**
 * `entries()` is part of the OPFS spec but is not in every TypeScript DOM lib
 * yet, so the async iterator is declared here rather than reached for with a
 * cast at the call site.
 */
interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

async function snapshotDir(): Promise<IterableDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(DIRECTORY, { create: true })
  return dir as IterableDirectoryHandle
}

/**
 * Rolling snapshots in the Origin Private File System.
 *
 * Be clear about what this does and does not protect against. It protects
 * against *you* — a bad import, a bulk delete, a bug in a future milestone —
 * because it lives outside the IndexedDB database it is backing up. It does not
 * protect against the browser clearing site data, which takes OPFS with it.
 * Durable backup is the downloaded JSON file, and the app says so rather than
 * implying a safety it cannot provide.
 */
export const opfsSnapshotStore: SnapshotStore = {
  id: 'opfs',

  get isAvailable() {
    return opfsAvailable()
  },

  async save(id, contents) {
    if (!opfsAvailable()) throw new PortNotSupportedError('opfsSnapshotStore', 'save')
    const dir = await snapshotDir()
    const file = await dir.getFileHandle(`${id}.json`, { create: true })
    const writable = await file.createWritable()
    try {
      await writable.write(contents)
    } finally {
      await writable.close()
    }
  },

  async read(id) {
    if (!opfsAvailable()) throw new PortNotSupportedError('opfsSnapshotStore', 'read')
    const dir = await snapshotDir()
    const handle = await dir.getFileHandle(`${id}.json`)
    const file = await handle.getFile()
    return file.text()
  },

  async list(): Promise<SnapshotMeta[]> {
    if (!opfsAvailable()) return []
    const dir = await snapshotDir()
    const items: SnapshotMeta[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue
      const file = await (handle as FileSystemFileHandle).getFile()
      items.push({
        id: name.replace(/\.json$/, ''),
        createdAt: file.lastModified,
        bytes: file.size,
      })
    }
    return items.sort((a, b) => b.createdAt - a.createdAt)
  },

  async remove(id) {
    if (!opfsAvailable()) return
    const dir = await snapshotDir()
    await dir.removeEntry(`${id}.json`).catch(() => undefined)
  },
}

/** In-memory implementation used by tests and by environments without OPFS. */
export function createMemorySnapshotStore(): SnapshotStore {
  const files = new Map<string, { contents: string; createdAt: number }>()
  return {
    id: 'memory',
    isAvailable: true,
    async save(id, contents) {
      files.set(id, { contents, createdAt: Date.now() })
    },
    async read(id) {
      const entry = files.get(id)
      if (!entry) throw new Error(`No snapshot ${id}`)
      return entry.contents
    },
    async list() {
      return Array.from(files.entries())
        .map(([id, entry]) => ({ id, createdAt: entry.createdAt, bytes: entry.contents.length }))
        .sort((a, b) => b.createdAt - a.createdAt)
    },
    async remove(id) {
      files.delete(id)
    },
  }
}
