import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { DataView } from '@/components/feedback/DataView'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import { addDays, formatFullDate } from '@/lib/date'
import { isCalendarMode, shiftPeriod } from '@/lib/calendar'
import type { CalendarData, TaskPatch, TaskStatusFilter } from '@/services'
import { useCalendarUiStore } from '@/store/calendarUiStore'
import { useTaskUiStore } from '@/store/taskUiStore'
import type { DateStr, Task, TimeStr } from '@/types/entities'
import { toTaskFields, type ComposerValue } from '@/features/tasks/composerValue'
import { QuickAddBar } from '@/features/tasks/components/QuickAddBar'
import { TaskDetailPanel } from '@/features/tasks/components/TaskDetailPanel'
import { useTagActions } from '@/features/tasks/hooks/useTagActions'
import { CalendarTimeGrid } from '../components/CalendarTimeGrid'
import { CalendarToolbar } from '../components/CalendarToolbar'
import { DayAgenda } from '../components/DayAgenda'
import { MonthView } from '../components/MonthView'
import { UnscheduledPanel } from '../components/UnscheduledPanel'
import { useCalendar } from '../hooks/useCalendar'
import { useCalendarShortcuts } from '../hooks/useCalendarShortcuts'

/**
 * The Calendar.
 *
 * It is a *view of tasks*, and every mutation it offers leaves as the same
 * CommandIntent the task screens dispatch: completing goes through
 * `task.toggle`, editing through the existing `TaskDetailPanel`, creating
 * through `task.add`, and dragging through `task.reschedule`. There is no
 * calendar task service and no calendar write path — which is what makes
 * "a task created in the Inbox appears here" true by construction rather than
 * by synchronisation.
 *
 * **Rescheduling is a date mutation, not a reorder.** `task.reschedule` touches
 * `dueDate` and `dueTime` and nothing else, so dragging a task from Tuesday to
 * Friday leaves its manual `sortOrder` exactly where it was. Conflating the two
 * is the classic calendar bug: your carefully ordered list silently reshuffles
 * because you moved something in a different view.
 */

function CalendarSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-[30px] w-full max-w-xs" />
      <Skeleton className="h-[64px] w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  )
}

/**
 * Turns a droppable id back into the date and time it represents.
 *
 * `date:YYYY-MM-DD` is a month cell — a date with no time, so a dragged task
 * keeps whatever time it already had. `slot:YYYY-MM-DD:HH:mm` is a quarter-hour
 * in the time grid, and it already *is* the answer: the grid renders one target
 * per snap interval, so the landing time needs no measuring and cannot drift
 * with the scroll position.
 */
function parseDropTarget(id: string): { date: DateStr; time: TimeStr | null } | null {
  if (id.startsWith('date:')) {
    return { date: id.slice(5), time: null }
  }
  if (id.startsWith('slot:')) {
    const [, date, hour, minute] = id.split(':')
    if (!date || hour === undefined || minute === undefined) return null
    return { date, time: `${hour}:${minute}` }
  }
  return null
}

export function CalendarView() {
  const data = useCalendar()
  const [searchParams] = useSearchParams()
  const { dispatch, run, pending } = useCommands()
  const tagActions = useTagActions()

  const mode = useCalendarUiStore((s) => s.mode)
  const anchor = useCalendarUiStore((s) => s.anchor)
  const selectedDate = useCalendarUiStore((s) => s.selectedDate)
  const status = useCalendarUiStore((s) => s.status)
  const setMode = useCalendarUiStore((s) => s.setMode)
  const setAnchor = useCalendarUiStore((s) => s.setAnchor)
  const select = useCalendarUiStore((s) => s.select)
  const setStatus = useCalendarUiStore((s) => s.setStatus)
  const goTo = useCalendarUiStore((s) => s.goTo)
  const setDragging = useCalendarUiStore((s) => s.setDragging)

  const openTaskId = useTaskUiStore((s) => s.openTaskId)
  const openTask = useTaskUiStore((s) => s.openTask)
  const quickAddOpen = useTaskUiStore((s) => s.quickAddOpen)
  const setQuickAddOpen = useTaskUiStore((s) => s.setQuickAddOpen)

  /** The date a new task defaults to, and the time when one was picked. */
  const [draftSlot, setDraftSlot] = useState<{ date: DateStr; time: TimeStr | null } | null>(null)

  /*
   * `?view=` is an *entry point*, not a second source of truth: `/week` and
   * `/day` navigate here with it, the store adopts it once, and the store owns
   * the mode from then on. Writing it back on every toggle would fill the
   * history with view switches nobody wants to walk back through.
   */
  const paramView = searchParams.get('view')
  useEffect(() => {
    if (paramView !== null && isCalendarMode(paramView)) setMode(paramView)
  }, [paramView, setMode])

  // The store has no clock, so the first anchor comes from the view model,
  // which got it from the clock port.
  useEffect(() => {
    if (anchor === null && data) setAnchor(data.anchor)
  }, [anchor, data, setAnchor])

  const today = data?.today ?? null
  const current = selectedDate ?? data?.anchor ?? null

  const move = useCallback(
    (delta: number) => {
      if (current === null) return
      goTo(addDays(current, delta))
    },
    [current, goTo],
  )

  const shift = useCallback(
    (delta: number) => {
      // From the *store's* anchor, not the view model's: the query is async, so
      // two quick clicks would both read the same stale period and collapse
      // into one step.
      const from = anchor ?? data?.anchor ?? null
      if (from === null) return
      const next = shiftPeriod(mode, from, delta)
      setAnchor(next)
      // Selection follows the period rather than being stranded off-screen.
      select(next)
    },
    [anchor, data?.anchor, mode, setAnchor, select],
  )

  const goToday = useCallback(() => {
    if (today !== null) goTo(today)
  }, [today, goTo])

  const openDay = useCallback(
    (date: DateStr) => {
      goTo(date)
      setMode('day')
    },
    [goTo, setMode],
  )

  useCalendarShortcuts({
    mode,
    selectedDate: current,
    enabled: openTaskId === null && draftSlot === null,
    onMoveDays: move,
    onPreviousPeriod: () => shift(-1),
    onNextPeriod: () => shift(1),
    onToday: goToday,
    onMode: setMode,
    onOpenSelected: () => {
      if (current !== null) openDay(current)
    },
  })

  // ------------------------------------------------------------- mutations

  const toggle = useCallback(
    (task: Task) =>
      void dispatch(
        { kind: 'task.toggle', source: 'ui', raw: '', ref: { by: 'id', id: task.id } },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  /**
   * The only way the calendar changes a date.
   *
   * `task.reschedule` is a *date* intent: it writes `dueDate` and `dueTime` and
   * emits `task.rescheduled`. It never touches `sortOrder`, which is what keeps
   * a calendar drag from silently reordering the task lists.
   */
  const reschedule = useCallback(
    (task: Task, dueDate: DateStr | null, dueTime: TimeStr | null) =>
      void dispatch(
        {
          kind: 'task.reschedule',
          source: 'ui',
          raw: '',
          ref: { by: 'id', id: task.id },
          dueDate,
          dueTime,
        },
        { notify: 'always' },
      ),
    [dispatch],
  )

  const sensors = useSensors(
    // Slop, so clicking a chip to open it never starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const byId = useMemo(() => {
    const map = new Map<string, Task>()
    for (const day of data?.days ?? []) for (const task of day.tasks) map.set(task.id, task)
    for (const task of data?.unscheduled ?? []) map.set(task.id, task)
    return map
  }, [data?.days, data?.unscheduled])

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const task = byId.get(String(active.id))
    if (!task) return

    const target = parseDropTarget(String(over.id))
    if (!target) return

    // Dropping a task where it already is should not write a row or log an event.
    const nextTime = target.time ?? task.dueTime
    if (task.dueDate === target.date && task.dueTime === nextTime) return

    reschedule(task, target.date, nextTime)
  }

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const task = byId.get(String(active.id))
        return task ? `Picked up ${task.title}. Use the arrow keys to choose a day.` : undefined
      },
      onDragOver: ({ over }) => {
        if (!over) return undefined
        const target = parseDropTarget(String(over.id))
        return target
          ? `Over ${formatFullDate(target.date)}${target.time ? ` at ${target.time}` : ''}.`
          : undefined
      },
      onDragEnd: ({ active, over }) => {
        const task = byId.get(String(active.id))
        if (!task) return undefined
        if (!over) return `${task.title} was left where it was.`
        const target = parseDropTarget(String(over.id))
        return target
          ? `${task.title} moved to ${formatFullDate(target.date)}${target.time ? ` at ${target.time}` : ''}.`
          : `${task.title} was left where it was.`
      },
      onDragCancel: ({ active }) => {
        const task = byId.get(String(active.id))
        return task ? `Cancelled. ${task.title} is unchanged.` : undefined
      },
    }),
    [byId],
  )

  // ------------------------------------------------------------- creation

  /** Quick add, through the same pipeline every other surface uses. */
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
    setDraftSlot(null)
    return true
  }

  const startDraft = (date: DateStr, time: TimeStr | null) => {
    setDraftSlot({ date, time })
    select(date)
    setQuickAddOpen(true)
  }

  return (
    <section className="flex flex-col gap-3">
      <DataView<CalendarData> data={data} loading={<CalendarSkeleton />} isEmpty={() => false}>
        {(value) => (
          <div className="flex flex-col gap-3">
            <CalendarToolbar
              data={value}
              status={status}
              onPrevious={() => shift(-1)}
              onNext={() => shift(1)}
              onToday={goToday}
              onMode={setMode}
              onStatus={(next: TaskStatusFilter) => setStatus(next)}
              onNewTask={() => startDraft(current ?? value.today, null)}
            />

            {/* Capture, pre-dated to the day in hand. The composer receives the
                date; the parser is untouched, so `tomorrow` still means what it
                means everywhere else. */}
            <QuickAddBar
              key={draftSlot ? `${draftSlot.date}:${draftSlot.time ?? 'all'}` : 'plain'}
              today={value.today}
              tags={value.tags}
              projects={value.projects}
              defaultDueDate={draftSlot?.date ?? current ?? null}
              defaultDueTime={draftSlot?.time ?? null}
              autoExpand={draftSlot !== null}
              busy={pending}
              autoFocus={quickAddOpen}
              onSubmitText={submitText}
              onSubmitForm={submitForm}
              onCreateTag={tagActions.create}
              onDismiss={() => {
                setDraftSlot(null)
                setQuickAddOpen(false)
              }}
            />

            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              /*
               * Auto-scroll off. A quarter-hour slot is eleven pixels tall, and
               * a grid that scrolls itself under the pointer while you aim at
               * one makes the drop land somewhere you did not choose. Dragging
               * is therefore within what you can see; anything further is a
               * date change, which the task's own panel does precisely.
               */
              autoScroll={false}
              accessibility={{ announcements }}
              onDragStart={({ active }) => setDragging(String(active.id))}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDragging(null)}
            >
              <div className="flex flex-col gap-3 xl:flex-row">
                <div className="min-w-0 flex-1">
                  {value.mode === 'month' ? (
                    <MonthView
                      data={value}
                      selectedDate={current}
                      onSelectDay={select}
                      onOpenDay={openDay}
                      onOpenTask={(task) => openTask(task.id)}
                      onToggleTask={toggle}
                    />
                  ) : null}

                  {value.mode === 'week' ? (
                    <>
                      {/* A seven-column time axis needs room; below `lg` the
                          week becomes a stack of days instead of a grid nobody
                          can read. */}
                      <div className="hidden lg:block">
                        <CalendarTimeGrid
                          days={value.days}
                          today={value.today}
                          projects={value.projects}
                          selectedDate={current}
                          onOpenTask={(task) => openTask(task.id)}
                          onToggleTask={toggle}
                          onSelectDay={select}
                          onPickSlot={startDraft}
                        />
                      </div>
                      <div className="flex flex-col gap-2 lg:hidden">
                        {value.days.map((day) => (
                          <DayAgenda
                            key={day.date}
                            day={day}
                            today={value.today}
                            projects={value.projects}
                            selected={day.date === current}
                            onOpenTask={(task) => openTask(task.id)}
                            onToggleTask={toggle}
                            onSelectDay={select}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}

                  {value.mode === 'day' ? (
                    <CalendarTimeGrid
                      days={value.days}
                      today={value.today}
                      projects={value.projects}
                      selectedDate={current}
                      onOpenTask={(task) => openTask(task.id)}
                      onToggleTask={toggle}
                      onSelectDay={select}
                      onPickSlot={startDraft}
                    />
                  ) : null}
                </div>

                <UnscheduledPanel
                  tasks={value.unscheduled}
                  total={value.unscheduledTotal}
                  today={value.today}
                  projects={value.projects}
                  onOpenTask={(task) => openTask(task.id)}
                  onToggleTask={toggle}
                  className="xl:w-[240px] xl:shrink-0"
                />
              </div>
            </DndContext>

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> day
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>[</Kbd>
                <Kbd>]</Kbd> period
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>enter</Kbd> open day
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>shift M</Kbd>
                <Kbd>W</Kbd>
                <Kbd>D</Kbd> view
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>home</Kbd> today
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>N</Kbd> capture
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
    </section>
  )
}
