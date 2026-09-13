import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The names in the type scale, exactly as `globals.css` defines them.
 *
 * Kept here so `tailwind-merge` can be told that `text-body` is a *size*.
 * Out of the box it knows Tailwind's own scale — `text-sm`, `text-lg` — and
 * classifies anything else beginning `text-` as a colour. That is not a
 * cosmetic misfiling: two classes in the same group are treated as a conflict
 * and the earlier one is discarded, so `cn('text-display', 'text-ink')` merged
 * down to `text-ink` and the size silently vanished.
 *
 * It had vanished in forty-eight places, including the note title, which asked
 * for 19px and rendered at 14px for as long as the scale has existed. Nothing
 * reported it: the class list is valid, the page renders, and the only symptom
 * is that a hierarchy someone designed is not the hierarchy on screen.
 *
 * `tests/architecture.test.ts` checks this list against the custom properties
 * in globals.css, so a seventh step cannot be added to one and not the other.
 */
export const TEXT_SCALE = ['micro', 'meta', 'body', 'strong', 'title', 'display'] as const

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: [...TEXT_SCALE] }] } },
})

/** Conditional classes with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
