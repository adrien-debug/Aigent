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
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader
        title="Projects"
        meta={
          <Link href="/admin/projects/new" className="text-xs font-medium text-accent-400 hover:underline">
            + New Project
          </Link>
        }
      />
      {projects.length > 0 ? (
        <div className="max-h-[34rem] overflow-auto no-scrollbar">
          <Table className="min-w-[560px] w-full border-collapse px-4 text-left [--gutter:--spacing(0)]">
            <TableHead className="sticky top-0 z-10 bg-[var(--color-surface-secondary)]">
              <TableRow className="border-b border-white/5">
                <TableHeader>Project</TableHeader>
                <TableHeader className="text-right">Copilots</TableHeader>
                <TableHeader className="text-right">Success</TableHeader>
                <TableHeader className="text-right">24h</TableHeader>
                <TableHeader className="text-right">Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y divide-white/5">
              {projects.map((project) => {
                const hasWarnings = project.openWarnings > 0
                const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : '—'
                return (
                  <TableRow key={project.id} href={`/admin/projects/${project.id}`} className="group h-12">
                    <TableCell className="py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          square
                          src={project.imageUrl ?? project.logoUrl}
                          initials={project.imageUrl || project.logoUrl ? undefined : project.name.slice(0, 2)}
                          alt=""
                          className="size-8 shrink-0 bg-black/40 text-white ring-1 ring-white/10"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white group-hover:underline">{project.name}</div>
                          <div className="truncate font-mono text-[10px] text-zinc-500">
                            {project.repoFullName ?? 'no repo linked'}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-zinc-300">
                      {project.activeCount}<span className="text-zinc-600"> / {project.copilotCount}</span>
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-zinc-300">
                      {project.passRate === null ? '—' : formatPercent(project.passRate)}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="font-mono text-xs tabular-nums text-zinc-300">{project.runsLast24h.toLocaleString()} runs</div>
                      <div className="font-mono text-[10px] tabular-nums text-zinc-500">{cost}</div>
                    </TableCell>
                    <TableCell className="py-2 text-right">
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
