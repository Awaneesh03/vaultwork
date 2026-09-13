import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ListChecks,
  Pencil,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { BacklinksPanel } from '@/features/notes/components/BacklinksPanel'
import { useBacklinks } from '@/features/notes/hooks/useNotes'
import { useCommands } from '@/hooks/useCommands'
import { useNoteUiStore } from '@/store/noteUiStore'
import { cn } from '@/lib/cn'
import { formatDayLabel, formatEstimate } from '@/lib/date'
import type { ProjectDetailData, TaskPatch } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import type { Id, Task } from '@/types/entities'
import type { Priority } from '@/types/enums'
import { toTaskFields, type ComposerValue } from '@/features/tasks/composerValue'
import { QuickAddBar } from '@/features/tasks/components/QuickAddBar'
import { ReschedulePopover } from '@/features/tasks/components/ReschedulePopover'
import { TaskDetailPanel } from '@/features/tasks/components/TaskDetailPanel'
import { TaskList } from '@/features/tasks/components/TaskList'
import { TaskToolbar } from '@/features/tasks/components/TaskToolbar'
import { useTagActions } from '@/features/tasks/hooks/useTagActions'
import { useTaskListShortcuts } from '@/features/tasks/hooks/useTaskListShortcuts'
import { ProjectComposer } from '../components/ProjectComposer'
import { ProjectProgress } from '../components/ProjectProgress'
import { ProjectTaskPicker } from '../components/ProjectTaskPicker'
import { useProjectDetail } from '../hooks/useProjectDetail'
import { PROJECT_STATUS_LABELS, projectColorVar, projectIcon } from '../projectAppearance'
import { toProjectPatch, type ProjectFormValue } from '../projectFormValue'

/**
 * One project, and the work filed under it.
 *
 * The task half of this screen is **entirely** the M3 task system:
 * `QuickAddBar`, `TaskToolbar`, `TaskList`, `TaskDetailPanel`,
 * `useTaskListShortcuts`, `taskUiStore` and the same CommandIntents. Not one
 * task behaviour is reimplemented here — a project is a filter over tasks, not
 * a different kind of thing that happens to contain them.
 *
 * The one thing this screen adds is the default project: anything captured here
 * is filed under this project without the user typing `@name`, which is done by
 * putting `defaultProjectId` on the `task.add` intent rather than by
 * post-processing the created task.
 */

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[76px] w-full" />
      <Skeleton className="h-[38px] w-full" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[var(--row-height)] w-full" />
      ))}
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'warn'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <span className="t-eyebrow text-ink-3">{label}</span>
      <span
        className={cn(
          'tabular text-[15px] font-semibold leading-tight',
          tone === 'warn' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function ProjectDetailView() {
  const { projectId } = useParams<{ projectId: string }>()
  const data = useProjectDetail(projectId)
  const navigate = useNavigate()
  const { dispatch, run, pending } = useCommands()
  const tagActions = useTagActions()

  const filter = useTaskUiStore((s) => s.filter)
  const sort = useTaskUiStore((s) => s.sort)
  const direction = useTaskUiStore((s) => s.direction)
  const selectedTaskId = useTaskUiStore((s) => s.selectedTaskId)
  const openTaskId = useTaskUiStore((s) => s.openTaskId)
  const quickAddOpen = useTaskUiStore((s) => s.quickAddOpen)
  const focusNonce = useTaskUiStore((s) => s.searchFocusNonce)

  const select = useTaskUiStore((s) => s.select)
  const openTask = useTaskUiStore((s) => s.openTask)
  const setQuickAddOpen = useTaskUiStore((s) => s.setQuickAddOpen)
  const clearFilter = useTaskUiStore((s) => s.clearFilter)
  const resetForView = useTaskUiStore((s) => s.resetForView)
  const setSearch = useTaskUiStore((s) => s.setSearch)
  const togglePriority = useTaskUiStore((s) => s.togglePriority)
  const setDue = useTaskUiStore((s) => s.setDue)
  const setProjectId = useTaskUiStore((s) => s.setProjectId)
  const toggleTag = useTaskUiStore((s) => s.toggleTag)
  const setTagMode = useTaskUiStore((s) => s.setTagMode)
  const setHasEstimate = useTaskUiStore((s) => s.setHasEstimate)
  const setSort = useTaskUiStore((s) => s.setSort)

  const composer = useProjectUiStore((s) => s.composer)
  const openEdit = useProjectUiStore((s) => s.openEdit)
  const closeComposer = useProjectUiStore((s) => s.closeComposer)
  const pickerProjectId = useProjectUiStore((s) => s.pickerProjectId)
  const openPicker = useProjectUiStore((s) => s.openPicker)
  const closePicker = useProjectUiStore((s) => s.closePicker)

  const [rescheduling, setRescheduling] = useState<Task | null>(null)

  // The task filter is shared with the six views, so it has to be cleared on
  // the way in — arriving here with Today's "urgent only" still on would make
  // a full project look empty.
  useEffect(() => {
    resetForView()
    closeComposer()
    closePicker()
  }, [projectId, resetForView, closeComposer, closePicker])

  const project = data?.project ?? null
  const backlinks = useBacklinks('project', projectId ?? null)
  const openNoteComposer = useNoteUiStore((s) => s.openComposer)
  const tasksOnScreen = data?.tasks ?? []
  const modalOpen = composer.mode !== 'closed' || pickerProjectId !== null

  const toggle = useCallback(
    (task: Task) =>
      void dispatch(
        { kind: 'task.toggle', source: 'ui', raw: '', ref: { by: 'id', id: task.id } },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const remove = useCallback(
    (task: Task) =>
      void dispatch({ kind: 'task.delete', source: 'ui', raw: '', ref: { by: 'id', id: task.id } }),
    [dispatch],
  )

  const prioritise = useCallback(
    (task: Task, priority: Priority) =>
      void dispatch(
        {
          kind: 'task.prioritize',
          source: 'ui',
          raw: '',
          ref: { by: 'id', id: task.id },
          priority,
        },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const move = useCallback(
    (orderedIds: Id[], fromIndex: number, toIndex: number) =>
      void dispatch(
        { kind: 'task.move', source: 'ui', raw: '', orderedIds, fromIndex, toIndex },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const assign = useCallback(
    (taskId: Id, target: Id | null) =>
      void dispatch({
        kind: 'task.assignProject',
        source: 'ui',
        raw: '',
        taskId,
        projectId: target,
      }),
    [dispatch],
  )

  useTaskListShortcuts({
    tasks: tasksOnScreen,
    selectedTaskId,
    enabled: openTaskId === null && rescheduling === null && !modalOpen,
    onSelect: select,
    onToggle: toggle,
    onEdit: (task) => openTask(task.id),
    onDelete: remove,
    onPriority: prioritise,
    onSchedule: setRescheduling,
    onFocus: (task) => navigate(`/focus?task=${task.id}`),
    onEscape: () => {
      if (selectedTaskId) select(null)
      else setQuickAddOpen(false)
    },
  })

  /** Quick add, with this project as the implicit destination. */
  const submitText = async (text: string) => {
    if (!project) return false
    const result = await run(text, 'quickadd', { defaultProjectId: project.id })
    return result.status === 'ok'
  }

  const submitForm = async (value: ComposerValue) => {
    if (!project) return false
    const fields = toTaskFields(value)
    if (fields.title.length === 0) return false

    const result = await dispatch({
      kind: 'task.add',
      source: 'ui',
      raw: '',
      tokens: [],
      defaultProjectId: project.id,
      draft: {
        title: fields.title,
        description: fields.description,
        dueDate: fields.dueDate,
        dueTime: fields.dueTime,
        priority: fields.priority,
        projectName: null,
        tagNames: [],
        estimateMin: fields.estimateMin,
        subtasks: value.draftSubtasks,
      },
    })

    if (result.status !== 'ok' || result.kind !== 'task') return false

    const patch: TaskPatch = {}
    // The composer's project select wins over the screen's default: choosing a
    // different project in the form is an explicit instruction.
    if (fields.projectId && fields.projectId !== project.id) patch.projectId = fields.projectId
    if (fields.tagIds.length > 0) patch.tagIds = fields.tagIds
    if (Object.keys(patch).length > 0) {
      await dispatch(
        { kind: 'task.update', source: 'ui', raw: '', taskId: result.task.id, patch },
        { notify: 'errors' },
      )
    }
    return true
  }

  const saveProject = async (value: ProjectFormValue) => {
    if (!project) return
    const patch = toProjectPatch(value, project)
    if (Object.keys(patch).length === 0) {
      closeComposer()
      return
    }
    const result = await dispatch({
      kind: 'project.update',
      source: 'ui',
      raw: '',
      projectId: project.id,
      patch,
    })
    if (result.status === 'ok') closeComposer()
  }

  const archive = () => {
    if (!project) return
    void dispatch(
      project.status === 'archived'
        ? { kind: 'project.unarchive', source: 'ui', raw: '', projectId: project.id }
        : { kind: 'project.archive', source: 'ui', raw: '', ref: { by: 'id', id: project.id } },
    )
  }

  const deleteProject = () => {
    if (!project) return
    void dispatch({
      kind: 'project.delete',
      source: 'ui',
      raw: '',
      ref: { by: 'id', id: project.id },
    }).then((result) => {
      // The project is gone from every list, so staying on its page would show
      // a "no such project" screen. The undo lives in the toast.
      if (result.status === 'ok') navigate('/projects')
    })
  }

  const activeFilterCount =
    filter.priorities.length +
    filter.tagIds.length +
    (filter.due === 'any' ? 0 : 1) +
    (filter.hasEstimate === 'any' ? 0 : 1) +
    (filter.search.trim().length > 0 ? 1 : 0)

  if (data === null) {
    return (
      <section className="flex flex-col gap-4">
        <Link
          to="/projects"
          className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink"
        >
          <ArrowLeft size={13} aria-hidden />
          All projects
        </Link>
        <EmptyState
          icon={<ListChecks size={20} aria-hidden />}
          title="No such project"
          description="It may have been deleted. Its tasks were not — look in All Tasks."
        />
      </section>
    )
  }

  const Icon = project ? projectIcon(project.icon) : ListChecks
  const accent = project ? projectColorVar(project.color) : 'var(--accent)'

  return (
    <section className="flex flex-col gap-4">
      <Link
        to="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={13} aria-hidden />
        All projects
      </Link>

      <DataView<ProjectDetailData> data={data ?? undefined} loading={<DetailSkeleton />}>
        {(value) => (
          <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  aria-hidden
                  className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
                    color: accent,
                  }}
                >
                  <Icon size={15} />
                </span>
                <h2 className="min-w-0 text-[19px] font-semibold tracking-tight text-ink">
                  {value.project.name}
                </h2>
                <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-0.5 text-[10.5px] text-ink-2">
                  {PROJECT_STATUS_LABELS[value.project.status]}
                </span>
                {value.project.deadline ? (
                  <span className="tabular shrink-0 text-[11.5px] text-ink-3">
                    due {formatDayLabel(value.project.deadline, value.today)}
                  </span>
                ) : null}
                <span className="hidden flex-1 sm:block" />

                {/* Wraps rather than shrinking: four labelled buttons are wider
                    than a phone, and `shrink-0` would clip the last one off the
                    edge instead of moving it to the next line. */}
                <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openPicker(value.project.id)}
                    icon={<ListChecks size={12} aria-hidden />}
                  >
                    Manage tasks
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(value.project.id)}
                    aria-label={`Edit ${value.project.name}`}
                    icon={<Pencil size={12} aria-hidden />}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={archive}
                    aria-label={
                      value.project.status === 'archived'
                        ? `Restore ${value.project.name}`
                        : `Archive ${value.project.name}`
                    }
                    icon={
                      value.project.status === 'archived' ? (
                        <ArchiveRestore size={12} aria-hidden />
                      ) : (
                        <Archive size={12} aria-hidden />
                      )
                    }
                  >
                    {value.project.status === 'archived' ? 'Restore' : 'Archive'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={deleteProject}
                    aria-label={`Delete ${value.project.name}`}
                    icon={<Trash2 size={12} aria-hidden />}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {value.project.description ? (
                <p className="max-w-prose text-[13px] text-ink-2">{value.project.description}</p>
              ) : null}

              {value.project.status === 'archived' ? (
                <p className="inline-flex w-fit items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2">
                  <Archive size={12} aria-hidden />
                  Archived. Every task below is still here, and restoring brings the project back as
                  it was.
                </p>
              ) : null}
            </header>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Tasks" value={String(value.stats.total)} />
              <Metric label="Done" value={String(value.stats.completed)} />
              <Metric label="Remaining" value={String(value.stats.remaining)} />
              <Metric
                label="Overdue"
                value={String(value.stats.overdue)}
                tone={value.stats.overdue > 0 ? 'warn' : 'plain'}
              />
            </div>

            <div className="flex items-center gap-2">
              <ProjectProgress
                percent={value.stats.progress}
                label={`${value.stats.completed} of ${value.stats.total} tasks complete in ${value.project.name}`}
                accent={accent}
                className="flex-1"
              />
              <span className="tabular shrink-0 text-[11.5px] text-ink-3">
                {value.stats.progress}%
              </span>
              {value.stats.remainingEstimateMin > 0 ? (
                <span className="tabular shrink-0 text-[11.5px] text-ink-3">
                  ≈ {formatEstimate(value.stats.remainingEstimateMin)} left
                </span>
              ) : null}
              {value.stats.overdue > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-danger">
                  <TriangleAlert size={11} aria-hidden />
                  {value.stats.overdue} overdue
                </span>
              ) : null}
            </div>

            <QuickAddBar
              today={value.today}
              tags={value.tags}
              projects={value.projects}
              defaultProjectId={value.project.id}
              busy={pending}
              autoFocus={quickAddOpen}
              onSubmitText={submitText}
              onSubmitForm={submitForm}
              onCreateTag={tagActions.create}
              onDismiss={() => setQuickAddOpen(false)}
            />

            <TaskToolbar
              view="all"
              filter={filter}
              sort={sort ?? 'manual'}
              direction={direction ?? 'asc'}
              tags={value.tags}
              projects={value.projects}
              activeCount={activeFilterCount}
              focusNonce={focusNonce}
              // The project *is* the filter; offering a project select here
              // would be two answers to the same question.
              hideProject
              onSearch={setSearch}
              onTogglePriority={togglePriority}
              onDue={setDue}
              onProject={setProjectId}
              onToggleTag={toggleTag}
              onTagMode={setTagMode}
              onEstimate={setHasEstimate}
              onSort={setSort}
              onClear={clearFilter}
            />

            {value.tasks.length === 0 ? (
              <EmptyState
                icon={<ListChecks size={20} aria-hidden />}
                title={
                  activeFilterCount > 0 ? 'Nothing matches those filters' : 'No tasks in here yet'
                }
                description={
                  activeFilterCount > 0
                    ? `${value.unfilteredCount} tasks are hidden by the filters above.`
                    : 'Capture one above — it lands in this project automatically. Or pull in tasks you already have.'
                }
                action={
                  activeFilterCount > 0 ? (
                    <button
                      type="button"
                      onClick={clearFilter}
                      className="text-[12.5px] text-accent underline decoration-dotted"
                    >
                      Clear filters
                    </button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openPicker(value.project.id)}
                      icon={<ListChecks size={12} aria-hidden />}
                    >
                      Add existing tasks
                    </Button>
                  )
                }
              />
            ) : (
              <div className="flex flex-col gap-5">
                {value.groups.map((group) => (
                  <section key={group.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2 px-2">
                      <h3 className="t-eyebrow text-ink-3">{group.label}</h3>
                      {group.hint ? (
                        <span className="tabular text-[11px] text-ink-3">{group.hint}</span>
                      ) : null}
                    </div>
                    <TaskList
                      tasks={group.tasks}
                      tags={value.tags}
                      projects={value.projects}
                      today={value.today}
                      progress={value.progress}
                      selectedTaskId={selectedTaskId}
                      sortable={group.sortable}
                      // Every row here belongs to this project; naming it on
                      // each one is a column of identical text.
                      hideProject
                      onMove={move}
                      onToggle={toggle}
                      onOpen={(task) => openTask(task.id)}
                      onDelete={remove}
                      onSelect={select}
                    />
                  </section>
                ))}

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <Kbd>J</Kbd>
                    <Kbd>K</Kbd> move
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>space</Kbd> complete
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>E</Kbd> edit
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>N</Kbd> capture into this project
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </DataView>

      {project ? (
        <BacklinksPanel
          className="border-t border-line pt-4"
          backlinks={backlinks}
          onCreate={() => openNoteComposer({ refType: 'project', refId: project.id })}
        />
      ) : null}

      <TaskDetailPanel
        taskId={openTaskId}
        onClose={() => openTask(null)}
        onCreateTag={tagActions.create}
      />

      {rescheduling && data ? (
        <ReschedulePopover
          task={rescheduling}
          today={data.today}
          onClose={() => setRescheduling(null)}
          onApply={(dueDate) =>
            void dispatch(
              {
                kind: 'task.reschedule',
                source: 'ui',
                raw: '',
                ref: { by: 'id', id: rescheduling.id },
                dueDate,
                dueTime: dueDate === null ? null : rescheduling.dueTime,
              },
              { notify: 'always' },
            )
          }
        />
      ) : null}

      {composer.mode === 'edit' && project ? (
        <ProjectComposer
          project={project}
          busy={pending}
          onSubmit={(value) => void saveProject(value)}
          onCancel={closeComposer}
        />
      ) : null}

      {pickerProjectId !== null && data ? (
        <ProjectTaskPicker
          project={data.project}
          today={data.today}
          members={data.tasks}
          candidates={data.assignable}
          busy={pending}
          onAssign={assign}
          onClose={closePicker}
        />
      ) : null}
    </section>
  )
}
