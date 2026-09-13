import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { ROUTES } from '@/app/navigation'
import { ProjectProgress } from '@/features/projects/components/ProjectProgress'
import { projectColorVar, projectIcon } from '@/features/projects/projectAppearance'
import type { ProjectSummary } from '@/services'

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
export function DashboardProjects({ projects }: { projects: ProjectSummary[] }) {
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
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
