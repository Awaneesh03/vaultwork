import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { ROUTES } from '@/app/navigation'
import { ProjectProgress } from '@/features/projects/components/ProjectProgress'
import { projectColorVar, projectIcon } from '@/features/projects/projectAppearance'
import { daysBetween, formatDayLabel } from '@/lib/date'
import type { ProjectSummary } from '@/services'
import type { DateStr } from '@/types/entities'

/** How far ahead a project deadline is worth mentioning on Today (M19). */
const DEADLINE_HORIZON_DAYS = 7

/**
 * "Deadline tomorrow", "Deadline passed Mon 14 Sep" — or nothing, when the
 * deadline is far enough off that saying so is noise. Words, not colour alone.
 */
function deadlineNote(deadline: DateStr | null, today: DateStr | undefined): string | null {
  if (deadline === null || today === undefined) return null
  const days = daysBetween(today, deadline)
  if (days < 0) return `Deadline passed ${formatDayLabel(deadline, today)}`
  if (days > DEADLINE_HORIZON_DAYS) return null
  const label = formatDayLabel(deadline, today)
  return `Deadline ${days <= 1 ? label.toLowerCase() : label}`
}

/**
 * Active projects, at a glance.
 *
 * Every number comes from M4's `summarise` — the same derivation the Projects
 * screen renders, so a project cannot read 40% here and 60% there. Not one
 * statistic is computed in this file.
 *
 * Archived projects are filtered out in the query service, not here: what
 * counts as active is a domain question, and answering it in JSX is how two
 * screens end up disagreeing about it.
 */
export function DashboardProjects({
  projects,
  today,
}: {
  projects: ProjectSummary[]
  /** M19: when given, an approaching or passed deadline is named on its row. */
  today?: DateStr
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {projects.map(({ project, stats }) => {
        const Icon = projectIcon(project.icon)
        const accent = projectColorVar(project.color)

        return (
          <li key={project.id}>
            <Link
              to={ROUTES.project(project.id)}
              className="flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-elevated"
            >
              <span
                aria-hidden
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded"
                style={{
                  backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
                  color: accent,
                }}
              >
                <Icon size={11} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-strong text-ink">{project.name}</span>
                  {stats.overdue > 0 ? (
                    <span className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-danger-soft px-1 text-micro text-danger">
                      <TriangleAlert size={9} aria-hidden />
                      {stats.overdue}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <ProjectProgress
                    percent={stats.progress}
                    label={`${stats.completed} of ${stats.total} tasks complete in ${project.name}`}
                    accent={accent}
                    className="min-w-[40px] flex-1"
                  />
                  <span className="tabular shrink-0 text-micro text-ink-3">
                    {stats.remaining} left
                  </span>
                </span>
                {deadlineNote(project.deadline, today) !== null ? (
                  <span className="mt-0.5 block text-micro text-warn">
                    {deadlineNote(project.deadline, today)}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
