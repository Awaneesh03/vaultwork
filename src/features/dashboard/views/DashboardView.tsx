import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
import { CountBadge } from '@/components/ui/Badge'
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
import { CompletedToday } from '../components/CompletedToday'
import { DashboardCard } from '../components/DashboardCard'
import { DashboardHeader } from '../components/DashboardHeader'
import { DashboardGoals } from '../components/DashboardGoals'
import { DashboardNotes } from '../components/DashboardNotes'
import { DashboardProjects } from '../components/DashboardProjects'
import { DashboardSummary } from '../components/DashboardSummary'
import { ReflectionWindDown } from '../components/ReflectionWindDown'
import { TodayHabits } from '../components/TodayHabits'
import { DashboardTaskList } from '../components/DashboardTaskList'
import { NextAction } from '../components/NextAction'
import { RecentActivity } from '../components/RecentActivity'
import { ExternalContextSections } from '../components/ExternalContextSections'
import { TodaySoFar } from '../components/TodaySoFar'
import { sourcesSentence, useExternalContext } from '../hooks/useExternalContext'
import { useToday } from '../hooks/useToday'
import { useTimeOfDay } from '../hooks/useTimeOfDay'

/**
 * The Evening Command Centre.
 *
 * Polished, spacious, calm, and dark-first. It preserves 100% of Vaultwork's
 * existing data layer, Today Engine rules, and command pipeline while
 * delivering an intentional evening retrospective and wind-down experience.
 */

/** "3 days late", per overdue task — how late, in words beside the due date. */
function latenessNotes(lateness: Map<string, number>): Map<string, string> {
  return new Map(
    [...lateness].map(([id, days]) => [id, `${days} ${days === 1 ? 'day' : 'days'} late`]),
  )
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-[120px] w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[70px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Skeleton className="h-[150px] w-full rounded-xl" />
          <Skeleton className="h-[200px] w-full rounded-xl" />
          <Skeleton className="h-[180px] w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Skeleton className="h-[180px] w-full rounded-xl" />
          <Skeleton className="h-[160px] w-full rounded-xl" />
          <Skeleton className="h-[180px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export function DashboardView() {
  const data = useToday()
  // M19.1: read on its own, beside the Today context — never inside it.
  const external = useExternalContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const previewParam = searchParams.get('previewTime')?.toLowerCase()
  const timeContext = useTimeOfDay({ testOverride: previewParam })
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
    <div className="flex flex-col gap-6">
      <DataView<TodayContext> data={data} loading={<DashboardSkeleton />} isEmpty={() => false}>
        {(value) => {
          const effectiveGreeting = timeContext.greeting
          const isEvening = timeContext.isEvening

          return (
            <div className="flex flex-col gap-6">
              {/* Top Atmospheric Evening Hero */}
              <DashboardHeader
                greeting={effectiveGreeting}
                today={value.today}
                headline={value.headline}
              />

              {/* Compact Progress Row & Metrics */}
              <DashboardSummary summary={value.summary} progress={value.dayProgress} />

              {/* Quick Add Bar */}
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

              {/* Main Balanced Multi-column Layout */}
              {isEvening ? (
                /* ================= EVENING COMMAND CENTER COMPOSITION ================= */
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                  {/* Primary Column: Output, Immediate Action, Still Open (7 cols) */}
                  <div className="flex flex-col gap-6 lg:col-span-7">
                    {/* 1. Completed Today - Major Standout Retrospective Surface */}
                    <CompletedToday
                      tasks={value.completedTasks}
                      projects={value.allProjects}
                      onOpen={(task) => openTask(task.id)}
                    />

                    {/* 2. Next Action decision */}
                    <NextAction
                      task={value.nextAction}
                      reason={
                        value.nextAction ? (value.reasons.get(value.nextAction.id) ?? null) : null
                      }
                      knowledge={value.knowledge}
                      today={value.today}
                      projects={value.allProjects}
                      onOpen={(task) => openTask(task.id)}
                      onComplete={complete}
                      onSchedule={setRescheduling}
                      onCapture={() => setQuickAddOpen(true)}
                    />

                    {/* 3. Still Open Work — Unified calm surface without card soup */}
                    <section
                      aria-label="Still open work"
                      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line/70 bg-surface/80 p-5 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-colors"
                    >
                      <header className="flex items-center justify-between pb-3 border-b border-line/60">
                        <div className="flex items-center gap-2">
                          <span className="text-micro font-semibold uppercase tracking-wider text-ink-3">
                            Still Open
                          </span>
                          <CountBadge
                            value={value.overdueTotal + value.todayTotal}
                            tone="neutral"
                          />
                        </div>

                        <div className="flex items-center gap-3 text-meta text-ink-3">
                          {value.overdueTotal > 0 ? (
                            <Link
                              to={ROUTES.overdue}
                              className="text-warn hover:underline transition-colors"
                            >
                              {value.overdueTotal} overdue
                            </Link>
                          ) : null}
                          {value.todayTotal > 0 ? (
                            <Link
                              to={ROUTES.today}
                              className="hover:text-accent hover:underline transition-colors"
                            >
                              {value.todayTotal} due today
                            </Link>
                          ) : null}
                        </div>
                      </header>

                      {value.overdue.length === 0 && value.todayGroups.length === 0 ? (
                        <div className="py-6 text-center">
                          <p className="text-body text-ink-3">All clear for today. Great work.</p>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-col gap-4">
                          {value.overdue.length > 0 ? (
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 pb-1 text-warn text-micro font-medium uppercase tracking-wider">
                                <TriangleAlert size={11} aria-hidden />
                                <span>Overdue</span>
                              </div>
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
                            </div>
                          ) : null}

                          {value.todayGroups.length > 0 ? (
                            <div className="flex flex-col">
                              {value.todayGroups.map((group) => (
                                <div key={group.id}>
                                  <p className="t-eyebrow px-1 pt-1 pb-1 text-ink-3">
                                    {group.label}
                                  </p>
                                  <DashboardTaskList
                                    tasks={group.tasks}
                                    tags={value.tags}
                                    projects={value.allProjects}
                                    today={value.today}
                                    progress={value.progress}
                                    selectedTaskId={selectedTaskId}
                                    hideDueDate
                                    onToggle={toggle}
                                    onOpen={(task) => openTask(task.id)}
                                    onDelete={remove}
                                    onSelect={select}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </section>

                    {/* 4. Today So Far - Progress & Budget */}
                    <TodaySoFar
                      progress={value.dayProgress}
                      budget={value.timeBudget}
                      capturesWaiting={value.capturesWaiting}
                    />

                    {/* 5. External Context (Calendar & Email if connected) */}
                    <ExternalContextSections
                      calendar={external.calendar}
                      email={external.email}
                      today={value.today}
                      onCheckAgain={external.checkAgain}
                    />
                  </div>

                  {/* Secondary Column: Tomorrow, Wind Down, Supporting Context (5 cols) */}
                  <div className="flex flex-col gap-6 lg:col-span-5">
                    {/* 1. Tomorrow / Upcoming */}
                    <DashboardCard
                      title="Tomorrow"
                      icon={CalendarClock}
                      count={value.upcomingTotal}
                      href={ROUTES.upcoming}
                      linkLabel="View all upcoming"
                      isEmpty={value.upcomingGroups.length === 0}
                      empty="Nothing planned for tomorrow."
                    >
                      <ul className="flex flex-col gap-2.5 px-3.5 py-3">
                        {value.upcomingGroups.map((group) => (
                          <li key={group.id}>
                            <p className="t-eyebrow text-ink-3">
                              {group.date ? formatDayLabel(group.date, value.today) : group.label}
                            </p>
                            <ul className="mt-1 flex flex-col gap-0.5">
                              {group.tasks.map((task) => (
                                <li key={task.id}>
                                  <button
                                    type="button"
                                    onClick={() => openTask(task.id)}
                                    title={task.title}
                                    className="block w-full truncate rounded px-1.5 py-1 text-left text-body text-ink-2 hover:bg-elevated hover:text-ink transition-colors"
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

                    {/* 2. Calm Evening Reflection & Wind Down */}
                    <ReflectionWindDown
                      recentNotes={value.notes}
                      completedCount={value.summary.completedToday}
                      capturesWaiting={value.capturesWaiting}
                    />

                    {/* 3. Recent Notes */}
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

                    {/* 4. Quiet Supporting Context: Habits & Projects */}
                    <div className="flex flex-col gap-4">
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
                    </div>

                    {/* 5. Recent Activity */}
                    <DashboardCard
                      title="Recent activity"
                      icon={Activity}
                      isEmpty={value.activity.length === 0}
                      empty="No recent activity."
                    >
                      <RecentActivity
                        activity={value.activity}
                        now={value.now}
                        today={value.today}
                      />
                    </DashboardCard>
                  </div>
                </div>
              ) : (
                /* ================= DAYTIME COMPOSITION ================= */
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                  {/* Primary Column: Next Action, Overdue, Today (7 cols) */}
                  <div className="flex flex-col gap-6 lg:col-span-7">
                    {/* 1. Next Action decision */}
                    <NextAction
                      task={value.nextAction}
                      reason={
                        value.nextAction ? (value.reasons.get(value.nextAction.id) ?? null) : null
                      }
                      knowledge={value.knowledge}
                      today={value.today}
                      projects={value.allProjects}
                      onOpen={(task) => openTask(task.id)}
                      onComplete={complete}
                      onSchedule={setRescheduling}
                      onCapture={() => setQuickAddOpen(true)}
                    />

                    {/* 2. Overdue Card */}
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

                    {/* 3. Today Card */}
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

                    {/* Completed Today if any were finished */}
                    {value.completedTasks.length > 0 ? (
                      <CompletedToday
                        tasks={value.completedTasks}
                        projects={value.allProjects}
                        onOpen={(task) => openTask(task.id)}
                      />
                    ) : null}

                    {/* 4. Today So Far - Progress & Budget */}
                    <TodaySoFar
                      progress={value.dayProgress}
                      budget={value.timeBudget}
                      capturesWaiting={value.capturesWaiting}
                    />

                    {/* 5. External Context (Calendar & Email if connected) */}
                    <ExternalContextSections
                      calendar={external.calendar}
                      email={external.email}
                      today={value.today}
                      onCheckAgain={external.checkAgain}
                    />
                  </div>

                  {/* Secondary Column: Habits, Upcoming, Projects, Goals, Notes, Activity (5 cols) */}
                  <div className="flex flex-col gap-6 lg:col-span-5">
                    {/* 1. Today's Habits */}
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

                    {/* 2. Upcoming */}
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

                    {/* 3. Goals */}
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

                    {/* 4. Projects */}
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

                    {/* 5. Recent notes */}
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

                    {/* 6. Recent activity */}
                    <DashboardCard
                      title="Recent activity"
                      icon={Activity}
                      isEmpty={value.activity.length === 0}
                      empty="No recent activity."
                    >
                      <RecentActivity
                        activity={value.activity}
                        now={value.now}
                        today={value.today}
                      />
                    </DashboardCard>
                  </div>
                </div>
              )}

              {/* Bottom Live System Counts & Data Provenance */}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 pt-4 text-meta text-ink-3">
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
          )
        }}
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
