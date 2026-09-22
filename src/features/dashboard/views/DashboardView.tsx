import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CalendarClock,
  FolderKanban,
  FileText,
  Repeat,
  Sun,
  Target,
  TriangleAlert,
} from 'lucide-react'
import { ROUTES } from '@/app/navigation'
import { DataView } from '@/components/feedback/DataView'
import { Skeleton } from '@/components/feedback/Skeleton'
import { useCommands } from '@/hooks/useCommands'
import { formatDayLabel } from '@/lib/date'
import type { TaskPatch, TodayContext } from '@/services'
import { useTaskUiStore } from '@/store/taskUiStore'
import type { Id, Task } from '@/types/entities'
import type { Priority } from '@/types/enums'
import { toTaskFields, type ComposerValue } from '@/features/tasks/composerValue'
import { QuickAddBar } from '@/features/tasks/components/QuickAddBar'
import { ReschedulePopover } from '@/features/tasks/components/ReschedulePopover'
import { TaskDetailPanel } from '@/features/tasks/components/TaskDetailPanel'
import { useTagActions } from '@/features/tasks/hooks/useTagActions'
import { useTaskListShortcuts } from '@/features/tasks/hooks/useTaskListShortcuts'
import { DashboardCard } from '../components/DashboardCard'
import { DashboardHeader } from '../components/DashboardHeader'
import { DashboardGoals } from '../components/DashboardGoals'
import { DashboardNotes } from '../components/DashboardNotes'
import { DashboardProjects } from '../components/DashboardProjects'
import { DashboardSummary } from '../components/DashboardSummary'
import { TodayHabits } from '../components/TodayHabits'
import { DashboardTaskList } from '../components/DashboardTaskList'
import { NextAction } from '../components/NextAction'
import { RecentActivity } from '../components/RecentActivity'
import { ExternalContextSections } from '../components/ExternalContextSections'
import { TodaySoFar } from '../components/TodaySoFar'
import { sourcesSentence, useExternalContext } from '../hooks/useExternalContext'
import { useToday } from '../hooks/useToday'

/**
 * The daily command centre.
 *
 * It answers one question — *what should I pay attention to, and what next?* —
 * and it answers it entirely out of M3 and M4. There is no dashboard task
 * model, no dashboard completion path and no dashboard definition of "today":
 * every figure arrives assembled from `useDashboard`, and every mutation leaves
 * as a CommandIntent through `useCommands`, exactly as it does from the task
 * screens. Adding a section here can never fork the domain.
 *
 * The layout is a hierarchy, not a grid: header and capture, then the four
 * numbers, then the decisions that need making (next action, overdue, today),
 * then the context that informs them (upcoming, projects, activity).
 */

/** "3 days late", per overdue task — how late, in words beside the due date. */
function latenessNotes(lateness: Map<string, number>): Map<string, string> {
  return new Map(
    [...lateness].map(([id, days]) => [id, `${days} ${days === 1 ? 'day' : 'days'} late`]),
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[54px] w-full max-w-sm" />
      <Skeleton className="h-[74px] w-full" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[66px] w-full" />
        ))}
      </div>
      <Skeleton className="h-[150px] w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-[180px] w-full" />
        <Skeleton className="h-[180px] w-full" />
      </div>
    </div>
  )
}

export function DashboardView() {
  const data = useToday()
  // M19.1: read on its own, beside the Today context — never inside it.
  const external = useExternalContext()
  const navigate = useNavigate()
  const { dispatch, run, pending } = useCommands()
  const tagActions = useTagActions()

  // The dashboard shares the task screens' ephemeral state, so a task opened
  // here uses the same detail panel and the same selection the lists use.
  const selectedTaskId = useTaskUiStore((s) => s.selectedTaskId)
  const openTaskId = useTaskUiStore((s) => s.openTaskId)
  const quickAddOpen = useTaskUiStore((s) => s.quickAddOpen)
  const select = useTaskUiStore((s) => s.select)
  const openTask = useTaskUiStore((s) => s.openTask)
  const setQuickAddOpen = useTaskUiStore((s) => s.setQuickAddOpen)

  const [rescheduling, setRescheduling] = useState<Task | null>(null)

  const toggle = useCallback(
    (task: Task) =>
      void dispatch(
        { kind: 'task.toggle', source: 'ui', raw: '', ref: { by: 'id', id: task.id } },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const complete = useCallback(
    (task: Task) =>
      void dispatch(
        { kind: 'task.complete', source: 'ui', raw: '', ref: { by: 'id', id: task.id } },
        { notify: 'always' },
      ),
    [dispatch],
  )

  const remove = useCallback(
    (task: Task) =>
      void dispatch({ kind: 'task.delete', source: 'ui', raw: '', ref: { by: 'id', id: task.id } }),
    [dispatch],
  )

  /** Habits toggle through the same command layer the Habits screen uses. */
  const toggleHabit = useCallback(
    (habitId: Id) =>
      void dispatch({ kind: 'habit.toggle', source: 'ui', raw: '', habitId }, { notify: 'errors' }),
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

  /**
   * The rows the keyboard walks, in the order they appear on screen and with
   * no repeats — the same task can legitimately be both the next action and a
   * row in Today, and selection has to stay a single position.
   */
  const walkable = useMemo(() => {
    const seen = new Set<Id>()
    const ordered: Task[] = []
    const push = (task: Task) => {
      if (seen.has(task.id)) return
      seen.add(task.id)
      ordered.push(task)
    }
    for (const group of data?.todayGroups ?? []) group.tasks.forEach(push)
    for (const task of data?.overdue ?? []) push(task)
    for (const group of data?.upcomingGroups ?? []) group.tasks.forEach(push)
    return ordered
  }, [data?.todayGroups, data?.overdue, data?.upcomingGroups])

  useTaskListShortcuts({
    tasks: walkable,
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

  /** Quick add, through the same command pipeline every other surface uses. */
  const submitText = async (text: string) => {
    const result = await run(text, 'quickadd')
    return result.status === 'ok'
  }

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

  return (
    <div className="flex flex-col gap-5">
      <DataView<TodayContext> data={data} loading={<DashboardSkeleton />} isEmpty={() => false}>
        {(value) => (
          <div className="flex flex-col gap-5">
            <DashboardHeader
              greeting={value.greeting}
              today={value.today}
              headline={value.headline}
            />

            <QuickAddBar
              today={value.today}
              tags={value.tags}
              projects={value.allProjects}
              busy={pending}
              autoFocus={quickAddOpen}
              onSubmitText={submitText}
              onSubmitForm={submitForm}
              onCreateTag={tagActions.create}
              onDismiss={() => setQuickAddOpen(false)}
            />

            <DashboardSummary summary={value.summary} />

            <NextAction
              task={value.nextAction}
              reason={value.nextAction ? (value.reasons.get(value.nextAction.id) ?? null) : null}
              knowledge={value.knowledge}
              today={value.today}
              projects={value.allProjects}
              onOpen={(task) => openTask(task.id)}
              onComplete={complete}
              onSchedule={setRescheduling}
              onCapture={() => setQuickAddOpen(true)}
            />

            {/* The decisions: what is late, and what today holds. `items-start`
                so a short card stays short instead of stretching to match its
                neighbour and leaving a void that reads as missing data. */}
            <div className="grid items-start gap-3 lg:grid-cols-2">
              <DashboardCard
                title="Overdue"
                icon={TriangleAlert}
                tone="warn"
                count={value.overdueTotal}
                href={ROUTES.overdue}
                linkLabel="View all overdue"
                isEmpty={value.overdue.length === 0}
                empty="Nothing overdue."
              >
                <DashboardTaskList
                  tasks={value.overdue}
                  notes={latenessNotes(value.lateness)}
                  tags={value.tags}
                  projects={value.allProjects}
                  today={value.today}
                  progress={value.progress}
                  selectedTaskId={selectedTaskId}
                  onToggle={toggle}
                  onOpen={(task) => openTask(task.id)}
                  onDelete={remove}
                  onSelect={select}
                />
              </DashboardCard>

              <DashboardCard
                title="Today"
                icon={Sun}
                count={value.todayTotal}
                href={ROUTES.today}
                isEmpty={value.todayGroups.length === 0}
                empty="Nothing scheduled for today."
              >
                <div className="flex flex-col">
                  {value.todayGroups.map((group) => (
                    <div key={group.id}>
                      <p className="t-eyebrow px-3.5 pt-2.5 pb-1 text-ink-3">{group.label}</p>
                      <DashboardTaskList
                        tasks={group.tasks}
                        tags={value.tags}
                        projects={value.allProjects}
                        today={value.today}
                        progress={value.progress}
                        selectedTaskId={selectedTaskId}
                        // The card is "Today"; repeating the date on each row
                        // would be a column of the same word.
                        hideDueDate
                        onToggle={toggle}
                        onOpen={(task) => openTask(task.id)}
                        onDelete={remove}
                        onSelect={select}
                      />
                    </div>
                  ))}
                </div>
              </DashboardCard>
            </div>

            {/* M19: how the day is going — context, so it follows the decisions. */}
            <TodaySoFar
              progress={value.dayProgress}
              budget={value.timeBudget}
              capturesWaiting={value.capturesWaiting}
            />

            {/* M19.1: calendar and email, only when a source answered. */}
            <ExternalContextSections
              calendar={external.calendar}
              email={external.email}
              today={value.today}
            />

            {/* The context: what is coming, where it belongs, what just changed. */}
            <div className="grid items-start gap-3 lg:grid-cols-3">
              <DashboardCard
                title="Today's habits"
                icon={Repeat}
                count={value.habits.scheduled}
                href={ROUTES.habits}
                isEmpty={value.habits.scheduled === 0}
                empty="No habits scheduled today."
              >
                <TodayHabits summary={value.habits} onToggle={toggleHabit} />
              </DashboardCard>

              <DashboardCard
                title="Upcoming"
                icon={CalendarClock}
                count={value.upcomingTotal}
                href={ROUTES.upcoming}
                isEmpty={value.upcomingGroups.length === 0}
                empty="No upcoming tasks."
              >
                <ul className="flex flex-col gap-2 px-3.5 py-2.5">
                  {value.upcomingGroups.map((group) => (
                    <li key={group.id}>
                      <p className="t-eyebrow text-ink-3">
                        {group.date ? formatDayLabel(group.date, value.today) : group.label}
                      </p>
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {group.tasks.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => openTask(task.id)}
                              title={task.title}
                              className="block w-full truncate rounded px-1 py-0.5 text-left text-body text-ink-2 hover:bg-elevated hover:text-ink"
                            >
                              {task.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </DashboardCard>

              <DashboardCard
                title="Goals"
                icon={Target}
                count={value.goals.activeCount}
                href={ROUTES.goals}
                linkLabel="View all goals"
                isEmpty={value.goals.activeCount === 0}
                empty="No active goals yet."
              >
                <DashboardGoals summary={value.goals} />
              </DashboardCard>

              <DashboardCard
                title="Projects"
                icon={FolderKanban}
                count={value.projectsTotal}
                href={ROUTES.projects}
                linkLabel="View all projects"
                isEmpty={value.projects.length === 0}
                empty="No active projects yet."
              >
                <DashboardProjects projects={value.projects} today={value.today} />
              </DashboardCard>

              <DashboardCard
                title="Recent notes"
                icon={FileText}
                count={value.notes.length}
                href={ROUTES.notes}
                linkLabel="View all notes"
                isEmpty={value.notes.length === 0}
                empty="No notes yet."
              >
                <DashboardNotes notes={value.notes} now={value.now} today={value.today} />
              </DashboardCard>

              <DashboardCard
                title="Recent activity"
                icon={Activity}
                isEmpty={value.activity.length === 0}
                empty="No recent activity."
              >
                <RecentActivity activity={value.activity} now={value.now} today={value.today} />
              </DashboardCard>
            </div>

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-meta text-ink-3">
              <span className="tabular">
                {value.counts['tasks'] ?? 0} tasks · {value.counts['projects'] ?? 0} projects ·{' '}
                {value.counts['tags'] ?? 0} tags · {value.eventCount} events
              </span>
              <span>— live from the local database.</span>
              {/* M19: which sources the day was built from, stated plainly. */}
              <span>
                {sourcesSentence(
                  value.sources.knowledge === 'included',
                  external.calendar,
                  external.email,
                )}
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
    </div>
  )
}
