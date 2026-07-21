import { EmptyState } from '@/components/agent-ops/empty-state'
import { ProjectAvatar } from '@/components/agent-ops/project-avatar'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

export function DashboardProjectList({ projects }: { projects: ProjectOverviewItem[] }) {
  return (
    // Bounded box, scrolling data: the card caps at 34rem and the rows scroll inside.
    // `max-h` (not `h`) so a short list still shrinks to its content — no empty band.
    <SurfaceCard className="max-h-[34rem]">
      <SurfaceCardHeader
        title="Projects"
        density="compact"
        meta={
          <Link href="/admin/projects/new" className="text-xs font-medium text-accent-400 hover:underline">
            + New Project
          </Link>
        }
      />
      {projects.length > 0 ? (
        // The ONLY vertical scrollport of this card — `Table` drops its own
        // `overflow-x-auto` when `fixed`, so the sticky head below actually sticks.
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-950/5">
          <Table fixed className="w-full text-left [--gutter:--spacing(0)]">
            <TableHead className="sticky top-0 z-10 bg-(--color-surface-secondary)">
              <TableRow>
                <TableHeader className="pl-4!">Project</TableHeader>
                <TableHeader className="hidden w-24 text-right md:table-cell">Copilots</TableHeader>
                <TableHeader className="hidden w-24 text-right lg:table-cell">Success</TableHeader>
                <TableHeader className="hidden text-right sm:table-cell sm:w-28">
                  24h<span className="sr-only"> — runs and cost over the last 24 hours</span>
                </TableHeader>
                <TableHeader className="w-28 pr-4! pl-2! text-right sm:w-32 sm:pl-4!">Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((project) => {
                const hasWarnings = project.openWarnings > 0
                const hasSignal = project.passRate !== null || project.runsLast24h > 0
                const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : '—'
                // ONE notion of "has a logo" for both the image and the initials fallback:
                // `??` on one side and `||` on the other made an empty-string imageUrl
                // render a blank <img> AND suppress the initials.
                const logo = project.imageUrl || project.logoUrl || null
                return (
                  <TableRow
                    key={project.id}
                    href={`/admin/projects/${project.id}`}
                    // Real accessible name for the full-row link (rendered as aria-label).
                    title={`Open project ${project.name}`}
                    className="group h-14"
                  >
                    {/* py-2! is load-bearing, not decoration: it holds every row at h-14
                        (56px) including the two-line 24h cell, so it must beat the
                        primitive's own py-*, which class order alone would not do. */}
                    <TableCell className="py-2! pl-4!">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProjectAvatar name={project.name} src={logo} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900 dark:text-white group-hover:underline">{project.name}</div>
                          <div className="truncate font-mono text-xs text-zinc-500">
                            {project.repoFullName ?? 'no repo linked'}
                          </div>
                          {/* Below sm the 24h column is dropped so Project keeps the
                              majority of the width; its two values move here rather
                              than being squeezed into 48px and spilling left. */}
                          <div className="truncate font-mono text-xs tabular-nums text-zinc-500 sm:hidden">
                            {project.runsLast24h.toLocaleString()} runs · {cost}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2! text-right font-mono text-sm tabular-nums text-zinc-600 md:table-cell">
                      {project.activeCount}<span className="text-zinc-400"> / {project.copilotCount}</span>
                    </TableCell>
                    <TableCell className="hidden py-2! text-right font-mono text-sm tabular-nums text-zinc-600 lg:table-cell">
                      {project.passRate === null ? '—' : formatPercent(project.passRate)}
                    </TableCell>
                    <TableCell className="hidden py-2! text-right sm:table-cell">
                      <div className="font-mono text-sm tabular-nums text-zinc-600">
                        {project.runsLast24h.toLocaleString()} runs
                      </div>
                      <div className="font-mono text-xs tabular-nums text-zinc-500">{cost}</div>
                    </TableCell>
                    <TableCell className="py-2! pr-4! pl-2! text-right sm:pl-4!">
                      {hasWarnings ? (
                        <Badge color="zinc" className="uppercase tracking-widest">
                          {project.openWarnings} alert{project.openWarnings === 1 ? '' : 's'}
                        </Badge>
                      ) : hasSignal ? (
                        <Badge color="accent" className="uppercase tracking-widest">
                          Healthy
                        </Badge>
                      ) : (
                        // Same rule as /admin/projects: no warnings is not evidence
                        // of health. A project with no pass rate and no runs has
                        // produced no observation to call healthy.
                        <span className="font-mono text-xs text-zinc-500">no signal</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No projects yet"
          description="Register the first product surface to see its delivery KPIs here."
          className="py-12"
          action={
            <SoftAccentLink href="/admin/projects/new">New project</SoftAccentLink>
          }
        />
      )}
    </SurfaceCard>
  )
}
