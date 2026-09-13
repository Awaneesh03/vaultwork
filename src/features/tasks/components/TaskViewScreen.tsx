import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  CheckCircle2,
  Inbox,
  ListChecks,
  Sun,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import { formatEstimate } from '@/lib/date'
import type { TaskPatch, TaskViewData, TaskViewId } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import type { Id, Task } from '@/types/entities'
import type { Priority } from '@/types/enums'
import { useTagActions } from '../hooks/useTagActions'
import { useTaskListShortcuts } from '../hooks/useTaskListShortcuts'
import { useTaskView } from '../hooks/useTaskView'
import { QuickAddBar } from './QuickAddBar'
import { ReschedulePopover } from './ReschedulePopover'
import { TaskDetailPanel } from './TaskDetailPanel'
import { TaskList } from './TaskList'
import { TaskToolbar } from './TaskToolbar'
import { toTaskFields, type ComposerValue } from '../composerValue'

/**
 * The screen behind all six task views.
 *
 * One component, six configurations. The views differ in what they *query* and
 * how they *group* — both decided in the service layer — so a second screen
 * component would only be a second place for the same bugs.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent. Nothing here
 * imports a service value or a repository.
 */

interface ViewChrome {
  icon: LucideIcon
  title: string
  blurb: string
  emptyTitle: string
  emptyBody: string
  /** Quick add is pointless on a view of things already finished. */
  quickAdd: boolean
  /** What a new task's due date defaults to on this screen. */
  defaultDue: (today: string) => string | null
}

const CHROME: Record<TaskViewId, ViewChrome> = {
  inbox: {
    icon: Inbox,
    title: 'Inbox',
    blurb: 'Everything captured without a home. The list you empty, not the list you keep.',
    emptyTitle: 'Inbox zero',
    emptyBody: 'Nothing unfiled. Capture something with N, or give an existing task a project.',
    quickAdd: true,
    defaultDue: () => null,
  },
  today: {
    icon: Sun,
    title: 'Today',
    blurb: 'Overdue first, then what is scheduled by time, then the rest.',
    emptyTitle: 'Nothing due today',
    emptyBody: 'A clear day. Pull something forward from Upcoming, or leave it clear.',
    quickAdd: true,
    defaultDue: (today) => today,
  },
  upcoming: {
    icon: CalendarClock,
    title: 'Upcoming',
    blurb: 'The next two weeks, day by day. Empty days are shown rather than skipped.',
    emptyTitle: 'Nothing scheduled',
    emptyBody: 'The next two weeks are clear. That is either freedom or a planning gap.',
    quickAdd: true,
    defaultDue: () => null,
  },
  overdue: {
    icon: TriangleAlert,
    title: 'Overdue',
    blurb: 'Past their date and still open. Oldest first.',
    emptyTitle: 'Nothing is late',
    emptyBody: 'Every dated task is still in the future. Worth keeping it that way.',
    quickAdd: false,
    defaultDue: () => null,
  },
  completed: {
    icon: CheckCircle2,
    title: 'Completed',
    blurb: 'What you finished, grouped by the day you finished it.',
    emptyTitle: 'Nothing completed yet',
    emptyBody: 'Finished tasks collect here. The event log keeps the history either way.',
    quickAdd: false,
    defaultDue: () => null,
  },
  all: {
    icon: ListChecks,
    title: 'All tasks',
    blurb: 'Everything that exists, open and done. Filter it down.',
    emptyTitle: 'No tasks yet',
    emptyBody: 'Press N to capture your first one — "Study Java tomorrow 7pm" works as typed.',
    quickAdd: true,
    defaultDue: () => null,
  },
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[var(--row-height)] w-full" />
      ))}
    </div>
  )
}

export function TaskViewScreen({ view }: { view: TaskViewId }) {
  const chrome = CHROME[view]
  const data = useTaskView(view)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { dispatch, run, pending } = useCommands()
  const tagActions = useTagActions()

  const filter = useTaskUiStore((s) => s.filter)
  const sort = useTaskUiStore((s) => s.sort)
  const direction = useTaskUiStore((s) => s.direction)
  const selectedTaskId = useTaskUiStore((s) => s.selectedTaskId)
  const openTaskId = useTaskUiStore((s) => s.openTaskId)
  const quickAddOpen = useTaskUiStore((s) => s.quickAddOpen)
  const focusNonce = useTaskUiStore((s) => s.searchFocusNonce)

  // Zustand action identities are stable, so selecting them individually keeps
  // this component from re-rendering on every unrelated store write.
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

  const [rescheduling, setRescheduling] = useState<Task | null>(null)

  // Filters are per-visit, not per-app: arriving at Today with yesterday's
  // "urgent only" still applied is a good way to think you have no work.
  useEffect(() => {
    resetForView()
  }, [view, resetForView])

  // `?task=` is an entry point, so a note that references a task can link
  // straight to it — the same pattern `?goal=` and `?habit=` already use.
  const requestedTask = searchParams.get('task')
  useEffect(() => {
    if (requestedTask) openTask(requestedTask)
  }, [requestedTask, openTask])

  const tasksOnScreen = data?.tasks ?? []

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

  useTaskListShortcuts({
    tasks: tasksOnScreen,
    selectedTaskId,
    enabled: openTaskId === null && rescheduling === null,
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

  const submitText = async (text: string) => {
    const result = await run(text, 'quickadd')
    return result.status === 'ok'
  }

  /**
   * The composer already holds ids, while a draft carries names. Rather than
   * round-tripping ids through a name lookup, the task is created from the
   * draft and the id-valued fields are applied as one follow-up patch.
   */
  const submitForm = async (value: ComposerValue) => {
    const fields = toTaskFields(value)
    if (fields.title.length === 0) return false

    const result = await dispatch({
      kind: 'task.add',
      source: 'ui',
      raw: '',
      tokens: [],
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
    if (fields.projectId) patch.projectId = fields.projectId
    if (fields.tagIds.length > 0) patch.tagIds = fields.tagIds
    if (Object.keys(patch).length > 0) {
      await dispatch(
        { kind: 'task.update', source: 'ui', raw: '', taskId: result.task.id, patch },
        { notify: 'errors' },
      )
    }
    return true
  }

  const activeFilterCount =
    filter.priorities.length +
    filter.tagIds.length +
    (filter.projectId === 'any' ? 0 : 1) +
    (filter.due === 'any' ? 0 : 1) +
    (filter.hasEstimate === 'any' ? 0 : 1) +
    (filter.search.trim().length > 0 ? 1 : 0)

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <chrome.icon size={18} className="text-accent" aria-hidden />
          <h2 className="text-display font-semibold tracking-tight">{chrome.title}</h2>
          {data ? (
            <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-3">
              {data.tasks.length}
            </span>
          ) : null}
          {data && data.totalEstimateMin > 0 ? (
            <span className="tabular text-meta text-ink-3">
              ≈ {formatEstimate(data.totalEstimateMin)}
            </span>
          ) : null}
        </div>
        <p className="max-w-prose text-strong text-ink-2">{chrome.blurb}</p>
      </header>

      {chrome.quickAdd ? (
        <QuickAddBar
          today={data?.today ?? ''}
          tags={data?.tags ?? []}
          projects={data?.projects ?? []}
          defaultDueDate={data ? chrome.defaultDue(data.today) : null}
          busy={pending}
          autoFocus={quickAddOpen}
          onSubmitText={submitText}
          onSubmitForm={submitForm}
          onCreateTag={tagActions.create}
          onDismiss={() => setQuickAddOpen(false)}
        />
      ) : null}

      {/* Rendered once, outside DataView: the toolbar is how you get *out* of an
          empty result, so it has to survive the empty state. */}
      <TaskToolbar
        view={view}
        filter={filter}
        sort={sort ?? 'manual'}
        direction={direction ?? 'asc'}
        tags={data?.tags ?? []}
        projects={data?.projects ?? []}
        activeCount={activeFilterCount}
        focusNonce={focusNonce}
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

      <DataView<TaskViewData>
        data={data}
        loading={<ListSkeleton />}
        isEmpty={(value) => value.tasks.length === 0}
        empty={
          <EmptyState
            icon={<chrome.icon size={20} aria-hidden />}
            title={activeFilterCount > 0 ? 'Nothing matches those filters' : chrome.emptyTitle}
            description={
              activeFilterCount > 0
                ? `${data?.unfilteredCount ?? 0} tasks are hidden by the filters above.`
                : chrome.emptyBody
            }
            {...(activeFilterCount > 0
              ? {
                  action: (
                    <button
                      type="button"
                      onClick={clearFilter}
                      className="text-body text-accent underline decoration-dotted"
                    >
                      Clear filters
                    </button>
                  ),
                }
              : {})}
          />
        }
      >
        {(value) => (
          <div className="flex flex-col gap-5">
            {value.groups
              .filter((group) => group.keepWhenEmpty || group.tasks.length > 0)
              .map((group) => (
                <section key={group.id} className="flex flex-col gap-1">
                  {group.label ? (
                    <div className="flex items-baseline gap-2 px-2">
                      <h3
                        className={cn(
                          't-eyebrow',
                          group.id === 'overdue' ? 'text-danger' : 'text-ink-3',
                        )}
                      >
                        {group.label}
                      </h3>
                      {group.hint ? (
                        <span className="tabular text-meta text-ink-3">{group.hint}</span>
                      ) : null}
                    </div>
                  ) : null}

                  {group.tasks.length === 0 ? (
                    <p className="px-2 py-1 text-body text-ink-3" aria-label="No tasks">
                      —
                    </p>
                  ) : (
                    <TaskList
                      tasks={group.tasks}
                      tags={value.tags}
                      projects={value.projects}
                      today={value.today}
                      progress={value.progress}
                      selectedTaskId={selectedTaskId}
                      sortable={group.sortable}
                      hideDueDate={view === 'upcoming' || group.id === 'scheduled'}
                      onMove={move}
                      onToggle={toggle}
                      onOpen={(task) => openTask(task.id)}
                      onDelete={remove}
                      onSelect={select}
                    />
                  )}
                </section>
              ))}

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-meta text-ink-3">
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
                <Kbd>D</Kbd> due date
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>1</Kbd>–<Kbd>4</Kbd> priority
              </span>
            </p>
          </div>
        )}
      </DataView>

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
    </section>
  )
}
