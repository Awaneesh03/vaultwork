import { KNOWLEDGE_KINDS, PROVENANCE_SOURCES } from '@/types/enums'
import type { KnowledgeKind, ProvenanceSource } from '@/types/enums'
import type { Provenance } from '@/types/entities'
import { normalizeContent } from './content'
import { slugify } from './vaultPath'
import { formatWikilink } from './wikilinks'

/**
 * Knowledge artifacts in Obsidian (M18.2) — the pure half.
 *
 * Vaultwork owns actions; Obsidian owns knowledge. A knowledge artifact is an
 * ordinary note that the user has chosen to keep as something durable — a
 * brief, a decision, a review — and this module is everything about that which
 * can be decided without touching a disk: what each kind looks like when it is
 * first created, what provenance is allowed to say, and what a research pack
 * is made of.
 *
 * No I/O, no persistence, no clock. The service layer supplies every value.
 */

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  brief: 'Brief',
  decision: 'Decision',
  meeting: 'Meeting note',
  research: 'Research',
  learning: 'Learning',
  review: 'Review',
  synthesis: 'Synthesis',
}

export const PROVENANCE_SOURCE_LABELS: Record<ProvenanceSource, string> = {
  user: 'You',
  vaultwork: 'Vaultwork',
  email: 'Email',
  calendar: 'Calendar',
  web: 'Web',
  claude: 'Claude',
  notebooklm: 'NotebookLM',
}

export const isKnowledgeKind = (value: unknown): value is KnowledgeKind =>
  typeof value === 'string' && (KNOWLEDGE_KINDS as readonly string[]).includes(value)

export const isProvenanceSource = (value: unknown): value is ProvenanceSource =>
  typeof value === 'string' && (PROVENANCE_SOURCES as readonly string[]).includes(value)

/** ISO-8601 in UTC — the same instant format `noteFile` writes `created` in. */
const iso = (at: number) => new Date(at).toISOString()

// ----------------------------------------------------------------- templates

/**
 * The sections each kind starts with.
 *
 * A scaffold, not a schema. It is written once, into an empty body, and from
 * then on the body is the user's: nothing re-applies it, validates against it
 * or complains when a heading is renamed. Plain `##` headings because that is
 * what Obsidian's outline, NotebookLM and a human reader all understand.
 */
export const KNOWLEDGE_SECTIONS: Record<KnowledgeKind, readonly string[]> = {
  brief: ['Goal', 'Scope', 'Constraints', 'Open questions'],
  decision: ['Context', 'Decision', 'Reasoning', 'Consequences'],
  meeting: ['Attendees', 'Notes', 'Decisions', 'Follow-ups'],
  research: ['Question', 'Findings', 'Sources', 'Open questions'],
  learning: ['Summary', 'Key ideas', 'Examples', 'To revisit'],
  review: ['What went well', 'What did not', 'What changes next'],
  synthesis: ['Summary', 'Supporting points', 'Gaps'],
}

/**
 * The starting body for a new artifact.
 *
 * `related` are the titles of what the artifact is about — a project, a goal —
 * written as wikilinks so Obsidian's graph groups every artifact about the same
 * project together. They may not resolve to a file, and that is fine: an
 * unresolved link is how Obsidian names a topic that has no page yet.
 */
export function knowledgeBody(kind: KnowledgeKind, related: readonly string[] = []): string {
  const sections = KNOWLEDGE_SECTIONS[kind].map((heading) => `## ${heading}\n`)
  const links = [...new Set(related.map((title) => title.trim()).filter(Boolean))]
  if (links.length > 0) {
    sections.push(`## Related\n\n${links.map((title) => `- ${formatWikilink(title)}`).join('\n')}`)
  }
  return normalizeContent(sections.join('\n'))
}

// ---------------------------------------------------------------- provenance

const MAX_SOURCE_ID = 200
const MAX_SOURCE_URL = 2000

/**
 * Query parameters that carry a credential rather than an address.
 *
 * A provenance URL is written into a Markdown file anyone with the vault can
 * read, and a link copied from a browser bar is exactly where an OAuth code or
 * a signed-URL token hides. The address is kept; the secret is not.
 */
const SECRET_PARAM =
  /^(access_?token|refresh_?token|id_?token|token|auth|authorization|code|key|api_?key|secret|client_?secret|password|passwd|pwd|session|sessionid|sig|signature|x-amz-[a-z-]+|x-goog-[a-z-]+)$/i

/**
 * Makes a provenance safe to store and to write into a file.
 *
 * Returns `null` for anything that is not a usable provenance rather than
 * throwing: provenance is metadata about a note, and an unusable one must cost
 * the note its provenance, never the note itself.
 */
export function sanitizeProvenance(input: unknown): Provenance | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  const source = raw['source']
  if (!isProvenanceSource(source)) return null
  const capturedAt = raw['capturedAt']

  return {
    source,
    sourceId: cleanText(raw['sourceId'], MAX_SOURCE_ID),
    sourceUrl: cleanUrl(raw['sourceUrl']),
    capturedAt: typeof capturedAt === 'number' && Number.isFinite(capturedAt) ? capturedAt : null,
  }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // Control characters would break the frontmatter line they are written into.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text.length === 0 ? null : text.slice(0, max)
}

/**
 * An http(s) URL with no credential in it, or `null`.
 *
 * `javascript:`, `file:` and `data:` are refused outright — a provenance link
 * is clicked in Obsidian, and none of those is somewhere a click should go.
 * Userinfo (`https://user:pass@host`) is a credential in the address itself, so
 * such a URL is dropped whole rather than repaired.
 */
function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, MAX_SOURCE_URL)
  if (text === null) return null

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '') return null

  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.delete(name)
  }
  // A fragment can carry an implicit-flow access token (`#access_token=…`).
  if (/token|code|key|secret/i.test(url.hash)) url.hash = ''

  return url.toString()
}

// ------------------------------------------------------------- research pack

/**
 * The per-pack ceilings.
 *
 * A research pack is a curated bundle, and NotebookLM caps how many sources a
 * notebook takes. Fifty notes is well above a real project's knowledge and
 * well below a dump of the database.
 */
export const RESEARCH_PACK_LIMITS = { notes: 50, documents: 50 } as const

/**
 * Where packs are written, inside the vault.
 *
 * A dot-folder on purpose. Obsidian does not index it, so a pack's copies never
 * appear twice in the user's search or graph; Vaultwork's own scan already
 * skips it (`IGNORED_DIRECTORIES` treats every dot-folder as ignored), so the
 * copies are never offered for import either.
 */
export const RESEARCH_PACK_ROOT = '.vaultwork/research-packs'

export interface ResearchPackNote {
  title: string
  body: string
  kind: KnowledgeKind | null
  provenance: Provenance | null
  vaultPath: string | null
  updatedAt: number
}

export interface ResearchPackDocument {
  title: string
  vaultPath: string
}

export interface ResearchPackInput {
  project: {
    name: string
    status: string
    deadline: string | null
    progress: number
    remaining: number
  }
  notes: ResearchPackNote[]
  documents: ResearchPackDocument[]
  generatedAt: number
}

export interface ResearchPackFile {
  /** Relative to the pack's own folder. */
  name: string
  contents: string
}

export interface ResearchPack {
  /** The pack's folder, vault-relative. */
  folder: string
  files: ResearchPackFile[]
  /** Documents to upload alongside, by vault path — binaries are not copied. */
  documents: ResearchPackDocument[]
  /** What the ceilings left out, so the manifest can say so. */
  omitted: { notes: number; documents: number }
}

/** `2026-09-21T09:30:00.000Z` → `20260921-0930`, a stamp a folder name can hold. */
function stamp(at: number): string {
  return iso(at).slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
}

function provenanceLine(provenance: Provenance | null): string {
  if (provenance === null) return 'Source: not recorded'
  const parts = [`Source: ${PROVENANCE_SOURCE_LABELS[provenance.source]}`]
  if (provenance.sourceUrl !== null) parts.push(provenance.sourceUrl)
  if (provenance.capturedAt !== null) parts.push(`captured ${iso(provenance.capturedAt)}`)
  return parts.join(' · ')
}

const kindLabel = (kind: KnowledgeKind | null) =>
  kind === null ? 'Note' : KNOWLEDGE_KIND_LABELS[kind]

/**
 * A folder of plain Markdown, ready to hand to NotebookLM.
 *
 * Deterministic in its input: the same project, notes and instant produce the
 * same files byte for byte. Each note becomes its own file — NotebookLM cites
 * by source, so one file per note keeps a citation pointing at the right note —
 * with its provenance stated in the text, because a source-grounded tool reads
 * the text and nothing else. `README.md` is the manifest: what the pack is,
 * where each piece came from, and which PDFs to upload with it.
 *
 * Vaultwork ids are not written. The pack is a copy for reading, not a synced
 * file, and an id would invite something to treat it as one.
 */
export function buildResearchPack(input: ResearchPackInput): ResearchPack {
  const notes = [...input.notes]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
    .slice(0, RESEARCH_PACK_LIMITS.notes)
  const documents = [...input.documents]
    .sort((a, b) => a.vaultPath.localeCompare(b.vaultPath))
    .slice(0, RESEARCH_PACK_LIMITS.documents)

  const folder = `${RESEARCH_PACK_ROOT}/${slugify(input.project.name)}-${stamp(input.generatedAt)}`

  // Numbered so the files sort in the manifest's order and never collide,
  // whatever two notes happen to be called.
  const noteFiles: ResearchPackFile[] = notes.map((note, index) => {
    const name = `${String(index + 1).padStart(2, '0')}-${slugify(note.title)}.md`
    const header = [
      `# ${note.title}`,
      '',
      `> ${kindLabel(note.kind)} · ${provenanceLine(note.provenance)}`,
      ...(note.vaultPath === null ? [] : [`> Obsidian: ${note.vaultPath}`]),
      '',
    ].join('\n')
    return { name, contents: normalizeContent(`${header}\n${note.body}`) }
  })

  const omitted = {
    notes: input.notes.length - notes.length,
    documents: input.documents.length - documents.length,
  }

  const { project } = input
  const readme = [
    `# Research pack — ${project.name}`,
    '',
    `Generated by Vaultwork on ${iso(input.generatedAt)}. Upload this folder's`,
    'Markdown files, and the documents listed below, to NotebookLM as sources.',
    '',
    '## Project',
    '',
    `- Status: ${project.status}`,
    `- Progress: ${project.progress}% (${project.remaining} open tasks)`,
    `- Deadline: ${project.deadline ?? 'none'}`,
    '',
    '## Notes',
    '',
    ...(noteFiles.length === 0
      ? ['No notes are linked to this project yet.']
      : notes.map(
          (note, index) =>
            `- \`${noteFiles[index]?.name ?? ''}\` — ${note.title} (${kindLabel(note.kind)}; ${provenanceLine(note.provenance)})`,
        )),
    '',
    '## Documents to upload',
    '',
    ...(documents.length === 0
      ? ['None cited.']
      : documents.map((document) => `- ${document.title} — \`${document.vaultPath}\``)),
    ...(omitted.notes > 0 || omitted.documents > 0
      ? [
          '',
          '## Left out',
          '',
          `${omitted.notes} notes and ${omitted.documents} documents exceeded the pack's limits.`,
        ]
      : []),
  ].join('\n')

  return {
    folder,
    files: [{ name: 'README.md', contents: normalizeContent(readme) }, ...noteFiles],
    documents,
    omitted,
  }
}
