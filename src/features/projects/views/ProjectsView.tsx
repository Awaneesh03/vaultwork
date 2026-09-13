import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, FolderKanban, Inbox, Plus, TriangleAlert } from 'lucide-react'
import { DataView } from '@/components/feedback/DataView'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Skeleton } from '@/components/feedback/Skeleton'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { useCommands } from '@/hooks/useCommands'
import { cn } from '@/lib/cn'
import type { ProjectsViewData } from '@/services'
import { useProjectUiStore } from '@/store/projectUiStore'
import type { Id } from '@/types/entities'
import { ProjectComposer } from '../components/ProjectComposer'
import { ProjectList } from '../components/ProjectList'
import { ProjectProgress } from '../components/ProjectProgress'
import { ProjectToolbar } from '../components/ProjectToolbar'
import { useProject } from '../hooks/useProjectDetail'
import { useProjectListShortcuts } from '../hooks/useProjectListShortcuts'
import { useProjectsView } from '../hooks/useProjectsView'
import { toProjectPatch, type ProjectFormValue } from '../projectFormValue'

/**
 * The Projects screen.
 *
 * A dense list, not a card grid. A project is one line because the question you
 * bring to this screen is comparative — *which* of these needs attention — and
 * eight tiles you have to scan in two dimensions answers it worse than eight
 * rows you can read down.
 *
 * Every mutation leaves through `useCommands` as a CommandIntent. Nothing here
 * imports a service value or a repository, and there is no project logic in this
 * file at all: it renders, and it dispatches.
 */

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-[58px] w-full" />
      ))}
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'plain',
  icon,
}: {
  label: string
  value: string
  tone?: 'plain' | 'warn'
  icon?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1 t-eyebrow text-ink-3">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'tabular text-title font-semibold leading-tight',
          tone === 'warn' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function ProjectsView() {
  const data = useProjectsView()
  const navigate = useNavigate()
  const { dispatch, pending } = useCommands()

  const filter = useProjectUiStore((s) => s.filter)
  const sort = useProjectUiStore((s) => s.sort)
  const selectedProjectId = useProjectUiStore((s) => s.selectedProjectId)
  const composer = useProjectUiStore((s) => s.composer)
  const focusNonce = useProjectUiStore((s) => s.searchFocusNonce)

  // Zustand action identities are stable, so selecting them individually keeps
  // this component from re-rendering on every unrelated store write.
  const select = useProjectUiStore((s) => s.select)
  const openCreate = useProjectUiStore((s) => s.openCreate)
  const openEdit = useProjectUiStore((s) => s.openEdit)
  const closeComposer = useProjectUiStore((s) => s.closeComposer)
  const setSearch = useProjectUiStore((s) => s.setSearch)
  const setState = useProjectUiStore((s) => s.setState)
  const setProgress = useProjectUiStore((s) => s.setProgress)
  const setStatus = useProjectUiStore((s) => s.setStatus)
  const setSort = useProjectUiStore((s) => s.setSort)
  const clearFilter = useProjectUiStore((s) => s.clearFilter)
  const resetForView = useProjectUiStore((s) => s.resetForView)

  // Filters are per-visit, not per-app: arriving to find "archived only" still
  // applied is a good way to think you have no projects.
  useEffect(() => {
    resetForView()
  }, [resetForView])

  const editing = useProject(composer.mode === 'edit' ? composer.projectId : null)

  // Memoised because `archive` closes over it: a fresh array every render would
  // rebuild that callback, and with it the keyboard listener, on every keypress.
  const onScreen = useMemo(
    () => [...(data?.active ?? []), ...(data?.archived ?? [])],
    [data?.active, data?.archived],
  )
  const projectsOnScreen = useMemo(() => onScreen.map((entry) => entry.project), [onScreen])

  const open = useCallback((id: Id) => navigate(`/projects/${id}`), [navigate])

  const archive = useCallback(
    (id: Id) => {
      const summary = onScreen.find((entry) => entry.project.id === id)
      const archived = summary?.project.status === 'archived'
      void dispatch(
        archived
          ? { kind: 'project.unarchive', source: 'ui', raw: '', projectId: id }
          : { kind: 'project.archive', source: 'ui', raw: '', ref: { by: 'id', id } },
      )
    },
    [dispatch, onScreen],
  )

  const remove = useCallback(
    (id: Id) =>
      // No confirmation: the delete is soft, no task moves, and the toast holds
      // an undo. A dialog here would be theatre.
      void dispatch({ kind: 'project.delete', source: 'ui', raw: '', ref: { by: 'id', id } }),
    [dispatch],
  )

  const move = useCallback(
    (orderedIds: Id[], fromIndex: number, toIndex: number) =>
      void dispatch(
        { kind: 'project.move', source: 'ui', raw: '', orderedIds, fromIndex, toIndex },
        { notify: 'errors' },
      ),
    [dispatch],
  )

  useProjectListShortcuts({
    projects: projectsOnScreen,
    selectedProjectId,
    enabled: composer.mode === 'closed',
    onSelect: select,
    onOpen: (project) => open(project.id),
    onEdit: (project) => openEdit(project.id),
    onArchive: (project) => archive(project.id),
    onDelete: (project) => remove(project.id),
    onEscape: () => select(null),
  })

  const submit = async (value: ProjectFormValue) => {
    if (composer.mode === 'edit') {
      if (!editing) return
      const patch = toProjectPatch(value, editing)
      // Nothing changed — close rather than writing an event that says so.
      if (Object.keys(patch).length === 0) {
        closeComposer()
        return
      }
      const result = await dispatch({
        kind: 'project.update',
        source: 'ui',
        raw: '',
        projectId: editing.id,
        patch,
      })
      if (result.status === 'ok') closeComposer()
      return
    }

    const result = await dispatch({
      kind: 'project.add',
      source: 'ui',
      raw: '',
      name: value.name,
      description: value.description.trim().length > 0 ? value.description.trim() : null,
      color: value.color,
      icon: value.icon,
      status: value.status,
      deadline: value.deadline.length > 0 ? value.deadline : null,
    })
    if (result.status === 'ok') closeComposer()
  }

  const filtered =
    filter.progress !== 'any' || filter.status !== 'any' || filter.search.trim().length > 0

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <FolderKanban size={18} className="text-accent" aria-hidden />
          <h2 className="text-display font-semibold tracking-tight text-ink">Projects</h2>
          {data ? (
            <span className="tabular rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-2">
              {data.activeTotal}
            </span>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            icon={<Plus size={12} aria-hidden />}
          >
            New project
          </Button>
        </div>
        <p className="max-w-prose text-strong text-ink-2">
          Work with a lifecycle. Progress is computed from completed tasks every time it is read, so
          it cannot drift and cannot be faked.
        </p>
      </header>

      {data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Tasks" value={String(data.totals.total)} />
          <Metric label="Remaining" value={String(data.totals.remaining)} />
          <Metric
            label="Overdue"
            value={String(data.totals.overdue)}
            tone={data.totals.overdue > 0 ? 'warn' : 'plain'}
            {...(data.totals.overdue > 0 ? { icon: <TriangleAlert size={9} aria-hidden /> } : {})}
          />
          <Metric
            label="Inbox"
            value={String(data.inboxCount)}
            icon={<Inbox size={9} aria-hidden />}
          />
        </div>
      ) : null}

      {data && data.totals.total > 0 ? (
        <div className="flex items-center gap-2">
          <ProjectProgress
            percent={data.totals.progress}
            label={`${data.totals.completed} of ${data.totals.total} tasks complete across every project on screen`}
            className="flex-1"
          />
          <span className="tabular shrink-0 text-meta text-ink-3">
            {data.totals.progress}% across {onScreen.length} project
            {onScreen.length === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      {/* Rendered once, outside DataView: the toolbar is how you get *out* of
          an empty result, so it has to survive the empty state. */}
      <ProjectToolbar
        filter={filter}
        sort={sort}
        activeCount={data?.activeTotal ?? 0}
        archivedCount={data?.archivedTotal ?? 0}
        focusNonce={focusNonce}
        onSearch={setSearch}
        onState={setState}
        onProgress={setProgress}
        onStatus={setStatus}
        onSort={setSort}
      />

      <DataView<ProjectsViewData>
        data={data}
        loading={<ListSkeleton />}
        isEmpty={(value) => value.active.length === 0 && value.archived.length === 0}
        empty={
          <EmptyState
            icon={<FolderKanban size={20} aria-hidden />}
            title={filtered ? 'Nothing matches those filters' : 'No projects yet'}
            description={
              filtered
                ? `${(data?.activeTotal ?? 0) + (data?.archivedTotal ?? 0)} projects are hidden by the filters above.`
                : 'A project is a name you can file work under. Press N, or use /add project College.'
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
                  New project
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
                <ProjectList
                  summaries={value.active}
                  today={value.today}
                  selectedProjectId={selectedProjectId}
                  // Dragging only means something in manual order: reordering a
                  // list sorted by progress would be overwritten on next read.
                  sortable={sort === 'manual'}
                  onMove={move}
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
                  <span className="text-meta text-ink-3">— tasks kept, nothing deleted</span>
                </div>
                <ProjectList
                  summaries={value.archived}
                  today={value.today}
                  selectedProjectId={selectedProjectId}
                  sortable={false}
                  onMove={move}
                  onOpen={open}
                  onEdit={openEdit}
                  onArchive={archive}
                  onDelete={remove}
                  onSelect={select}
                />
              </section>
            ) : null}

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pt-1 text-meta text-ink-3">
              <span className="inline-flex items-center gap-1">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> move
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
                <Kbd>N</Kbd> new project
              </span>
            </p>
          </div>
        )}
      </DataView>

      {/* In edit mode the composer waits for its project. Mounting first and
          filling in afterwards shows a blank name for a frame, and the form
          would then be initialised from nothing. */}
      {composer.mode === 'create' ? (
        <ProjectComposer
          project={null}
          busy={pending}
          onSubmit={(value) => void submit(value)}
          onCancel={closeComposer}
        />
      ) : composer.mode === 'edit' && editing ? (
        <ProjectComposer
          project={editing}
          busy={pending}
          onSubmit={(value) => void submit(value)}
          onCancel={closeComposer}
        />
      ) : null}
    </section>
  )
}
