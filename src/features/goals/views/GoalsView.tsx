import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Target } from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import type { GoalsViewData } from '@/services'
import { useGoalUiStore } from '@/store/goalUiStore'
import type { Id } from '@/types/entities'
import { GoalComposer } from '../components/GoalComposer'
import { GoalDetailPanel } from '../components/GoalDetailPanel'
import { GoalList } from '../components/GoalList'
import { GoalToolbar } from '../components/GoalToolbar'
import { MilestoneComposer } from '../components/MilestoneComposer'
import { useGoalListShortcuts } from '../hooks/useGoalListShortcuts'
import { useGoalDetail, useGoalsView } from '../hooks/useGoals'
import {
  dateOrNull,
  textOrNull,
  type GoalFormValue,
  type MilestoneFormValue,
} from '../goalFormValue'

/**
 * The Goals screen.
 *
 * The three ideas this screen exists to keep apart:
 *
 *   a **Goal** is an outcome — what you want to be true
 *   a **Milestone** is a checkpoint — how you will know you are getting there
 *   a **Task** is an action — the work itself, owned by M3 and untouched here
 *
 * Progress is milestones when a goal has them, related tasks when it does not,
 * and zero when it has neither — computed once in the service layer so this
 * screen and the Dashboard cannot disagree.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent, so completing
 * a goal here travels the same path a Telegram message will in M14. Nothing in
 * this file imports a service value or a repository.
 */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-[74px] w-full" />
      ))}
    </div>
  )
}

export function GoalsView() {
  const data = useGoalsView()
  const [searchParams] = useSearchParams()
  const { dispatch, pending } = useCommands()

  const filter = useGoalUiStore((s) => s.filter)
  const sort = useGoalUiStore((s) => s.sort)
  const selectedGoalId = useGoalUiStore((s) => s.selectedGoalId)
  const openGoalId = useGoalUiStore((s) => s.openGoalId)
  const composer = useGoalUiStore((s) => s.composer)
  const milestoneComposer = useGoalUiStore((s) => s.milestoneComposer)
  const focusNonce = useGoalUiStore((s) => s.searchFocusNonce)

  const select = useGoalUiStore((s) => s.select)
  const open = useGoalUiStore((s) => s.open)
  const openCreate = useGoalUiStore((s) => s.openCreate)
  const openEdit = useGoalUiStore((s) => s.openEdit)
  const closeComposer = useGoalUiStore((s) => s.closeComposer)
  const openMilestoneCreate = useGoalUiStore((s) => s.openMilestoneCreate)
  const openMilestoneEdit = useGoalUiStore((s) => s.openMilestoneEdit)
  const closeMilestoneComposer = useGoalUiStore((s) => s.closeMilestoneComposer)
  const setSearch = useGoalUiStore((s) => s.setSearch)
  const setState = useGoalUiStore((s) => s.setState)
  const setHealth = useGoalUiStore((s) => s.setHealth)
  const setSort = useGoalUiStore((s) => s.setSort)
  const clearFilter = useGoalUiStore((s) => s.clearFilter)
  const reset = useGoalUiStore((s) => s.reset)

  // Filters are per-visit: arriving to find "archived only" still applied is a
  // good way to think you have no goals.
  useEffect(() => {
    reset()
  }, [reset])

  // `?goal=` is an entry point, so `/goal dsa` can open one directly.
  const requested = searchParams.get('goal')
  useEffect(() => {
    if (requested) open(requested)
  }, [requested, open])

  const detail = useGoalDetail(openGoalId)
  const editing = useGoalDetail(composer.mode === 'edit' ? composer.goalId : null)

  const goals = useMemo(() => data?.goals ?? [], [data?.goals])
  const ids = useMemo(() => goals.map((item) => item.goal.id), [goals])

  const complete = useCallback(
    (goalId: Id) => {
      const item = goals.find((entry) => entry.goal.id === goalId)
      void dispatch(
        item?.goal.status === 'achieved'
          ? { kind: 'goal.reopen', source: 'ui', raw: '', goalId }
          : { kind: 'goal.complete', source: 'ui', raw: '', ref: { by: 'id', id: goalId } },
      )
    },
    [dispatch, goals],
  )

  const archive = useCallback(
    (goalId: Id) => {
      const item = goals.find((entry) => entry.goal.id === goalId)
      void dispatch(
        item?.goal.status === 'dropped'
          ? { kind: 'goal.unarchive', source: 'ui', raw: '', goalId }
          : { kind: 'goal.archive', source: 'ui', raw: '', ref: { by: 'id', id: goalId } },
      )
    },
    [dispatch, goals],
  )

  const remove = useCallback(
    (goalId: Id) => {
      // No confirmation: the delete is soft, the milestones and tasks are kept,
      // and the toast holds an undo.
      void dispatch({ kind: 'goal.delete', source: 'ui', raw: '', ref: { by: 'id', id: goalId } })
      if (openGoalId === goalId) open(null)
    },
    [dispatch, open, openGoalId],
  )

  const move = useCallback(
    (orderedIds: Id[], fromIndex: number, toIndex: number) =>
      void dispatch(
        { kind: 'goal.move', source: 'ui', raw: '', orderedIds, fromIndex, toIndex },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const toggleMilestone = useCallback(
    (milestoneId: Id) =>
      void dispatch(
        { kind: 'milestone.toggle', source: 'ui', raw: '', milestoneId },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  const deleteMilestone = useCallback(
    (milestoneId: Id) =>
      void dispatch({ kind: 'milestone.delete', source: 'ui', raw: '', milestoneId }),
    [dispatch],
  )

  const moveMilestone = useCallback(
    (orderedIds: Id[], fromIndex: number, toIndex: number) => {
      if (!detail) return
      void dispatch(
        {
          kind: 'milestone.move',
          source: 'ui',
          raw: '',
          goalId: detail.goal.id,
          orderedIds,
          fromIndex,
          toIndex,
        },
        { notify: 'errors' },
      )
    },
    [detail, dispatch],
  )

  useGoalListShortcuts({
    goalIds: ids,
    selectedGoalId,
    enabled:
      composer.mode === 'closed' && milestoneComposer.mode === 'closed' && openGoalId === null,
    onSelect: select,
    onOpen: open,
    onComplete: complete,
    onEdit: openEdit,
    onArchive: archive,
    onDelete: remove,
    onAddMilestone: openMilestoneCreate,
    onEscape: () => select(null),
  })

  const submitGoal = async (value: GoalFormValue) => {
    const why = textOrNull(value.why)
    const targetDate = dateOrNull(value.targetDate)

    if (composer.mode === 'edit') {
      if (!editing) return
      const result = await dispatch({
        kind: 'goal.update',
        source: 'ui',
        raw: '',
        goalId: editing.goal.id,
        patch: { title: value.title, why, horizon: value.horizon, targetDate },
      })
      if (result.status === 'ok') closeComposer()
      return
    }

    const created = await dispatch({
      kind: 'goal.add',
      source: 'ui',
      raw: '',
      title: value.title,
      why,
      targetDate,
    })
    if (created.status !== 'ok' || created.kind !== 'goal') return

    // The horizon is applied as one follow-up patch: `goal.add` carries the
    // three fields a goal is usually created with, and the form owns the rest.
    if (value.horizon !== created.goal.horizon) {
      await dispatch(
        {
          kind: 'goal.update',
          source: 'ui',
          raw: '',
          goalId: created.goal.id,
          patch: { horizon: value.horizon },
        },
        { notify: 'errors' },
      )
    }
    closeComposer()
  }

  const submitMilestone = async (value: MilestoneFormValue) => {
    const targetDate = dateOrNull(value.targetDate)

    if (milestoneComposer.mode === 'edit') {
      const result = await dispatch({
        kind: 'milestone.update',
        source: 'ui',
        raw: '',
        milestoneId: milestoneComposer.milestoneId,
        patch: { title: value.title, targetDate },
      })
      if (result.status === 'ok') closeMilestoneComposer()
      return
    }

    if (milestoneComposer.mode !== 'create') return
    const result = await dispatch({
      kind: 'milestone.add',
      source: 'ui',
      raw: '',
      goalId: milestoneComposer.goalId,
      title: value.title,
      targetDate,
    })
    if (result.status === 'ok') closeMilestoneComposer()
  }

  const counts = {
    active: data?.totals.active ?? 0,
    completed: data?.totals.completed ?? 0,
    archived: data?.totals.archived ?? 0,
    all: data?.totals.all ?? 0,
  }

  // The open panel is the more reliable source: a goal can be created from the
  // list and then filtered out of it, but the panel always holds the one open.
  const milestoneGoal =
    milestoneComposer.mode === 'create'
      ? (goals.find((item) => item.goal.id === milestoneComposer.goalId)?.goal ?? detail?.goal)
      : milestoneComposer.mode === 'edit'
        ? detail?.goal
        : undefined

  const editingMilestone =
    milestoneComposer.mode === 'edit'
      ? (detail?.milestoneViews.find(
          (view) => view.milestone.id === milestoneComposer.milestoneId,
        )?.milestone ?? null)
      : null

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <Target size={18} className="text-accent" aria-hidden />
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Goals</h2>
          {data ? (
            <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">
              {data.totals.active}
            </span>
          ) : null}
          {data && data.totals.overdue > 0 ? (
            <span className="rounded-sm bg-danger-soft px-1.5 py-0.5 text-[11.5px] text-danger">
              {data.totals.overdue} overdue
            </span>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            icon={<Plus size={12} aria-hidden />}
          >
            New goal
          </Button>
        </div>
        <p className="max-w-prose text-[13px] text-ink-2">
          A goal is an outcome, a milestone is a checkpoint, and a task is an action. Progress
          comes from milestones when a goal has them, and from its related tasks when it does
          not — completing a goal never completes its tasks.
        </p>
      </header>

      <GoalToolbar
        filter={filter}
        sort={sort}
        counts={counts}
        focusNonce={focusNonce}
        onSearch={setSearch}
        onState={setState}
        onHealth={setHealth}
        onSort={setSort}
      />

      <DataView<GoalsViewData>
        data={data}
        loading={<ListSkeleton />}
        isEmpty={(value) => value.goals.length === 0}
        empty={
          <EmptyState
            icon={<Target size={20} aria-hidden />}
            title={
              data?.empty ? 'No goals yet' : 'Nothing matches those filters'
            }
            description={
              data?.empty
                ? 'A goal is an outcome you want. Press N, or use /add goal Become strong in DSA.'
                : `${counts.all} goal${counts.all === 1 ? '' : 's'} are hidden by the filters above.`
            }
            action={
              data?.empty ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openCreate}
                  icon={<Plus size={12} aria-hidden />}
                >
                  New goal
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={clearFilter}
                  className="text-[12.5px] text-accent underline decoration-dotted"
                >
                  Clear filters
                </button>
              )
            }
          />
        }
      >
        {(value) => (
          <div className="flex flex-col gap-4">
            <GoalList
              items={value.goals}
              today={value.today}
              selectedGoalId={selectedGoalId}
              // Dragging under a computed sort would write an order the list is
              // not showing, so the grips come off unless the order is manual.
              // A filtered list is fine: the drop lands between the neighbours
              // actually on screen, which is what the user aimed at.
              sortable={sort === 'manual'}
              onMove={move}
              onOpen={open}
              onComplete={complete}
              onEdit={openEdit}
              onArchive={archive}
              onDelete={remove}
              onSelect={select}
            />

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-[11px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> move
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>space</Kbd> complete
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>enter</Kbd> open
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>E</Kbd> edit
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>M</Kbd> milestone
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>shift A</Kbd> archive
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>N</Kbd> new goal
              </span>
            </p>
          </div>
        )}
      </DataView>

      {composer.mode === 'create' ? (
        <GoalComposer
          goal={null}
          busy={pending}
          onSubmit={(value) => void submitGoal(value)}
          onCancel={closeComposer}
        />
      ) : composer.mode === 'edit' && editing ? (
        <GoalComposer
          goal={editing.goal}
          busy={pending}
          onSubmit={(value) => void submitGoal(value)}
          onCancel={closeComposer}
        />
      ) : null}

      {milestoneComposer.mode !== 'closed' && milestoneGoal ? (
        <MilestoneComposer
          milestone={editingMilestone}
          goalTitle={milestoneGoal.title}
          busy={pending}
          onSubmit={(value) => void submitMilestone(value)}
          onCancel={closeMilestoneComposer}
        />
      ) : null}

      {detail ? (
        <GoalDetailPanel
          detail={detail}
          busy={pending}
          onClose={() => open(null)}
          onComplete={() => complete(detail.goal.id)}
          onEdit={() => {
            open(null)
            openEdit(detail.goal.id)
          }}
          onArchive={() => archive(detail.goal.id)}
          onDelete={() => remove(detail.goal.id)}
          onAddMilestone={() => openMilestoneCreate(detail.goal.id)}
          onToggleMilestone={toggleMilestone}
          onEditMilestone={openMilestoneEdit}
          onDeleteMilestone={deleteMilestone}
          onMoveMilestone={moveMilestone}
        />
      ) : null}
    </section>
  )
}
