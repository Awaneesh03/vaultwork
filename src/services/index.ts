export { eventBus } from './eventBus'
export * from './backupService'
export * from './settingsService'
export * from './summaryService'
export * from './storageService'
export { getDiagnostics, sendTestNotification } from './diagnosticsService'
export type { Diagnostics } from './diagnosticsService'
export * from './bootstrapService'
export { STORE_NAMES_FOR_BACKUP } from './storeNames'

/* Milestone 3 — the task system and the command layer. */
export * from './taskService'
export * from './taskQueryService'
export * from './tagService'
export * from './tasks/taskFilters'
export * from './tasks/taskViews'
export * from './quickadd/quickAddParser'
export * from './commands'

/* Milestone 4 — projects. */
export * from './projectService'
export * from './projectQueryService'
export * from './projects/projectStats'

/* Milestone 5 — the dashboard. */
export * from './dashboard/dashboardQueryService'
export * from './dashboard/dashboardStats'

/* Milestone 6 — the calendar. Its pure grid maths is a leaf in lib/calendar. */
export * from './calendar/calendarQueryService'

/* Milestone 7 — habits. */
export * from './habitService'
export * from './habitQueryService'
export * from './habits/habitSchedule'
export * from './habits/habitStats'

/* Milestone 8 — goals and milestones. */
export * from './goalService'
export * from './goalQueryService'
export * from './goals/goalStats'

/* Focus sessions — the Pomodoro timer, stored as timestamps not ticks. */
export * from './focusService'

/* Analytics — read-only, recomputed from the event log rather than stored. */
export * from './analyticsQueryService'

/* Milestone 9 — notes, and the Obsidian path contract they reserve. */
export * from './noteService'
export * from './noteQueryService'
export * from './documentQueryService'

/* Milestone 10 — the Obsidian filesystem adapter and sync.
 *
 * The pure Obsidian transforms live in `integrations/obsidian`, but the UI
 * reaches them through this barrel like everything else — so a component has
 * one import surface rather than having to know which layer a label lives in.
 */
export * from './obsidianService'
export { canExportSafely, canImportSafely, type SyncStatus } from '@/integrations/obsidian/conflict'
export { isSafeVaultPath, isVaultPath } from '@/integrations/obsidian/vaultPath'
export { parseWikilinks, wikilinkTargets, type Wikilink } from '@/integrations/obsidian/wikilinks'

/* Milestone 11 — the bidirectional sync workflow. */
export * from './obsidianSyncService'
export {
  defaultDecisions,
  optionsFor,
  safeDecisions,
  summarizeDecisions,
  type DecisionOption,
  type DecisionSummary,
  type ScanError,
  type SyncDecision,
  type SyncItem,
  type SyncPlan,
} from '@/integrations/obsidian/syncPlan'

/* Milestone 12 — the knowledge layer derived from note bodies. */
export * from './knowledgeQueryService'
export {
  RELATED_WEIGHTS,
  basenameOf,
  type AmbiguousWikilink,
  type KnowledgeGraph,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  type KnowledgeIndex,
  type KnowledgeNote,
  type RelatedNote,
  type ResolvedWikilink,
  type UnresolvedWikilink,
} from '@/integrations/obsidian/knowledgeIndex'
export { processTelegramMessage, resetTelegramSessions } from './telegramService'
export type { ProcessOutcome, TelegramReply } from './telegramService'

/* Milestone 15 — the assistant.
 *
 * Only the application-level surface is exported: asking, proposing, and the
 * confirmation gate. The provider, the parser, the resolver and the executor
 * are all reached through these, never around them.
 */
export { askAi, proposeAiChoices } from './ai/aiAssistantService'
export type { AiAskResult, AiUnavailableReason } from './ai/aiAssistantService'
export {
  AI_CONFIRMATION_TTL_MS,
  cancelAiConfirmation,
  confirmAiAction,
  createAiConfirmation,
  getAiConfirmation,
  resetAiConfirmations,
} from './ai/aiConfirmationService'
export type {
  AiConfirmation,
  AiConfirmationState,
  AiExecutionOutcome,
} from './ai/aiConfirmationService'

/* Milestone 18.1 — the read-only MCP snapshot Claude Desktop reads. */
export * from './mcpSnapshotService'

/* Milestone 18.2 — knowledge artifacts, provenance and research packs. */
export * from './researchPackService'
