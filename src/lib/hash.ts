/**
 * FNV-1a, 32-bit. Synchronous and dependency-free.
 *
 * Used for change detection — "did this record or this file change since the
 * last sync?" — not for security. Collision risk is irrelevant at the scale of
 * one person's vault, and a synchronous hash keeps the reconciliation logic
 * simple to reason about.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable across key order, so two equal objects always hash the same. */
export function hashObject(value: unknown): string {
  return hashString(stableStringify(value))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}
