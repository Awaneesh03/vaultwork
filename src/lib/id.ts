/**
 * IDs are UUIDs generated on the client. Never auto-increment: a UUID survives
 * export, re-import, and being written into a Markdown file's frontmatter as
 * the key that lets the app recognise its own note later.
 */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  // Fallback for insecure contexts and older Safari. Same shape, same
  // uniqueness guarantees, just assembled by hand.
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('No crypto source available for ID generation')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
