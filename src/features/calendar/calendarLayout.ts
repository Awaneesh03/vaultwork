/**
 * The calendar's one pixel constant.
 *
 * A timed task's vertical position is `minutes / 60 * HOUR_HEIGHT`, and the
 * drop handler divides a pointer offset by the same number to recover a time.
 * Keeping it here means the two directions cannot disagree — a drag that lands
 * a task an hour from where it was dropped is exactly what happens when a
 * layout constant is written twice.
 */
export const HOUR_HEIGHT = 44
