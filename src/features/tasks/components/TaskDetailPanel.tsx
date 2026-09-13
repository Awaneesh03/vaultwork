import { useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { SkeletonRows } from '@/components/feedback/Skeleton'
import { BacklinksPanel } from '@/features/notes/components/BacklinksPanel'
import { useBacklinks } from '@/features/notes/hooks/useNotes'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import { useNoteUiStore } from '@/store/noteUiStore'
import type { Id, Subtask, Tag } from '@/types/entities'
import { useTaskDetail } from '../hooks/useTaskDetail'
import { emptyComposerValue, toTaskFields, type ComposerValue } from '../composerValue'
import { TaskComposer } from './TaskComposer'

/**
 * The task detail sheet.
 *
 * Every write leaves through `useCommands` as a CommandIntent, so editing a
 * task here goes down exactly the same pipeline as `/add` from a message: no
 * second code path, no direct service call, no repository import.
 *
 * Subtask operations are dispatched one at a time rather than diffed on save,
 * because each is a real event — checking an item is a fact worth recording
 * when it happened, not when the form was closed.
 */

export interface TaskDetailPanelProps {
  taskId: Id | null
  onClose: () => void
  onCreateTag?: (name: string) => Promise<Tag | null>
}

export function TaskDetailPanel({ taskId, onClose, onCreateTag }: TaskDetailPanelProps) {
  const detail = useTaskDetail(taskId)
  const backlinks = useBacklinks('task', taskId)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)
  const { dispatch, pending } = useCommands()
  const [value, setValue] = useState<ComposerValue>(emptyComposerValue)

  const loaded = detail ?? null

  // The form is seeded from the row and then owned by the user. Re-seeding on
  // every live-query tick would overwrite whatever they were halfway through
  // typing, so this keys on the task's identity alone.
  const seed = useMemo(() => {
    if (!loaded) return null
    const { task } = loaded
    return {
      ...emptyComposerValue(),
      title: task.title,
      description: task.description ?? '',
      dueDate: task.dueDate ?? '',
      dueTime: task.dueTime ?? '',
      priority: task.priority,
      projectId: task.projectId,
      tagIds: task.tagIds,
      estimate: task.estimateMin === null ? '' : String(task.estimateMin),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.task.id])

  useEffect(() => {
    if (seed) setValue(seed)
  }, [seed])

  if (!taskId) return null

  const save = async () => {
    if (!loaded) return
    const fields = toTaskFields(value)
    if (fields.title.length === 0) return
    await dispatch(
      {
        kind: 'task.update',
        source: 'ui',
        raw: '',
        taskId: loaded.task.id,
        patch: {
          title: fields.title,
          description: fields.description,
          dueDate: fields.dueDate,
          dueTime: fields.dueTime,
          priority: fields.priority,
          projectId: fields.projectId,
          tagIds: fields.tagIds,
          estimateMin: fields.estimateMin,
        },
      },
      { notify: 'errors' },
    )
    onClose()
  }

  const subtaskOps = loaded
    ? {
        onAddSubtask: (title: string) =>
          void dispatch(
            { kind: 'subtask.add', source: 'ui', raw: '', taskId: loaded.task.id, title },
            { notify: 'errors' },
          ),
        onToggleSubtask: (subtask: Subtask) =>
          void dispatch(
            { kind: 'subtask.toggle', source: 'ui', raw: '', subtaskId: subtask.id },
            { notify: 'errors' },
          ),
        onDeleteSubtask: (subtask: Subtask) =>
          void dispatch({ kind: 'subtask.delete', source: 'ui', raw: '', subtaskId: subtask.id }),
        onMoveSubtask: (fromIndex: number, toIndex: number) =>
          void dispatch(
            {
              kind: 'subtask.move',
              source: 'ui',
              raw: '',
              taskId: loaded.task.id,
              fromIndex,
              toIndex,
            },
            { notify: 'errors' },
          ),
      }
    : {}

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close task"
        className="absolute inset-0 bg-black/25"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        className={cn(
          'relative flex h-full w-full max-w-md flex-col border-l border-line bg-elevated shadow-xl',
          'animate-[panel-in_var(--duration-base)_var(--ease-out)]',
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <h2 className="flex-1 text-strong font-semibold tracking-tight">Task</h2>

          {loaded ? (
            <button
              type="button"
              onClick={() => {
                void dispatch({
                  kind: 'task.delete',
                  source: 'ui',
                  raw: '',
                  ref: { by: 'id', id: loaded.task.id },
                })
                onClose()
              }}
              aria-label="Delete task"
              className="rounded-md p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {detail === undefined ? (
            <SkeletonRows rows={5} />
          ) : detail === null ? (
            <p className="text-strong text-ink-3">That task is no longer here.</p>
          ) : (
            <TaskComposer
              mode="edit"
              value={value}
              onChange={setValue}
              tags={detail.allTags}
              projects={detail.allProjects}
              subtasks={detail.subtasks}
              busy={pending}
              {...(onCreateTag ? { onCreateTag } : {})}
              {...subtaskOps}
              onSubmit={() => void save()}
              onCancel={onClose}
            />
          )}

          {detail ? (
            <BacklinksPanel
              className="mt-5 border-t border-line pt-4"
              backlinks={backlinks}
              onCreate={() => openNoteComposer({ refType: 'task', refId: detail.task.id })}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
