/**
 * Result is used at *fallible boundaries* only — import, export, snapshot
 * restore — where the caller must handle failure as data. Everywhere else the
 * repositories throw a typed RepositoryError, because threading a Result
 * through every CRUD call buys nothing and costs readability.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/** Runs a throwing function and captures the failure as a Result. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
