import { db } from '@/db'
import { toRepositoryError } from '@/lib/errors'
import type { Id, VaultDocument } from '@/types/entities'
import { createRepository } from './baseRepository'

const base = createRepository('vaultDocuments')

const live = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((row) => row.deletedAt === null)

/**
 * PDF documents read out of the vault.
 *
 * The only layer that knows `vaultDocuments` exists, exactly as every other
 * repository is for its own store. Services ask this for documents; nothing
 * above it touches Dexie.
 *
 * `&vaultPath` is unique in the schema, so "one file is one document" is a
 * property of the database rather than a rule the import path has to remember
 * — which is what makes a repeated scan structurally unable to duplicate a row.
 */
export const vaultDocumentRepo = {
  ...base,

  /** Every live document. One read for a whole scan or a whole search. */
  async listLive(): Promise<VaultDocument[]> {
    try {
      return live(await db.vaultDocuments.toArray())
    } catch (error) {
      throw toRepositoryError('vaultDocuments', error, 'listLive')
    }
  },

  /**
   * The document at a path, if there is one.
   *
   * Case-insensitively, because a vault written by hand contains `Notes/A.pdf`
   * and `notes/a.pdf` for the same file on macOS, and treating them as two
   * documents is the duplicate this store exists to prevent.
   */
  async byPath(path: string): Promise<VaultDocument | undefined> {
    try {
      const wanted = path.toLowerCase()
      const rows = await db.vaultDocuments.toArray()
      return live(rows).find((row) => row.vaultPath.toLowerCase() === wanted)
    } catch (error) {
      throw toRepositoryError('vaultDocuments', error, 'byPath')
    }
  },

  /** Documents whose extracted text is worth searching. */
  async listSearchable(): Promise<VaultDocument[]> {
    try {
      return live(await db.vaultDocuments.toArray()).filter((row) => row.text.length > 0)
    } catch (error) {
      throw toRepositoryError('vaultDocuments', error, 'listSearchable')
    }
  },

  /** Live documents, without their text. For counts and list screens. */
  async listSummaries(): Promise<Omit<VaultDocument, 'text'>[]> {
    try {
      // The text of a hundred PDFs is megabytes; a list screen needs none of it.
      return live(await db.vaultDocuments.toArray()).map(({ text: _text, ...rest }) => rest)
    } catch (error) {
      throw toRepositoryError('vaultDocuments', error, 'listSummaries')
    }
  },

  async get(id: Id): Promise<VaultDocument | undefined> {
    return base.get(id) as Promise<VaultDocument | undefined>
  },
}
