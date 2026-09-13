import type { DateStr, Id, Task, TimeStr, Timestamp } from '@/types/entities'
import type { Priority } from '@/types/enums'

/**
 * What a model is allowed to see.
 *
 * This file is the read half of M15's untrusted-component argument. M15.2
 * bounded what a model may *say*; this bounds what it may be *told*. Both halves
 * are needed: a strict parser on the way back is no comfort if the way out sent
 * every note the user has ever written.
 *
 * Three properties are load-bearing.
 *
 *  1. **Nothing here is a domain entity.** Every type below is a projection
 *     written by hand, so a field added to `Task` or `Note` does not silently
 *     start leaving the machine. That is not theoretical: `Task` carries
 *     `vaultPath` — an absolute-ish filesystem path — and `RecentNote` carries
 *     an `excerpt` of the note body. Neither appears below, and neither can,
 *     because the projection names its fields rather than spreading a row.
 *
 *  2. **There are no ids.** A model that is never shown an id cannot echo one
 *     back, which makes M15.2's "the model does not know real ids" rule true by
 *     construction rather than by validation. Turning a title into a row is
 *     `entityResolver`'s job in M15.4, against the database, where the answer is
 *     actually known.
 *
 *  3. **The context is bounded before it is built, not after.** Limits live in
 *     `aiContextLimits`, and every collection here is a bounded projection.
 */

// ------------------------------------------------------------- the context

/**
 * Why this context is being assembled.
 *
 * The point of the profile is that a request to add a task should not carry the
 * user's goals, and a request to plan revision should not have to guess. Each
 * purpose names a fixed set of sections; nothing composes them dynamically,
 * because a context whose contents depend on a model's phrasing is a context
 * nobody can audit.
 */
export const AI_CONTEXT_PURPOSES = ['general', 'tasks', 'planning', 'documents'] as const
export type AiContextPurpose = (typeof AI_CONTEXT_PURPOSES)[number]

export interface AiTask {
  title: string
  status: 'todo' | 'done'
  priority: Priority
  dueDate: DateStr | null
  dueTime: TimeStr | null
  estimateMin: number | null
  /** The project's *name*. There is no project id in this model. */
  project: string | null
  tags: string[]
}

export interface AiProject {
  name: string
  status: string
  deadline: DateStr | null
  openTasks: number
  totalTasks: number
}

export interface AiGoal {
  title: string
  targetDate: DateStr | null
  /** Whole percent, as the Goals screen computes it. */
  percent: number
  health: string
}

export interface AiHabit {
  name: string
  completedToday: boolean
}

/**
 * A note, by title only.
 *
 * Deliberately no body and no excerpt. Note bodies are the most sensitive text
 * in Vaultwork and the least often needed to answer a question about tasks, so
 * M15.3 does not send them at all — not "sends them when asked", *at all*. If a
 * later milestone needs a note's contents it will be one explicitly chosen
 * note, requested by name, and this type will gain a field then.
 */
export interface AiNote {
  title: string
  updatedAt: Timestamp
}

/**
 * One PDF the user asked about, in bounded excerpt form.
 *
 * Excerpts, never documents. A PDF that has been imported may hold hundreds of
 * pages, and sending it because a question mentioned it would be exactly the
 * "send everything and hope" this layer exists to prevent. What travels is a
 * few thousand characters retrieved by a *deterministic local search* over
 * text already in Dexie — the model neither chooses the document nor how much
 * of it is read.
 */
export interface AiDocument {
  title: string
  /** Vault-relative path, so an answer can say which file it came from. */
  path: string
  /**
   * A bounded passage around the search match. Never the whole document.
   *
   * Deliberately not called an "excerpt": that word names the *note* concept the
   * architecture guard forbids this layer from touching, and the two must stay
   * distinguishable by name as well as by rule. A note's contents still never
   * reach a provider; a passage of a PDF the user asked about does.
   */
  passage: string
  /** True when this document holds more text than was sent. */
  clipped: boolean
}

export interface AiCounts {
  openTasks: number
  dueToday: number
  overdue: number
}

/** Says out loud that a section was cut, and by how much. */
export interface AiTruncation {
  section: string
  kept: number
  total: number
}

/**
 * The whole payload.
 *
 * Every collection is always present, empty when a purpose excludes it, so the
 * serialized shape is stable across requests and a diff of two contexts is
 * readable.
 */
export interface AiContext {
  /** The user's local calendar date, from the clock port. */
  today: DateStr
  now: Timestamp
  purpose: AiContextPurpose
  counts: AiCounts
  tasks: AiTask[]
  projects: AiProject[]
  goals: AiGoal[]
  habits: AiHabit[]
  notes: AiNote[]
  /** PDF excerpts, only ever on the `documents` profile. */
  documents: AiDocument[]
  /** Empty when nothing was cut. */
  truncated: AiTruncation[]
}

// ----------------------------------------------------------- the read side

/**
 * What the context builder needs from the application, stated as an interface.
 *
 * Declared *here*, in the AI layer, and implemented in `services/ai` — the same
 * inversion `platform/ports.ts` uses for the vault and for Telegram. Two things
 * follow, and both matter:
 *
 *  - `src/ai` keeps zero runtime dependencies on services, repositories or
 *    Dexie. The architecture guard that says so is not a rule this layer works
 *    around; it is a rule this layer satisfies.
 *
 *  - The builder — which is the security boundary — is testable against a plain
 *    object, with no database, no IndexedDB shim and no clock to freeze. A test
 *    of "does a note body escape?" should not need a seeded database to answer.
 */
export interface AiSourceData {
  today: DateStr
  now: Timestamp
  /**
   * Open tasks in the application's own Next Action order.
   *
   * Ordered by the caller using `rankForNextAction`, so the AI layer neither
   * chooses nor reimplements the ranking. There is exactly one definition of
   * "what to do next" in Vaultwork and it lives in `dashboardStats`.
   */
  rankedOpenTasks: Task[]
  projects: AiSourceProject[]
  goals: AiSourceGoal[]
  habits: AiSourceHabit[]
  notes: AiSourceNote[]
  /**
   * Documents already retrieved by the caller.
   *
   * Retrieval happens in the service layer, using the same deterministic search
   * the Knowledge page uses — the AI layer neither runs the search nor reaches
   * a repository to do it. Empty on every profile but `documents`.
   */
  documents: AiSourceDocument[]
  counts: AiCounts
  /** Totals before any limit, so truncation can be reported honestly. */
  totals: {
    tasks: number
    projects: number
    goals: number
    habits: number
    notes: number
    documents: number
  }
  projectNames: ReadonlyMap<Id, string>
  tagNames: ReadonlyMap<Id, string>
}

/** A PDF as the read model hands it over: already retrieved, not yet clipped. */
export interface AiSourceDocument {
  title: string
  path: string
  /** The matched region of the document's text. Clipped again by the builder. */
  passage: string
  /** Total characters the document holds, so truncation can be stated honestly. */
  totalChars: number
}

export interface AiSourceProject {
  name: string
  status: string
  deadline: DateStr | null
  openTasks: number
  totalTasks: number
}

export interface AiSourceGoal {
  title: string
  targetDate: DateStr | null
  percent: number
  health: string
}

export interface AiSourceHabit {
  name: string
  completedToday: boolean
}

export interface AiSourceNote {
  title: string
  updatedAt: Timestamp
}

/** The one thing the AI layer asks the application for. */
export interface AiReadModel {
  /**
   * `query` is the user's own request text, used only by the `documents`
   * profile to retrieve relevant excerpts. It is never sent to a provider as a
   * search term and never reaches the filesystem: it drives a local string
   * match over text the user explicitly imported.
   */
  read(purpose: AiContextPurpose, query?: string): Promise<AiSourceData>
}
