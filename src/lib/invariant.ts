/** Throws if a condition the code depends on is not true. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant failed: ${message}`)
}

/** Makes a switch over a string union exhaustive at compile time. */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`)
}
