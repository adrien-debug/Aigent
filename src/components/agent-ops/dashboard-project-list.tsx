import { CpuChipIcon, ExclamationTriangleIcon, CodeBracketIcon } from '@heroicons/react/24/outline'
import Image from 'next/image'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Avatar } from '@/components/catalyst/avatar'
import { Link } from '@/components/catalyst/link'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

/** Internal KPI cell — same grammar as the top band: quiet 10px label above, tabular value below. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-[10px] font-medium uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="truncate font-mono text-sm tabular-nums text-white">{children}</span>
    </div>
  )
}

/** Left image slot of a project row — cover photo, else logo, else initials. */
function ProjectImage({ project }: { project: ProjectOverviewItem }) {
  if (project.imageUrl) {
    return <Image src={project.imageUrl} alt="" fill sizes="160px" className="object-cover" />
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--accent-soft)]">
      <Avatar
        square
        src={project.logoUrl}
        initials={project.logoUrl ? undefined : project.name.slice(0, 2)}
        alt=""
        className="size-12 bg-black/40 text-white ring-1 ring-white/10"
      />
    </div>
  )
}

function ProjectRow({ project }: { project: ProjectOverviewItem }) {
  const hasWarnings = project.openWarnings > 0

  return (
    <div className="group relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-white/5 bg-[var(--color-surface-elevated)] transition duration-200 ease-out hover:-translate-y-px hover:border-[var(--accent-line)] hover:bg-[var(--color-surface-focus)] hover:shadow-md hover:shadow-black/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-row">
      {/* Image slot — top banner on mobile, left column from sm up */}
      <div className="relative h-24 w-full shrink-0 overflow-hidden border-b border-white/5 bg-black/40 sm:h-auto sm:w-40 sm:self-stretch sm:border-r sm:border-b-0">
        <ProjectImage project={project} />
        {/* Seats the photo: inset hairline + soft bottom vignette. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/25 to-transparent ring-1 ring-white/10 ring-inset"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        {/* Name + repo + health */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/admin/projects/${project.id}`}
              className="truncate rounded-sm text-sm font-semibold text-white before:absolute before:inset-0 hover:underline focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
            >
              {project.name}
            </Link>
            <span className="mt-1 flex min-w-0 items-center gap-1.5">
              <CodeBracketIcon aria-hidden="true" className="size-3.5 shrink-0 text-zinc-500" />
              <span className="truncate font-mono text-xs text-zinc-400">
                {project.repoFullName ?? 'no repo linked'}
              </span>
            </span>
          </div>

          {/* Health — dot + label, no pill block (doctrine: status = label + solid accent mark) */}
          <div className="relative z-10 shrink-0 pt-0.5">
            {hasWarnings ? (
              <span className="inline-flex items-center gap-1.5 text-accent-300">
                <ExclamationTriangleIcon aria-hidden="true" className="size-3.5 shrink-0 text-accent-400" />
                <span className="text-[10px] font-medium uppercase tracking-widest">
                  {project.openWarnings} {project.openWarnings === 1 ? 'Alert' : 'Alerts'}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-zinc-400">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent-400" />
                <span className="text-[10px] font-medium uppercase tracking-widest">Healthy</span>
              </span>
            )}
          </div>
        </div>

        {/* Project KPIs */}
        <div className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-x-4 gap-y-3 border-t border-white/5 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <CpuChipIcon aria-hidden="true" className="size-5 shrink-0 text-accent-400" />
            <Stat label="Copilots">
              {project.activeCount}
              <span className="font-normal text-zinc-500"> / {project.copilotCount}</span>
            </Stat>
          </div>
          <Stat label="24h Runs">{project.runsLast24h.toLocaleString()}</Stat>
          <Stat label="Success">
            {project.passRate !== null ? (
              <span className={project.passRate >= 0.9 ? 'text-accent-400' : undefined}>
                {formatPercent(project.passRate)}
              </span>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </Stat>
          <Stat label="24h Cost">
            {project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : <span className="text-zinc-600">—</span>}
          </Stat>
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
      {/* List fills the card to its bottom edge (row height comes from the grid);
          xl:h-0 removes the list's intrinsic height so it stretches + scrolls
          instead of inflating the row. Stacked (below xl): natural height, page scrolls. */}
      {projects.length > 0 ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 xl:h-0 xl:min-h-96">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No projects yet"
          description="Register the first product surface to see its delivery KPIs here."
          className="py-16"
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
