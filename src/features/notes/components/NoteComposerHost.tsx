import { useNavigate } from 'react-router-dom'
import { useCommands } from '@/hooks/useCommands'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { RefType } from '@/types/enums'
import { NoteComposer } from './NoteComposer'

/**
 * Mounts the note composer once, at the shell.
 *
 * Quick capture has to work on every screen, so the dialog cannot belong to the
 * Notes route — it lives here, driven by the store that Shift+N writes to. That
 * is also what lets a task or goal panel open it pre-linked to whatever the
 * user was looking at.
 */
export function NoteComposerHost() {
  const navigate = useNavigate()
  const { dispatch, pending } = useCommands()

  const open = useNoteUiStore((s) => s.composerOpen)
  const link = useNoteUiStore((s) => s.composerLink)
  const close = useNoteUiStore((s) => s.closeComposer)

  if (!open) return null

  return (
    <NoteComposer
      busy={pending}
      onCancel={close}
      onSubmit={async (value) => {
        const result = await dispatch({
          kind: 'note.add',
          source: 'ui',
          raw: '',
          title: value.title,
          body: value.body,
          tagIds: [],
          links: link === null ? [] : [{ refType: link.refType as RefType, refId: link.refId }],
          knowledgeKind: value.knowledgeKind,
        })

        close()
        // "Create and open" goes straight into the editor; plain "Create" stays
        // where you were, which is the whole point of capturing from elsewhere.
        if (value.open && result.status === 'ok' && result.kind === 'note') {
          navigate(`/notes/${result.note.id}`)
        }
      }}
    />
  )
}
