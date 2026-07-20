import Image from 'next/image'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader, surfaceItemClass } from '@/components/agent-ops/surface-card'
import { Avatar } from '@/components/catalyst/avatar'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

/** Inline KPI — quiet 10px label over a tabular value, hairline-separated from its neighbour. */
function InlineStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-l border-white/5 pl-4">
      <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="text-sm tabular-nums text-zinc-300">{children}</span>
    </div>
  )
}

/** Local `/public` paths skip the optimizer — in Docker standalone it often
 *  re-fetches itself and returns 400 ("received null"). Remote https still optimized. */
function isLocalPublicSrc(src: string): boolean {
  return src.startsWith('/')
}

/** Square thumbnail — cover photo, else logo, else initials. */
function ProjectImage({ project }: { project: ProjectOverviewItem }) {
  if (project.imageUrl) {
    return (
      <Image
        src={project.imageUrl}
        alt=""
        fill
        sizes="64px"
        unoptimized={isLocalPublicSrc(project.imageUrl)}
        className="object-cover"
      />
    )
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--accent-soft)]">
      <Avatar
        square
        src={project.logoUrl}
        initials={project.logoUrl ? undefined : project.name.slice(0, 2)}
        alt=""
        className="size-10 bg-black/40 text-white ring-1 ring-white/10"
      />
    </div>
  )
}

function ProjectRow({ project }: { project: ProjectOverviewItem }) {
  const hasWarnings = project.openWarnings > 0
  const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : '—'

  return (
    <div className={clsx(surfaceItemClass, 'group relative flex shrink-0 gap-4 p-4 transition duration-150 ease-out hover:-translate-y-px hover:bg-[var(--color-surface-focus)] hover:ring-1 hover:ring-[var(--accent-line)] motion-reduce:transition-none motion-reduce:hover:translate-y-0')}>
      {/* Thumbnail — a 64px square, no longer a full-height left column */}
      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/5 bg-black/40">
        <ProjectImage project={project} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/10 ring-inset"
        />
      </div>

      {/* Content — the name dominates its row */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/projects/${project.id}`}
                className="truncate rounded-sm text-base font-semibold text-white before:absolute before:inset-0 hover:underline focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
              >
                {project.name}
              </Link>
              <Badge color={hasWarnings ? 'zinc' : 'accent'} className="uppercase tracking-widest">
                {hasWarnings
                  ? `${project.openWarnings} ${project.openWarnings === 1 ? 'Alert' : 'Alerts'}`
                  : 'Healthy'}
              </Badge>
            </div>
            <span className="truncate font-mono text-xs text-zinc-500">
              {project.repoFullName ?? 'no repo linked'}
            </span>
          </div>

          {/* Two inline KPIs — Copilots + Success, hairline-separated */}
          <div className="flex shrink-0 items-start">
            <InlineStat label="Copilots">
              {project.activeCount}
              <span className="text-zinc-500"> / {project.copilotCount}</span>
            </InlineStat>
            <InlineStat label="Success">
              {project.passRate !== null ? (
                <span className={project.passRate >= 0.9 ? 'text-accent-400' : undefined}>
                  {formatPercent(project.passRate)}
                </span>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </InlineStat>
          </div>
        </div>

        {/* Meta — 24h runs · cost, fused onto one quiet line */}
        <div className="text-xs tabular-nums text-zinc-500">
          24h · {project.runsLast24h.toLocaleString()} runs · {cost}
        </div>
      </div>
    </div>
  )
}

export function DashboardProjectList({ projects }: { projects: ProjectOverviewItem[] }) {
  return (
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader
        title="Projects"
        meta={
          <Link href="/admin/projects/new" className="text-xs font-medium text-accent-400 hover:underline">
            + New Project
          </Link>
        }
      />
      {/* List fills the card to its bottom edge; xl:h-0 removes the list's intrinsic
          height so it stretches + scrolls instead of inflating the row. Stacked
          (below xl): natural height, page scrolls. Box stays fixed, data scrolls. */}
      {projects.length > 0 ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6 xl:h-0 xl:min-h-96">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No projects yet"
          description="Register the first product surface to see its delivery KPIs here."
          className="py-12"
          action={
            <Link href="/admin/projects/new" className="text-xs text-accent-400 hover:underline">
              New project
            </Link>
          }
        />
      )}
    </SurfaceCard>
  )
}
