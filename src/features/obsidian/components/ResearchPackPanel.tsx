import { Link } from 'react-router-dom'
import { PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { Id } from '@/types/entities'
import { useResearchPack } from '../hooks/useObsidian'

/**
 * A project's research pack, for NotebookLM (M18.2).
 *
 * One action and its outcome. The pack is written into the vault's hidden
 * `.vaultwork/research-packs` folder, and the result names that folder and the
 * PDFs to upload alongside — there is no NotebookLM API to hand it to, so the
 * honest thing is to say exactly where it is.
 */
export function ResearchPackPanel({ projectId }: { projectId: Id }) {
  const { connected, busy, error, result, create } = useResearchPack(projectId)

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 t-eyebrow text-ink-3">Research</h3>
        {connected ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void create()}>
            <PackageOpen size={12} aria-hidden />
            {busy ? 'Creating…' : 'Create research pack'}
          </Button>
        ) : null}
      </div>

      {connected === false ? (
        <p className="text-body text-ink-3">
          <Link to="/obsidian" className="text-ink-2 underline-offset-2 hover:underline">
            Connect an Obsidian vault
          </Link>{' '}
          to bundle this project&apos;s notes for NotebookLM.
        </p>
      ) : result === null && error === null ? (
        <p className="text-body text-ink-3">
          Bundles this project&apos;s linked notes and the PDFs they cite, with provenance, for
          NotebookLM.
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <div role="status" className="flex flex-col gap-0.5 text-body text-ink-2">
          <p>
            {result.notes} {result.notes === 1 ? 'note' : 'notes'} written to{' '}
            <code className="font-mono text-meta">{result.folder}</code>
          </p>
          {result.documents.length > 0 ? (
            <p className="text-meta text-ink-3">
              Upload alongside: {result.documents.map((document) => document.title).join(', ')}
            </p>
          ) : null}
          {result.omitted.notes > 0 || result.omitted.documents > 0 ? (
            <p className="text-meta text-ink-3">
              {result.omitted.notes} notes and {result.omitted.documents} documents exceeded the
              pack&apos;s limits.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
