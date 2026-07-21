import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'

const MAX_PROJECTS = 8

/**
 * ActivityByProjectChart — horizontal bars of `runsLast24h` per project
 * (already rolled up server-side on `ProjectOverviewItem`, no extra fetch/
 * bucketing needed). Top N by run count, real project names, accent bars.
 */
export function ActivityByProjectChart({ projects }: { projects: ProjectOverviewItem[] }) {
  const rows = [...projects]
    .filter((p) => p.runsLast24h > 0)
    .sort((a, b) => b.runsLast24h - a.runsLast24h)
    .slice(0, MAX_PROJECTS)

  if (rows.length === 0) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title="Activity by project — 24h" className="px-4 pt-3 pb-2" />
        <EmptyState title="No project activity" description="No project recorded any runs in the last 24h." />
      </SurfaceCard>
    )
  }

  const maxRuns = Math.max(...rows.map((r) => r.runsLast24h))
  const totalRuns = rows.reduce((s, r) => s + r.runsLast24h, 0)

  return (
    <SurfaceCard className="h-full">
      <SurfaceCardHeader
        title="Activity by project — 24h"
        className="px-4 pt-3 pb-2"
        meta={<span className="font-mono text-xs text-zinc-400 tabular-nums">{totalRuns} runs</span>}
      />
      <div className="flex flex-1 flex-col justify-center gap-3 px-4 pt-1 pb-4">
        {rows.map((project) => (
          <div key={project.id} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-zinc-400" title={project.name}>
              {project.name}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-surface-sunken">
              <div
                className="h-full rounded-full bg-[var(--chart-success)]"
                style={{ width: `${Math.max((project.runsLast24h / maxRuns) * 100, 2)}%` }}
                title={`${project.name}: ${project.runsLast24h} runs`}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-300 tabular-nums">
              {project.runsLast24h}
            </span>
          </div>
        ))}
      </div>
    </SurfaceCard>
  )
}
