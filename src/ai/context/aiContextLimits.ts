/**
 * How much of the user's application a model is allowed to be shown.
 *
 * These are a privacy boundary before they are a performance one. Every number
 * here is a decision about how much personal data leaves this machine on a
 * request, so they are deliberately small: a model reasoning about "what should
 * I do next" does not need four hundred tasks, and sending them would be a cost
 * paid in someone's private information rather than in tokens.
 *
 * Centralised so the answer to "what does the provider see?" is one file, and
 * so the tests can assert against the same constants the builder uses rather
 * than restating them.
 */
export const AI_CONTEXT_LIMITS = {
  /**
   * Open tasks, in the application's own Next Action order.
   *
   * Forty is roughly a fortnight of a busy person's live work. Past that the
   * ordering has already answered the question — a task ranked 41st is not the
   * one to do next, and it is not context, it is noise.
   */
  tasks: 40,
  projects: 20,
  goals: 10,
  habits: 20,
  /** Titles only. See the note policy in `aiContextBuilder`. */
  notes: 10,
  /** Tags per task, so one heavily tagged row cannot dominate the payload. */
  tagsPerTask: 8,

  /**
   * PDF excerpts, and how much of each one travels.
   *
   * The tightest limits in this file, deliberately. A single imported PDF can
   * hold hundreds of thousands of characters, and a question that mentions one
   * must not become a request that ships it. Three documents at fifteen hundred
   * characters is roughly a page and a half each — enough to answer "what does
   * this say about X", far short of "here is the document".
   *
   * The excerpt is chosen by a deterministic local search, so what is sent is
   * the matched region rather than the opening pages, and the model has no say
   * in either which document or how much of it.
   */
  documents: 3,
  documentChars: 1_500,

  /**
   * Any single free-text field — a task title, a project name, a note title.
   *
   * Long enough for a real title, short enough that a pasted document in a
   * title field cannot become the whole request.
   */
  text: 200,

  /**
   * The whole serialized context.
   *
   * Roughly three thousand tokens. When the sections add up to more than this,
   * whole sections are dropped in a fixed order rather than rows being sampled
   * — see `DROP_ORDER`. A hard ceiling matters because the per-section limits
   * multiply: forty tasks each with eight tags is already a large object.
   */
  totalChars: 12_000,
} as const

/**
 * The order sections are given up in when the total budget is exceeded.
 *
 * Least useful first, and fixed rather than computed, so the same input always
 * produces the same context. Notes go first because they are titles a model
 * rarely needs; tasks are never dropped, because a request with no tasks in it
 * is not a smaller context, it is a useless one.
 */
export const DROP_ORDER = [
  'notes',
  'habits',
  'goals',
  'projects',
  // Documents are dropped *last* among the droppables: on the `documents`
  // profile they are the reason the request was made, and a context that
  // silently discarded them would produce a confident answer about nothing.
  'documents',
] as const

export type DroppableSection = (typeof DROP_ORDER)[number]
