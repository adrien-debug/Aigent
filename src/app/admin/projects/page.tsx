import type { Metadata } from 'next'

import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { ProjectAvatar } from '@/components/agent-ops/project-avatar'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { Badge } from '@/components/catalyst/badge'
import { surfaceRaised } from '@/components/catalyst/surface'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Projects — Aigent',
}

export default async function ProjectsPage() {
  const overview = await getDashboardOverview()
  const projects = overview.projects

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader
        eyebrow="Projects"
        title="All Projects"
        description="Every product surface registered in Agent Mission Control, with its live delivery signals."
        className="pb-0"
      />

      <div className={`${surfaceRaised} overflow-hidden`}>
        {projects.length > 0 ? (
          <div className="min-h-0">
            <Table fixed className="w-full text-left [--gutter:--spacing(0)]">
              <TableHead>
                <TableRow>
                  {/* Columns drop by priority below lg — five fixed widths do not
                      fit a 390px viewport, and `table-fixed` collides rather than
                      shrinks. Project + Status always survive. */}
                  <TableHeader className="pl-4!">Project</TableHeader>
                  <TableHeader className="hidden w-28 text-right md:table-cell">Copilots</TableHeader>
                  <TableHeader className="hidden w-36 lg:table-cell">Success</TableHeader>
                  <TableHeader className="hidden w-24 text-right sm:table-cell">Runs 24h</TableHeader>
                  <TableHeader className="hidden w-24 text-right sm:table-cell">Cost 24h</TableHeader>
                  <TableHeader className="w-28 pr-4! text-right sm:w-32">Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((project) => {
                  // "Healthy" must rest on an observation. A pass rate or a run in the
                  // last 24h is one; an empty project is simply unobserved.
                  const hasSignal = project.passRate !== null || project.runsLast24h > 0
                  const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : '—'
                  const logo = project.imageUrl || project.logoUrl || null
                  return (
                    <TableRow
                      key={project.id}
                      href={`/admin/projects/${project.id}`}
                      title={`Open project ${project.name}`}
                      className="group"
                    >
                      <TableCell className="py-3! pl-4!">
                        <div className="flex min-w-0 items-center gap-3">
                          <ProjectAvatar name={project.name} src={logo} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-white">
                              {project.name}
                            </div>
                            <div className="truncate font-mono text-xs text-zinc-500">
                              {project.repoFullName ?? 'no repo linked'}
                            </div>
                            {/* Below sm the 24h column is dropped; its two values
                                fold under the repo rather than disappearing. */}
                            <div className="truncate font-mono text-xs tabular-nums text-zinc-500 sm:hidden">
                              {project.runsLast24h.toLocaleString()} runs · {cost}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden py-3! text-right font-mono text-sm tabular-nums text-zinc-600 md:table-cell dark:text-zinc-400">
                        {project.activeCount}
                        <span className="text-zinc-400"> / {project.copilotCount}</span>
                      </TableCell>
                      {/* Success as a meter, not just a number: the bar makes the
                          spread across projects scannable in one pass. Absent
                          evidence renders an em-dash and NO bar — an empty track
                          would read as a real 0%. */}
                      <TableCell className="hidden py-3! lg:table-cell">
                        {project.passRate === null ? (
                          <span className="font-mono text-sm text-zinc-500">—</span>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-200 ring-1 ring-inset ring-zinc-950/5 dark:bg-zinc-800 dark:ring-white/5">
                              <div
                                className="h-full rounded-full bg-[var(--chart-success)]"
                                style={{ width: `${Math.max(project.passRate * 100, 2)}%` }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                              {formatPercent(project.passRate)}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden py-3! text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                        {project.runsLast24h > 0 ? project.runsLast24h.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="hidden py-3! text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                        {cost}
                      </TableCell>
                      <TableCell className="py-3! pr-4! text-right">
                        {hasSignal ? (
                          <Badge color="accent" className="uppercase tracking-widest">
                            Healthy
                          </Badge>
                        ) : (
                          // A project with no copilots and no runs has produced no
                          // signal at all. Claiming HEALTHY there would be a
                          // default-healthy assertion.
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
            action={<SoftAccentLink href="/admin/projects/new">New project</SoftAccentLink>}
          />
        )}
      </div>
    </div>
  )
}
