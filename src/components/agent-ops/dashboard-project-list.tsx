import { EmptyState } from '@/components/agent-ops/empty-state'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Avatar } from '@/components/catalyst/avatar'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

export function DashboardProjectList({ projects }: { projects: ProjectOverviewItem[] }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Projects"
        className="px-4 pt-4 pb-3"
        meta={
          <Link href="/admin/projects/new" className="text-xs font-medium text-accent-400 hover:underline">
            + New Project
          </Link>
        }
      />
      {projects.length > 0 ? (
        <div className="min-w-0 border-t border-zinc-950/5">
          <Table dense fixed className="w-full border-collapse text-left [--gutter:--spacing(0)]">
            <TableHead className="bg-(--color-surface-secondary)">
              <TableRow>
                <TableHeader className="pl-4!">Project</TableHeader>
                <TableHeader className="hidden w-24 text-right md:table-cell">Copilots</TableHeader>
                <TableHeader className="hidden w-24 text-right lg:table-cell">Success</TableHeader>
                <TableHeader className="w-20 text-right sm:w-28">24h</TableHeader>
                <TableHeader className="w-24 pr-4! text-right sm:w-32">Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((project) => {
                const hasWarnings = project.openWarnings > 0
                const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : '—'
                return (
                  <TableRow key={project.id} href={`/admin/projects/${project.id}`} className="group h-14">
                    <TableCell className="py-2! pl-4!">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          square
                          src={project.imageUrl ?? project.logoUrl}
                          initials={project.imageUrl || project.logoUrl ? undefined : project.name.slice(0, 2)}
                          alt=""
                          className="size-8 shrink-0 bg-zinc-100 text-zinc-900 ring-1 ring-zinc-950/10"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900 group-hover:underline">{project.name}</div>
                          <div className="truncate font-mono text-xs text-zinc-500">
                            {project.repoFullName ?? 'no repo linked'}
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
                    <TableCell className="py-2! text-right">
                      <div className="font-mono text-sm tabular-nums text-zinc-600">{project.runsLast24h.toLocaleString()} runs</div>
                      <div className="font-mono text-xs tabular-nums text-zinc-500">{cost}</div>
                    </TableCell>
                    <TableCell className="py-2! pr-4! text-right">
                      <Badge color={hasWarnings ? 'zinc' : 'accent'} className="uppercase tracking-widest">
                        {hasWarnings ? `${project.openWarnings} alert${project.openWarnings === 1 ? '' : 's'}` : 'Healthy'}
                      </Badge>
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
