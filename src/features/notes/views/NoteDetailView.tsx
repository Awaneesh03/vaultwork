import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArchiveRestore,
  ArrowLeft,
  FileText,
  FolderTree,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import { formatEventTime } from '@/lib/date'
import { NoteObsidianPanel } from '@/features/obsidian/components/NoteObsidianPanel'
import { useNoteObsidian, useVaultConnection } from '@/features/obsidian/hooks/useObsidian'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { Id } from '@/types/entities'
import type { RefType } from '@/types/enums'
import { EditorModeSwitch, NoteEditor } from '../components/NoteEditor'
import { NoteLinkPicker } from '../components/NoteLinkPicker'
import { useAutosave } from '../hooks/useAutosave'
import { useLinkCandidates, useNoteDetail } from '../hooks/useNotes'
import { useNoteKnowledge } from '../hooks/useKnowledge'
import { NoteKnowledgePanel } from '../components/NoteKnowledgePanel'

/**
 * One note: the editor, its links, and where it will live in the vault.
 *
 * There is no save button. The title and body are debounced through
 * `useAutosave`, which flushes on blur and on unmount so navigating away cannot
 * lose the last few characters. The save indicator is the only feedback, and it
 * is deliberately quiet — a toast every 500 ms would be unusable.
 */

interface Draft {
  title: string
  body: string
}

export function NoteDetailView() {
  const { noteId = null } = useParams<{ noteId: string }>()
  const navigate = useNavigate()
  const { dispatch } = useCommands()

  const detail = useNoteDetail(noteId)
  const candidates = useLinkCandidates()
  // Derived on read from the note bodies — nothing about it is stored.
  const knowledge = useNoteKnowledge(noteId)
  const mode = useNoteUiStore((s) => s.mode)
  const setMode = useNoteUiStore((s) => s.setMode)

  const [title, setTitle] = useState('')
  const [adoptedId, setAdoptedId] = useState<string | null>(null)
  const [suggestedPath, setSuggestedPath] = useState<string | null>(null)

  const vault = useVaultConnection()
  const connected = vault.status?.state === 'connected'
  const obsidian = useNoteObsidian(noteId, connected)

  // The suggested path is derived from the title and tags, so it is recomputed
  // when the note changes — never on every render, and never by touching a file.
  useEffect(() => {
    let cancelled = false
    if (noteId === null || !connected) {
      setSuggestedPath(null)
      return
    }
    void obsidian
      .suggestPath()
      .then((path) => {
        if (!cancelled) setSuggestedPath(path)
      })
      .catch(() => {
        if (!cancelled) setSuggestedPath(null)
      })
    return () => {
      cancelled = true
    }
    // `obsidian` is rebuilt each render; the inputs that matter are these two
    // plus the note's own updatedAt, which changes when the title does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, connected, detail?.note.updatedAt])

  // The saved values, as the baseline the autosave compares against.
  const saved = useMemo<Draft>(
    () => ({ title: detail?.note.title ?? '', body: detail?.note.body ?? '' }),
    [detail?.note.title, detail?.note.body],
  )

  const save = useCallback(
    async (draft: Draft) => {
      if (noteId === null) return
      await dispatch(
        {
          kind: 'note.update',
          source: 'ui',
          raw: '',
          noteId,
          patch: { title: draft.title, body: draft.body },
        },
        { notify: 'errors' },
      )
    },
    [dispatch, noteId],
  )

  const autosave = useAutosave<Draft>(
    noteId,
    saved,
    save,
    (a, b) => a.title === b.title && a.body === b.body,
  )

  // Adopt the stored title when the *identity* of the note changes, and never
  // on a later tick — a live query re-runs on every save, and re-adopting there
  // would overwrite what is being typed. Adjusting state during render is
  // React's own answer to this; an effect keyed on the title would fight the
  // user, and one keyed on the id would need its dependency list silenced.
  if (detail && adoptedId !== detail.note.id) {
    setAdoptedId(detail.note.id)
    setTitle(detail.note.title)
  }

  const link = useCallback(
    (refType: RefType, refId: Id) => {
      if (noteId === null) return
      void dispatch({ kind: 'note.link', source: 'ui', raw: '', noteId, refType, refId })
    },
    [dispatch, noteId],
  )

  const unlink = useCallback(
    (refType: RefType, refId: Id) => {
      if (noteId === null) return
      void dispatch({ kind: 'note.unlink', source: 'ui', raw: '', noteId, refType, refId })
    },
    [dispatch, noteId],
  )

  if (detail === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    )
  }

  if (detail === null) {
    return (
      <EmptyState
        icon={<FileText size={20} aria-hidden />}
        title="No such note"
        description="It may have been permanently deleted."
        action={
          <Link to="/notes" className="text-body text-accent underline decoration-dotted">
            Back to notes
          </Link>
        }
      />
    )
  }

  const deleted = detail.note.deletedAt !== null

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/notes"
            className="inline-flex items-center gap-1 text-body text-ink-3 hover:text-accent"
          >
            <ArrowLeft size={12} aria-hidden />
            Notes
          </Link>
          <span className="flex-1" />
          <EditorModeSwitch mode={mode} onChange={setMode} />
          {deleted ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void dispatch({
                  kind: 'note.restore',
                  source: 'ui',
                  raw: '',
                  noteId: detail.note.id,
                })
              }
              icon={<ArchiveRestore size={12} aria-hidden />}
            >
              Restore
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                void dispatch({
                  kind: 'note.delete',
                  source: 'ui',
                  raw: '',
                  ref: { by: 'id', id: detail.note.id },
                })
                navigate('/notes')
              }}
              icon={<Trash2 size={12} aria-hidden />}
            >
              Delete
            </Button>
          )}
        </div>

        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            autosave.change({ title: event.target.value, body: detail.note.body })
          }}
          onBlur={autosave.flush}
          placeholder="Untitled note"
          aria-label="Note title"
          className={cn(
            'w-full rounded-md border border-transparent bg-transparent px-1 py-1',
            'text-display font-semibold tracking-tight text-ink',
            'placeholder:text-ink-3 hover:border-line focus:border-accent-line focus:bg-surface',
          )}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-meta text-ink-3">
          <span>Edited {formatEventTime(detail.note.updatedAt, detail.now, detail.today)}</span>
          {detail.tags.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <TagIcon size={10} aria-hidden />
              {detail.tags.map((tag) => tag.name).join(', ')}
            </span>
          ) : null}
          {detail.note.vaultPath ? (
            <span
              className="inline-flex items-center gap-1 font-mono text-micro"
              title="Where this note will live in your Obsidian vault"
            >
              <FolderTree size={10} aria-hidden />
              {detail.note.vaultPath}
            </span>
          ) : null}
          {deleted ? (
            <span className="rounded-sm bg-sunken px-1.5 py-px text-micro">Deleted</span>
          ) : null}
        </div>
      </header>

      <NoteEditor
        body={detail.note.body}
        mode={mode}
        saveState={autosave.state}
        onChange={(body) => autosave.change({ title, body })}
        onBlur={autosave.flush}
      />

      <NoteLinkPicker
        links={detail.links}
        candidates={candidates ?? []}
        onAttach={link}
        onDetach={unlink}
      />

      <NoteKnowledgePanel
        className="border-t border-line pt-4"
        knowledge={knowledge}
        onOpenNote={(id) => navigate(`/notes/${id}`)}
      />

      <NoteObsidianPanel
        className="border-t border-line pt-4"
        connected={connected}
        report={obsidian.report}
        busy={obsidian.busy}
        error={obsidian.error}
        message={obsidian.message}
        suggestedPath={suggestedPath}
        onExport={(options) => void obsidian.exportToVault(options)}
        onImport={(options) => void obsidian.importFromVault(options)}
        onRefresh={() => void obsidian.refresh()}
        onRename={(path) => void obsidian.renameTo(path)}
        onDelete={() => void obsidian.deleteFile()}
      />
    </section>
  )
}
