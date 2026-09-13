import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, Plus, Repeat } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import type { HabitsViewData } from '@/services'
import { useHabitUiStore } from '@/store/habitUiStore'
import type { Id } from '@/types/entities'
import { HabitComposer } from '../components/HabitComposer'
import { HabitDetailPanel } from '../components/HabitDetailPanel'
import { HabitList } from '../components/HabitList'
import { HabitToolbar } from '../components/HabitToolbar'
import { useHabitListShortcuts } from '../hooks/useHabitListShortcuts'
import { useHabitDetail, useHabitsView } from '../hooks/useHabits'
import { toHabitInput, toHabitPatch, type HabitFormValue } from '../habitFormValue'

/**
 * The Habits screen.
 *
 * A habit is a *definition*; a habit entry is a *record of what happened*. This
 * screen shows the first and writes the second, and it never creates a record
 * for a day that has not occurred — ticking today writes exactly one row, and
 * tomorrow stays empty until tomorrow.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent, so completing
 * a habit here travels the same path a Telegram message will in M14. Nothing in
 * this file imports a service value or a repository.
 */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[62px] w-full" />
      ))}
    </div>
  )
}

export function HabitsView() {
  const data = useHabitsView()
  const [searchParams] = useSearchParams()
  const { dispatch, pending } = useCommands()

  const filter = useHabitUiStore((s) => s.filter)
  const selectedHabitId = useHabitUiStore((s) => s.selectedHabitId)
  const openHabitId = useHabitUiStore((s) => s.openHabitId)
  const composer = useHabitUiStore((s) => s.composer)
  const focusNonce = useHabitUiStore((s) => s.searchFocusNonce)

  const select = useHabitUiStore((s) => s.select)
  const open = useHabitUiStore((s) => s.open)
  const openCreate = useHabitUiStore((s) => s.openCreate)
  const openEdit = useHabitUiStore((s) => s.openEdit)
  const closeComposer = useHabitUiStore((s) => s.closeComposer)
  const setSearch = useHabitUiStore((s) => s.setSearch)
  const setState = useHabitUiStore((s) => s.setState)
  const setToday = useHabitUiStore((s) => s.setToday)
  const setFrequency = useHabitUiStore((s) => s.setFrequency)
  const clearFilter = useHabitUiStore((s) => s.clearFilter)
  const reset = useHabitUiStore((s) => s.reset)

  // Filters are per-visit: arriving to find "archived only" still applied is a
  // good way to think you have no habits.
  useEffect(() => {
    reset()
  }, [reset])

  // `?habit=` is an entry point, so `/habit reading` can open one directly.
  const requested = searchParams.get('habit')
  useEffect(() => {
    if (requested) open(requested)
  }, [requested, open])

  const detail = useHabitDetail(openHabitId)
  const editing = useHabitDetail(composer.mode === 'edit' ? composer.habitId : null)

  const onScreen = useMemo(
    () => [...(data?.active ?? []), ...(data?.archived ?? [])],
    [data?.active, data?.archived],
  )
  const ids = useMemo(() => onScreen.map((item) => item.habit.id), [onScreen])

  const toggle = useCallback(
    (habitId: Id) =>
      void dispatch({ kind: 'habit.toggle', source: 'ui', raw: '', habitId }, { notify: 'errors' }),
    [dispatch],
  )

  const archive = useCallback(
    (habitId: Id) => {
      const item = onScreen.find((entry) => entry.habit.id === habitId)
      const archived = item?.habit.archivedAt !== null && item !== undefined
      void dispatch(
        archived
          ? { kind: 'habit.unarchive', source: 'ui', raw: '', habitId }
          : { kind: 'habit.archive', source: 'ui', raw: '', ref: { by: 'id', id: habitId } },
      )
    },
    [dispatch, onScreen],
  )

  const remove = useCallback(
    (habitId: Id) =>
      // No confirmation: the delete is soft, the history is kept, and the toast
      // holds an undo.
      void dispatch({
        kind: 'habit.delete',
        source: 'ui',
        raw: '',
        ref: { by: 'id', id: habitId },
      }),
    [dispatch],
  )

  const move = useCallback(
    (orderedIds: Id[], fromIndex: number, toIndex: number) =>
      void dispatch(
        { kind: 'habit.move', source: 'ui', raw: '', orderedIds, fromIndex, toIndex },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  useHabitListShortcuts({
    habitIds: ids,
    selectedHabitId,
    enabled: composer.mode === 'closed' && openHabitId === null,
    onSelect: select,
    onOpen: open,
    onToggle: toggle,
    onEdit: openEdit,
    onArchive: archive,
    onDelete: remove,
    onEscape: () => select(null),
  })

  const submit = async (value: HabitFormValue) => {
    if (composer.mode === 'edit') {
      if (!editing) return
      const patch = toHabitPatch(value, editing.habit)
      if (Object.keys(patch).length === 0) {
        closeComposer()
        return
      }
      const result = await dispatch({
        kind: 'habit.update',
        source: 'ui',
        raw: '',
        habitId: editing.habit.id,
        patch,
      })
      if (result.status === 'ok') closeComposer()
      return
    }

    // Creation goes through the command layer, then the schedule is applied as
    // one follow-up patch — the intent carries a name and a colour, and the
    // form owns the translation from "frequency" to the model's two fields.
    const created = await dispatch({
      kind: 'habit.add',
      source: 'ui',
      raw: '',
      name: value.name,
      color: value.color,
    })
    if (created.status !== 'ok' || created.kind !== 'habit') return

    const input = toHabitInput(value)
    await dispatch(
      {
        kind: 'habit.update',
        source: 'ui',
        raw: '',
        habitId: created.habit.id,
        patch: {
          cadence: input.cadence ?? 'daily',
          daysOfWeek: input.daysOfWeek ?? [],
          targetPerWeek: input.targetPerWeek ?? null,
        },
      },
      { notify: 'errors' },
    )
    closeComposer()
  }

  const filtered =
    filter.today !== 'any' || filter.frequency !== 'any' || filter.search.trim().length > 0

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        icon={<Repeat size={15} aria-hidden />}
        title="Habits"
        description="A habit is what you intend to repeat; its history is what actually happened. Days a habit is not scheduled never count against it."
        meta={data ? <span className="tabular">{data.activeTotal} active</span> : null}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            icon={<Plus size={12} aria-hidden />}
          >
            New habit
          </Button>
        }
      />

      {data ? (
        <div
          className="flex flex-wrap items-center gap-3 panel px-3 py-2"
          aria-label="Today's habits"
        >
          <span className="t-eyebrow text-ink-3">Today</span>
          <span
            className="tabular text-title font-semibold text-ink"
            aria-label={`${data.summary.completed} of ${data.summary.scheduled} habits complete today`}
          >
            {data.summary.completed} / {data.summary.scheduled}
          </span>
          <span className="text-body text-ink-3">
            {data.summary.scheduled === 0
              ? 'Nothing scheduled today.'
              : data.summary.remaining === 0
                ? 'All done.'
                : `${data.summary.remaining} to go`}
          </span>
          <span className="flex-1" />
          <div
            className="h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Today's habit completion"
            aria-valuenow={data.summary.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${data.summary.percent}%`}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[var(--duration-base)]"
              style={{ width: `${data.summary.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      <HabitToolbar
        filter={filter}
        activeCount={data?.activeTotal ?? 0}
        archivedCount={data?.archivedTotal ?? 0}
        focusNonce={focusNonce}
        onSearch={setSearch}
        onState={setState}
        onToday={setToday}
        onFrequency={setFrequency}
      />

      <DataView<HabitsViewData>
        data={data}
        loading={<ListSkeleton />}
        isEmpty={(value) => value.active.length === 0 && value.archived.length === 0}
        empty={
          <EmptyState
            icon={<Repeat size={20} aria-hidden />}
            title={filtered ? 'Nothing matches those filters' : 'No habits yet'}
            description={
              filtered
                ? `${(data?.activeTotal ?? 0) + (data?.archivedTotal ?? 0)} habits are hidden by the filters above.`
                : 'A habit is something you want to repeat. Press N, or use /add habit Read 20 pages.'
            }
            action={
              filtered ? (
                <button
                  type="button"
                  onClick={clearFilter}
                  className="text-body text-accent underline decoration-dotted"
                >
                  Clear filters
                </button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openCreate}
                  icon={<Plus size={12} aria-hidden />}
                >
                  New habit
                </Button>
              )
            }
          />
        }
      >
        {(value) => (
          <div className="flex flex-col gap-5">
            {value.active.length > 0 ? (
              <section className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 px-2">
                  <h3 className="t-eyebrow text-ink-3">Active</h3>
                  <span className="tabular text-meta text-ink-3">{value.active.length}</span>
                </div>
                <HabitList
                  items={value.active}
                  selectedHabitId={selectedHabitId}
                  sortable
                  onMove={move}
                  onToggle={toggle}
                  onOpen={open}
                  onEdit={openEdit}
                  onArchive={archive}
                  onDelete={remove}
                  onSelect={select}
                />
              </section>
            ) : null}

            {value.archived.length > 0 ? (
              <section className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 px-2">
                  <h3 className="inline-flex items-center gap-1.5 t-eyebrow text-ink-3">
                    <Archive size={11} aria-hidden />
                    Archived
                  </h3>
                  <span className="tabular text-meta text-ink-3">{value.archived.length}</span>
                  <span className="text-meta text-ink-3">— history kept</span>
                </div>
                <HabitList
                  items={value.archived}
                  selectedHabitId={selectedHabitId}
                  sortable={false}
                  onMove={move}
                  onToggle={toggle}
                  onOpen={open}
                  onEdit={openEdit}
                  onArchive={archive}
                  onDelete={remove}
                  onSelect={select}
                />
              </section>
            ) : null}

            <p
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-meta text-ink-3',
              )}
            >
              <span className="inline-flex items-center gap-1">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> move
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>space</Kbd> today
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>enter</Kbd> open
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>E</Kbd> edit
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>shift A</Kbd> archive
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>N</Kbd> new habit
              </span>
            </p>
          </div>
        )}
      </DataView>

      {composer.mode === 'create' ? (
        <HabitComposer
          habit={null}
          busy={pending}
          onSubmit={(value) => void submit(value)}
          onCancel={closeComposer}
        />
      ) : composer.mode === 'edit' && editing ? (
        <HabitComposer
          habit={editing.habit}
          busy={pending}
          onSubmit={(value) => void submit(value)}
          onCancel={closeComposer}
        />
      ) : null}

      {detail ? (
        <HabitDetailPanel
          detail={detail}
          busy={pending}
          onClose={() => open(null)}
          onToggle={() => toggle(detail.habit.id)}
          onEdit={() => {
            open(null)
            openEdit(detail.habit.id)
          }}
          onArchive={() => archive(detail.habit.id)}
          onDelete={() => {
            open(null)
            remove(detail.habit.id)
          }}
        />
      ) : null}
    </section>
  )
}
