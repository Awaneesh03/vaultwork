/**
 * Canonical content, and the hash taken over it.
 *
 * Conflict detection compares text that has travelled through a filesystem, an
 * editor and possibly another operating system. Without a canonical form, a
 * file that Obsidian merely re-saved would look "changed externally" and every
 * export would report a conflict — which trains the user to click through the
 * one warning that matters.
 *
 * Normalisation is therefore deliberately *conservative*. It removes only
 * differences that carry no meaning in Markdown:
 *
 *  - a UTF-8 byte order mark, which some Windows editors prepend
 *  - CRLF and lone CR line endings, folded to LF
 *  - a missing or repeated trailing newline, folded to exactly one
 *
 * It deliberately does **not** touch trailing spaces on a line: two of them are
 * a hard line break in Markdown, and stripping them would silently reformat the
 * user's document. Nor does it reorder or reformat YAML — an unfamiliar key
 * order is the user's business, not ours.
 */

export function normalizeContent(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const lf = withoutBom.replace(/\r\n?/g, '\n')
  const trimmed = lf.replace(/\n+$/, '')
  return trimmed.length === 0 ? '' : `${trimmed}\n`
}

/**
 * A deterministic content hash — 64 bits, as 16 hex characters.
 *
 * Chosen over `crypto.subtle.digest` on purpose. This is a *change detector*,
 * not a security boundary: nobody is forging a note, and the only question ever
 * asked is "is this byte-for-byte what we last saw?". A pure synchronous
 * function keeps the whole conflict layer free of promises and browser APIs,
 * and therefore directly unit-testable; a cryptographic digest would make every
 * comparison async for no benefit.
 *
 * Implemented as two independent 32-bit FNV-1a lanes with different offset
 * bases, concatenated. Two simple lanes are used rather than hand-rolled 64-bit
 * multiplication because JavaScript's bitwise operators are 32-bit, and the
 * lane version is obviously correct on inspection — which matters more here
 * than the last few bits of collision resistance.
 *
 * Computed over the *normalised* text, so a file that differs only in line
 * endings hashes identically.
 */
const FNV_PRIME = 0x0100_0193

function lane(text: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    // Hashed a byte at a time so the value does not depend on how the platform
    // happens to store the string.
    hash = Math.imul(hash ^ (code & 0xff), FNV_PRIME)
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), FNV_PRIME)
  }
  return hash >>> 0
}

export function hashContent(raw: string): string {
  const text = normalizeContent(raw)
  const high = lane(text, 0x811c_9dc5)
  const low = lane(text, 0x01000_193 >>> 0)
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`
}

/** True when two documents are the same once normalised. */
export function contentEquals(a: string, b: string): boolean {
  return normalizeContent(a) === normalizeContent(b)
}
