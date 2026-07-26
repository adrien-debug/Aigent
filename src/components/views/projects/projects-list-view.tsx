import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { ProjectAvatar } from '@/components/agent-ops/project-avatar'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/ui/panel'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

type Project = Awaited<ReturnType<typeof getDashboardOverview>>['projects'][number]

export function ProjectsListView({ projects }: { projects: Project[] }) {
  return (
    <PageLayout>
      <PageHeader
        eyebrow="Projects"
        title="All Projects"
        description="Every product surface registered in Agent Mission Control, with its live delivery signals."
        className="pb-0"
      />

      <Panel inset="none" className="overflow-hidden">
        {projects.length > 0 ? (
          <div className="min-h-0">
            <Table fixed className="w-full text-left [--gutter:--spacing(0)]">
              <TableHead>
                <TableRow>
                  {/* Columns drop by priority below lg — five fixed widths do not
                      fit a 390px viewport, and `table-fixed` collides rather than
                      shrinks. Project + Status always survive.

                      The five secondary widths used to be CONSTANT across every
                      breakpoint. Under `table-fixed` a declared px width is
                      served first and the title column — the only one with no
                      declared width — absorbs the whole shortfall. Measured at
                      1024px (table 680px): the five kept their full 576px,
                      Project fell to 104px and the name box to 28px for 115px of
                      text, i.e. two readable characters.
                      They now step DOWN one notch below xl, where the table is
                      narrow, and return to their previous value at xl and above
                      — so >=1280px renders exactly as before (Project 360px at
                      1280, 680px at 1600) while the same 680px table now leaves
                      Project 216px. Each shrunk width still clears its header's
                      intrinsic 77-80px, measured, so nothing overflows.
                      Percentages were tried first and rejected on evidence: a
                      `%` inside `min()` is not resolvable during the fixed-table
                      sizing pass, and Chromium silently dropped ALL six widths
                      back to an equal 1/6 share.

                      `pl-4!` here and `pr-4!` on Status are the only two markers
                      of this file that are NOT redundant, MEASURED both ways.
                      The primitive's edge padding is `first:pl-(--gutter,
                      --spacing(2))` plus `sm:first:pl-1` — both behind variants.
                      tailwind-merge only merges classes sharing the SAME variant
                      set, so a bare `pl-4` never replaces them, and it also
                      loses the cascade to a `:first-child` selector, which is
                      one specificity step higher. Removing the marker measured
                      16px -> 4px at 1440 and 768, and 16px -> 0px at 390, on
                      both edge columns. They stay, in the v4 suffix form. */}
                  <TableHeader className="pl-4!">Project</TableHeader>
                  <TableHeader className="hidden w-20 text-right md:table-cell xl:w-28">Copilots</TableHeader>
                  {/* lg -> xl, same call as Success/Cost on agents-list-view:
                      this column is a METER, not a number, and it needs width to
                      say anything. Stepped down to 112px at lg it would have left
                      the track ~22px once the cell's 32px of padding, the 48px
                      percentage label and the 10px gap are taken out — arithmetic
                      on the measured column width, not a browser reading, because
                      no project in this database has a pass rate to render. A bar
                      that short cannot be compared across rows, and a meter that
                      cannot be read is decoration. It returns at xl at its full
                      144px, and the pass rate stays one click away on the project
                      page. */}
                  <TableHeader className="hidden w-36 xl:table-cell">Test pass</TableHeader>
                  <TableHeader className="hidden w-20 text-right sm:table-cell xl:w-24">Runs 24h</TableHeader>
                  <TableHeader className="hidden w-20 text-right sm:table-cell xl:w-24">Cost 24h</TableHeader>
                  {/* The base rung is WIDER than the sm one, on purpose. `Badge`
                      types one step larger below 640px, so the same "HEALTHY"
                      pill measures 82px there against 72px from sm up — and
                      `w-24` left it a 64px content box (96px column minus the
                      primitive's px-4). Under `table-fixed` the pill is not
                      shrunk to fit: it escapes the column and paints over the
                      cell's right padding, 18px past its own box, measured at
                      390px on every project with a live signal. `w-32` (box
                      96px) clears the 82px maximum. From sm up the previous
                      widths measured fine (72px in an 80px box) and are kept, so
                      >=640px renders exactly as before. */}
                  <TableHeader className="w-32 pr-4! text-right sm:w-28 xl:w-32">Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((project) => {
                  // "Healthy" must rest on an observation. A pass rate or a run in the
                  // last 24h is one; an empty project is simply unobserved.
                  const hasSignal = project.passRate !== null || project.runsLast24h > 0
                  // ReactNode, not a string: with no run in the window there is no
                  // cost to report, and the bare em dash was silent to a screen
                  // reader. NotMeasuredDash carries the "not measured" label.
                  const cost = project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : <NotMeasuredDash />
                  // Same gate as the Runs 24h cell, hoisted so the cell and the
                  // sub-sm fold cannot drift apart. They HAD drifted: the column
                  // rendered NotMeasuredDash for a zero-run window while the fold
                  // printed "0 runs" for the same project, so the phone read a
                  // measurement the desktop refused to assert.
                  const runs = project.runsLast24h > 0 ? `${project.runsLast24h.toLocaleString()} runs` : null
                  const logo = project.imageUrl || project.logoUrl || null
                  return (
                    <TableRow
                      key={project.id}
                      href={`/admin/projects/${project.id}`}
                      title={`Open project ${project.name}`}
                      className="group"
                    >
                      {/* `py-3` carries no `!` any more: `TableCell` composes
                          `cn(defaults…, className)`, so tailwind-merge drops the
                          primitive's `py-4` in JS before the browser arbitrates
                          anything. MEASURED both ways at 1440/768/390 — 12px|12px
                          of cell padding and a 61px row, identical with and
                          without the marker, on all six cells of the row. */}
                      <TableCell className="py-3 pl-4!">
                        <div className="flex min-w-0 items-center gap-3">
                          <ProjectAvatar name={project.name} src={logo} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-white">
                              {project.name}
                            </div>
                            {/* zinc-400, not -500: measured by check-contrast on
                                this raised plane (rgb(26,26,30)) the -500 lands
                                at 3.59:1 for a 4.5 threshold. Same call, same
                                reason as dashboard-kpi-strip.tsx. The shell is
                                hard-dark (`class="dark"` on <html>), so a bare
                                zinc-400 has no light-mode counterpart to break. */}
                            <div className="truncate font-mono text-xs text-zinc-400">
                              {project.repoFullName ?? 'no repo linked'}
                            </div>
                            {/* Columns dropped by the responsive plan fold here
                                rather than disappearing. Two breakpoints, so two
                                scopes on one line:
                                  - Copilots leaves at md, so the active/total
                                    pair is shown below md. It had NO fallback
                                    before this pass: between 0 and 767px the
                                    only count of a project's agents simply was
                                    not on the page.
                                  - Runs 24h and Cost 24h leave at sm, so they
                                    join below sm.
                                Test pass is the deliberate exception, unchanged:
                                it is a meter, it needs width to mean anything,
                                and the project page carries it one click away. */}
                            <div className="truncate font-mono text-xs tabular-nums text-zinc-400 md:hidden">
                              {project.activeCount} / {project.copilotCount} active
                              <span className="sm:hidden">
                                {' · '}
                                {runs ?? <NotMeasuredDash />} · {cost}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden py-3 text-right font-mono text-sm tabular-nums text-zinc-600 md:table-cell dark:text-zinc-400">
                        {project.activeCount}
                        <span className="text-zinc-400"> / {project.copilotCount}</span>
                      </TableCell>
                      {/* Success as a meter, not just a number: the bar makes the
                          spread across projects scannable in one pass. Absent
                          evidence renders an em-dash and NO bar — an empty track
                          would read as a real 0%. */}
                      <TableCell className="hidden py-3 xl:table-cell">
                        {project.passRate === null ? (
                          <NotMeasuredDash />
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
                      <TableCell className="hidden py-3 text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                        {project.runsLast24h > 0 ? project.runsLast24h.toLocaleString() : <NotMeasuredDash />}
                      </TableCell>
                      <TableCell className="hidden py-3 text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                        {cost}
                      </TableCell>
                      <TableCell className="py-3 pr-4! text-right">
                        {hasSignal ? (
                          <Badge color="accent" className="uppercase tracking-widest">
                            Healthy
                          </Badge>
                        ) : (
                          // A project with no copilots and no runs has produced no
                          // signal at all. Claiming HEALTHY there would be a
                          // default-healthy assertion.
                          <span className="font-mono text-xs text-zinc-400">no signal</span>
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
      </Panel>
    </PageLayout>
  )
}
