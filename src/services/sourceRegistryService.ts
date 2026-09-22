import { platform, type AiStatus, type TelegramStatus } from '@/platform'
import type { Timestamp } from '@/types/entities'
import { SOURCE_IDS, type SourceCapability, type SourceId, type SourceStatus } from '@/types/enums'
import { getMcpSnapshotPublishedAt } from './mcpSnapshotService'
import { getVaultStatus, type VaultStatus } from './obsidianService'

/**
 * The source registry (M18.4): what Vaultwork is connected to, and what each
 * connection can do — described, never operated.
 *
 * Every fact here is read from the integration that owns it: the vault's own
 * status, the Telegram and AI ports' own status calls, the MCP writer's own
 * record of its last publish. The registry adds a shared vocabulary on top and
 * nothing else. It stores nothing, so it cannot drift from the truth, and it
 * exports no action, so it cannot become a way to *do* anything: work still
 * goes through each integration's typed service, exactly as before.
 *
 * Two honesty rules shape the mapping:
 *
 *  - **Only what was checked.** A saved AI key is `available`, never
 *    `connected`: nothing made a request. MCP is `available` because the file
 *    was written; whether Claude Desktop reads it is outside this process.
 *  - **Capabilities are for now.** A source that cannot be used in this state
 *    lists none, rather than what it would do if it were connected.
 */

export interface SourceDescription {
  id: SourceId
  name: string
  status: SourceStatus
  /** What it does in this build, in this state. Empty when it cannot be used. */
  capabilities: SourceCapability[]
  /** One line of non-sensitive detail: a vault's name, a bot's handle, a model. */
  detail: string
  /** When the status was established — or, for MCP, last proven by a write. */
  checkedAt: Timestamp | null
}

/** What the registry is built from: each integration's own report. */
export interface SourceInputs {
  now: Timestamp
  vault: VaultStatus | null
  /** `null` when this build has no AI adapter at all. */
  ai: AiStatus | null
  /** `null` when this build has no Telegram adapter at all. */
  telegram: TelegramStatus | null
  mcp: { supported: boolean; publishedAt: Timestamp | null }
  /** Sources whose status call threw. */
  failed: ReadonlySet<SourceId>
}

const NAMES: Record<SourceId, string> = {
  vaultwork: 'Vaultwork',
  obsidian: 'Obsidian',
  assistant: 'Assistant provider',
  mcp: 'Claude Desktop (MCP)',
  // The bot is the integration; "Telegram" alone is the Settings group's name.
  telegram: 'Telegram bot',
}

const describeVaultwork = (now: Timestamp): SourceDescription => ({
  id: 'vaultwork',
  name: NAMES.vaultwork,
  status: 'available',
  capabilities: ['read', 'write', 'search'],
  detail: 'Local database on this device.',
  checkedAt: now,
})

const unreadable = (id: SourceId, now: Timestamp): SourceDescription => ({
  id,
  name: NAMES[id],
  status: 'error',
  capabilities: [],
  detail: 'Its status could not be read.',
  checkedAt: now,
})

function describeObsidian(vault: VaultStatus, now: Timestamp): SourceDescription {
  const base = { id: 'obsidian' as const, name: NAMES.obsidian, checkedAt: now }
  switch (vault.state) {
    case 'connected':
      return {
        ...base,
        status: 'connected',
        // No `search`: Vaultwork searches notes it has imported, in Dexie — it
        // does not search the vault itself.
        capabilities: ['read', 'write', 'import', 'export', 'sync'],
        // The folder's name, which the Obsidian page already shows — never its path.
        detail: vault.vaultName === null ? 'Vault connected.' : `Vault “${vault.vaultName}”`,
      }
    case 'not-connected':
      return { ...base, status: 'disconnected', capabilities: [], detail: 'No vault connected.' }
    case 'permission-required':
      return {
        ...base,
        status: 'requiresSetup',
        capabilities: [],
        detail: 'Reconnect to grant access to the vault again.',
      }
    case 'permission-denied':
      return {
        ...base,
        status: 'error',
        capabilities: [],
        detail: 'Access to the vault was denied.',
      }
    case 'unsupported':
      return {
        ...base,
        status: 'unavailable',
        capabilities: [],
        detail: 'This browser cannot reach a vault folder.',
      }
  }
}

function describeAssistant(ai: AiStatus | null, now: Timestamp): SourceDescription {
  const base = { id: 'assistant' as const, name: NAMES.assistant, checkedAt: now }
  if (ai === null) {
    return {
      ...base,
      status: 'unavailable',
      capabilities: [],
      detail: 'Desktop only — the provider key lives in the OS keychain.',
    }
  }
  if (!ai.configured) {
    return { ...base, status: 'requiresSetup', capabilities: [], detail: 'No provider key saved.' }
  }
  if (!ai.enabled) {
    return { ...base, status: 'disconnected', capabilities: [], detail: 'Switched off.' }
  }
  if (ai.lastError !== null) {
    // Generic on purpose: provider error text is never quoted back.
    return { ...base, status: 'error', capabilities: [], detail: 'The last request failed.' }
  }
  return {
    ...base,
    status: 'available',
    capabilities: ['reason'],
    detail: `${ai.provider} · ${ai.model}`,
  }
}

function describeTelegram(telegram: TelegramStatus | null, now: Timestamp): SourceDescription {
  const base = { id: 'telegram' as const, name: NAMES.telegram, checkedAt: now }
  if (telegram === null) {
    return { ...base, status: 'unavailable', capabilities: [], detail: 'Desktop only.' }
  }
  if (!telegram.configured) {
    return { ...base, status: 'requiresSetup', capabilities: [], detail: 'No bot token saved.' }
  }
  if (telegram.lastError !== null) {
    return { ...base, status: 'error', capabilities: [], detail: 'The bot reported an error.' }
  }
  if (!telegram.running) {
    return { ...base, status: 'disconnected', capabilities: [], detail: 'Stopped.' }
  }
  if (telegram.authorizedChatId === null) {
    return {
      ...base,
      status: 'requiresSetup',
      capabilities: [],
      detail: 'Running — waiting for a chat to be approved.',
    }
  }
  return {
    ...base,
    status: 'connected',
    // Commands from the approved chat: capture, `/today`-style reads, and the
    // task commands the executor already runs.
    capabilities: ['capture', 'read', 'write'],
    detail: telegram.botUsername === null ? 'Bot running.' : `@${telegram.botUsername}`,
  }
}

function describeMcp(mcp: SourceInputs['mcp']): SourceDescription {
  const base = { id: 'mcp' as const, name: NAMES.mcp }
  if (!mcp.supported) {
    return {
      ...base,
      status: 'unavailable',
      capabilities: [],
      detail: 'Desktop only — the snapshot is written by the desktop app.',
      checkedAt: null,
    }
  }
  return {
    ...base,
    // Never `connected`: the file is written, and that is all this process knows.
    status: 'available',
    capabilities: ['read'],
    detail:
      mcp.publishedAt === null
        ? 'Read-only snapshot, not published yet.'
        : 'Read-only snapshot for a local MCP server.',
    checkedAt: mcp.publishedAt,
  }
}

/**
 * Every source, described from its integration's own report. Pure.
 *
 * In `SOURCE_IDS` order, always all of them: a source that cannot be used says
 * so with its status, rather than disappearing and leaving the reader to guess.
 */
export function describeSources(input: SourceInputs): SourceDescription[] {
  const { now, failed } = input
  const described: Record<SourceId, SourceDescription> = {
    vaultwork: describeVaultwork(now),
    obsidian:
      failed.has('obsidian') || input.vault === null
        ? unreadable('obsidian', now)
        : describeObsidian(input.vault, now),
    assistant: failed.has('assistant')
      ? unreadable('assistant', now)
      : describeAssistant(input.ai, now),
    mcp: describeMcp(input.mcp),
    telegram: failed.has('telegram')
      ? unreadable('telegram', now)
      : describeTelegram(input.telegram, now),
  }
  return SOURCE_IDS.map((id) => described[id])
}

/**
 * Reads one integration's status and describes it.
 *
 * One source at a time, on purpose. A status call that never answers — a
 * bridge that is wedged, a keychain prompt nobody clicks — must cost exactly
 * one row its answer and nothing else, the same rule Settings already keeps
 * for Telegram. Never throws: a status call that fails is an `error` row.
 */
async function readSource(id: SourceId): Promise<SourceDescription> {
  const now = platform.clock.now()
  try {
    switch (id) {
      case 'vaultwork':
        return describeVaultwork(now)
      case 'obsidian':
        return describeObsidian(await getVaultStatus(), now)
      case 'assistant':
        return describeAssistant(platform.ai.isAvailable ? await platform.ai.status() : null, now)
      case 'mcp':
        return describeMcp({
          supported: platform.desktop.isSupported,
          publishedAt: getMcpSnapshotPublishedAt(),
        })
      case 'telegram':
        return describeTelegram(
          platform.telegram.isSupported ? await platform.telegram.status() : null,
          now,
        )
    }
  } catch {
    return unreadable(id, now)
  }
}

/**
 * Every source at once, for callers that can wait for all of them.
 *
 * Settings does not use this: it reads each source separately, so that one
 * that hangs holds up its own row and nothing else.
 */
export async function getSources(): Promise<SourceDescription[]> {
  return Promise.all(SOURCE_IDS.map(readSource))
}

export class UnknownSourceError extends Error {
  constructor(id: string) {
    super(`“${id}” is not a source Vaultwork knows.`)
    this.name = 'UnknownSourceError'
  }
}

export const isSourceId = (value: unknown): value is SourceId =>
  typeof value === 'string' && (SOURCE_IDS as readonly string[]).includes(value)

/** One source, by id. An id outside the closed list is refused, not looked up. */
export async function getSource(id: string): Promise<SourceDescription> {
  if (!isSourceId(id)) throw new UnknownSourceError(id)
  return readSource(id)
}
