/**
 * Values the habit composer starts from.
 *
 * They agree with `habitService`'s own defaults by assertion rather than by
 * import — the UI layer may not import a service value — so
 * `habitFormValue.test.ts` holds the two in step. The same arrangement
 * `projectAppearance` uses for project defaults.
 */
export const DEFAULT_HABIT_COLOR = 'teal'

/** Monday to Friday, 0 = Sunday. Mirrors the service's `WEEKDAYS`. */
export const WEEKDAYS = [1, 2, 3, 4, 5]
