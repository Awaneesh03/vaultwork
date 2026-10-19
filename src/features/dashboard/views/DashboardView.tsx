import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Activity,
  CalendarClock,
  FileText,
  FolderKanban,
  Plus,
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
import { cn } from '@/lib/cn'
import { formatDayLabel, formatEstimate } from '@/lib/date'
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
import { EveningProgress } from '../components/EveningProgress'
import { EveningReflection, NotesFromToday, WindDown } from '../components/ReflectionWindDown'
import { EveningVista } from '../components/EveningVista'
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

/** How many open tasks the evening shows before deferring to Today. */
const STILL_OPEN_ROWS = 6

export function DashboardView() {
  const [searchParams] = useSearchParams()
  const previewParam = searchParams.get('previewTime')?.toLowerCase()
  const timeContext = useTimeOfDay({ testOverride: previewParam })
  const data = useToday(timeContext.date)
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

  /*
   * The evening warms the whole frame, sidebar included, through one attribute
   * on <html>. Styling only — navigation and every other screen are untouched,
   * and the attribute leaves with this view.
   */
  const evening = timeContext.isEvening
  useEffect(() => {
    if (!evening) return
    document.documentElement.dataset['evening'] = 'true'
    return () => {
      delete document.documentElement.dataset['evening']
    }
  }, [evening])

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
          const isEvening = timeContext.isEvening
          /*
           * Still open, flat. The engine's grouping is kept — overdue first,
           * then today in its own order — but the evening shows one list with
           * a status dot instead of three labelled sections.
           */
          const openNow = [
            ...value.overdue.map((task) => ({ task, late: true })),
            ...value.todayGroups.flatMap((group) =>
              group.tasks.map((task) => ({ task, late: false })),
            ),
          ]

          return (
            <div className="flex flex-col gap-6">
              {/* The hero: one scene per time of day, from the same state as the greeting. */}
              <DashboardHeader timeOfDay={timeContext.timeOfDay} today={value.today} />

              {/* M19.2 — the evening states today's numbers once, quietly. The four
                  daytime counters and the always-open Quick Add belong to the
                  execution screen, not to the wrap-up. */}
              {isEvening ? (
                <EveningProgress
                  progress={value.dayProgress}
                  capturesWaiting={value.capturesWaiting}
                />
              ) : (
                <DashboardSummary summary={value.summary} progress={value.dayProgress} />
              )}

              {/* Capture stays reachable in the evening — on request, not as furniture. */}
              {!isEvening || quickAddOpen ? (
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
              ) : null}

              {/* Main composition */}
              {isEvening ? (
                /* ================= EVENING COMMAND CENTER ================= */
                <div className="flex flex-col gap-3">
                  {/*
                   * Rows, not columns. Three stacks of their own heights is how
                   * the page grew a black hole down its middle: each column ran
                   * out of content at a different point. An explicit row grid
                   * makes every card in a row share a top and a bottom, so the
                   * composition reads as designed rather than as whatever the
                   * data happened to produce.
                   */}

                  {/* Row 1 — the day in three answers. */}
                  <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
                    <div className="min-w-0">
                      {/* 1. Completed Today - Major Standout Retrospective Surface */}
                      <CompletedToday
                        tasks={value.completedTasks}
                        projects={value.allProjects}
                        onOpen={(task) => openTask(task.id)}
                      />
                    </div>

                    <div className="min-w-0">
                      {/* 3. Still Open Work — Unified calm surface without card soup */}
                      <section
                        aria-label="Still open work"
                        className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line/45 bg-surface/55 p-3.5 backdrop-blur-sm transition-colors"
                      >
                        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line/60 pb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-micro font-semibold uppercase tracking-wider text-ink-3">
                              Still Open
                            </span>
                            <CountBadge
                              value={value.overdueTotal + value.todayTotal}
                              tone="neutral"
                            />
                          </div>

                          <div className="flex items-center gap-3 text-micro text-ink-3">
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
                            {value.timeBudget.estimatedMinutes > 0 ? (
                              <span className="tabular">
                                ~{formatEstimate(value.timeBudget.estimatedMinutes)} left
                              </span>
                            ) : null}
                          </div>
                        </header>

                        {openNow.length === 0 ? (
                          <p className="py-2 text-center text-meta text-ink-3">
                            All clear for today. Great work.
                          </p>
                        ) : (
                          <ul className="mt-1.5 flex flex-col">
                            {openNow.slice(0, STILL_OPEN_ROWS).map(({ task, late }) => (
                              <li key={task.id} className="flex items-center gap-2.5 py-1.5">
                                {/*
                                 * Status lives in the dot, not in a section heading:
                                 * the grouping is still what the engine computed, it
                                 * simply no longer costs three headers of height.
                                 */}
                                <button
                                  type="button"
                                  onClick={() => toggle(task)}
                                  aria-label={`Complete ${task.title}`}
                                  className={cn(
                                    'h-3.5 w-3.5 shrink-0 rounded-full border transition-colors',
                                    late
                                      ? 'border-warn hover:bg-warn/20'
                                      : 'border-line-strong hover:border-accent hover:bg-accent/15',
                                  )}
                                />
                                <button
                                  type="button"
                                  onClick={() => openTask(task.id)}
                                  title={task.title}
                                  className="min-w-0 flex-1 truncate text-left text-body text-ink-2 transition-colors hover:text-ink"
                                >
                                  {task.title}
                                </button>
                                {task.estimateMin !== null ? (
                                  <span className="tabular shrink-0 text-micro text-ink-3">
                                    {formatEstimate(task.estimateMin)}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                            {openNow.length > STILL_OPEN_ROWS ? (
                              <li className="pt-1">
                                <Link
                                  to={ROUTES.today}
                                  className="text-micro text-ink-3 transition-colors hover:text-accent"
                                >
                                  {openNow.length - STILL_OPEN_ROWS} more
                                </Link>
                              </li>
                            ) : null}
                          </ul>
                        )}

                        <button
                          type="button"
                          onClick={() => setQuickAddOpen(true)}
                          className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-meta text-ink-3 transition-colors hover:border-accent-line hover:text-ink"
                        >
                          <Plus size={13} aria-hidden />
                          Add task
                        </button>
                      </section>
                    </div>

                    <div className="min-w-0">
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
                        <ol className="flex flex-col gap-0.5 px-3.5 py-3">
                          {value.upcomingGroups
                            .flatMap((group) =>
                              group.tasks.map((task) => ({
                                task,
                                day: group.date
                                  ? formatDayLabel(group.date, value.today)
                                  : group.label,
                              })),
                            )
                            .map(({ task, day }, index) => (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  onClick={() => openTask(task.id)}
                                  title={task.title}
                                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-elevated"
                                >
                                  <span className="tabular w-4 shrink-0 text-meta text-ink-3">
                                    {index + 1}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-body text-ink-2">
                                    {task.title}
                                  </span>
                                  <span className="shrink-0 text-micro text-ink-3">{day}</span>
                                </button>
                              </li>
                            ))}
                        </ol>
                      </DashboardCard>
                    </div>
                  </div>

                  {/* Row 2 — one decision, what was captured, and the day's close. */}
                  <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
                    <div className="min-w-0">
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
                    </div>

                    <div className="min-w-0">
                      <NotesFromToday recentNotes={value.notes} />
                    </div>

                    <div className="min-w-0">
                      <EveningVista night={timeContext.timeOfDay === 'night'} />
                    </div>
                  </div>

                  {/* Row 3 — the two surfaces that end the day. */}
                  <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
                    <div className="min-w-0 lg:col-span-2">
                      <EveningReflection />
                    </div>

                    <div className="min-w-0">
                      <WindDown
                        completedCount={value.summary.completedToday}
                        capturesWaiting={value.capturesWaiting}
                      />
                    </div>
                  </div>

                  {/* 5. External Context (Calendar & Email if connected) */}
                  <ExternalContextSections
                    calendar={external.calendar}
                    email={external.email}
                    today={value.today}
                    onCheckAgain={external.checkAgain}
                  />

                  {/* Tertiary: the quiet background of the day. */}
                  <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {/* "Notes from today" above already shows this very list, and the
                        evening screen states nothing twice. The daytime composition
                        keeps its own Recent notes card. */}

                    <DashboardCard
                      className="h-full"
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
                      className="h-full"
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

                    {/* 5. Recent Activity */}
                    <DashboardCard
                      className="h-full"
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
