/** Base for anything the persistence layer throws. */
export class RepositoryError extends Error {
  readonly store: string
  override readonly cause?: unknown

  constructor(message: string, store: string, cause?: unknown) {
    super(message)
    this.name = 'RepositoryError'
    this.store = store
    if (cause !== undefined) this.cause = cause
  }
}

export class NotFoundError extends RepositoryError {
  constructor(store: string, id: string) {
    super(`No ${store} record with id ${id}`, store)
    this.name = 'NotFoundError'
  }
}

/** A unique index rejected the write — e.g. a duplicate [source+externalId]. */
export class ConstraintError extends RepositoryError {
  constructor(store: string, detail: string, cause?: unknown) {
    super(`Constraint violated on ${store}: ${detail}`, store, cause)
    this.name = 'ConstraintError'
  }
}

export class ValidationError extends Error {
  readonly field: string | undefined

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

const DEXIE_CONSTRAINT_NAMES = new Set(['ConstraintError', 'DexieError.ConstraintError'])

/**
 * Dexie does not rethrow the error that aborted a transaction: it rejects with
 * its own wrapper and hangs the original off `inner`. So an error thrown by our
 * own code inside a transaction — a NotFoundError, say — arrives with its type
 * identity lost. Walking the chain restores it, which is what lets callers keep
 * using `instanceof` instead of matching on strings.
 */
function chain(error: unknown): unknown[] {
  const seen: unknown[] = []
  let current = error
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    seen.push(current)
    const next =
      (current as { inner?: unknown }).inner ?? (current as { cause?: unknown }).cause ?? null
    if (!next || seen.includes(next)) break
    current = next
  }
  return seen
}

/** Translates a raw Dexie failure into one of ours, losing nothing. */
export function toRepositoryError(store: string, error: unknown, action: string): RepositoryError {
  const links = chain(error)

  const ours = links.find((link) => link instanceof RepositoryError)
  if (ours) return ours as RepositoryError

  const constraint = links.some(
    (link) => link instanceof Error && DEXIE_CONSTRAINT_NAMES.has(link.name),
  )
  if (constraint) {
    return new ConstraintError(store, `${action} rejected by a unique index`, error)
  }

  const message = error instanceof Error ? error.message : String(error)
  return new RepositoryError(`${action} failed on ${store}: ${message}`, store, error)
}
