import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { ProjectAvatar } from '@/components/agent-ops/project-avatar'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/ui/badge'
import { TouchTarget } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
          // 77×16 was the entire tap target for this card's only action. Same kit
          // `TouchTarget` as `Button` uses: invisible and inert on a fine pointer, 44px
          // tall on a coarse one. `inline-flex` is what makes the anchor a box the pad
          // can size against (an inline anchor has no height of its own to take 100% of).
          <Link
            href="/admin/projects/new"
            // Focus ring added for the same measured reason as the Live Runs link: no focus
            // style was declared, so the UA blue `1px auto rgb(0, 95, 204)` was the whole
            // keyboard affordance for this card's only action.
            className="relative inline-flex items-center rounded-sm text-xs font-medium text-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 hover:underline"
          >
            <TouchTarget>+ New Project</TouchTarget>
          </Link>
        }
      />
      {projects.length > 0 ? (
        // The ONLY vertical scrollport of this card — `Table` drops its own
        // `overflow-x-auto` when `fixed`, so the sticky head below actually sticks.
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-950/5">
          <Table fixed className="w-full text-left [--gutter:--spacing(0)]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                {/* `pl-4!` — one of the FOUR markers that survived the post-`cn()` sweep here.
                    `cn()` now merges bare-vs-bare, so `py-2`/`pl-2` no longer need an escape;
                    this one still does. The primitive's competing default is
                    `first:pl-(--gutter,--spacing(2))` + `sm:first:pl-1`, and a `first:`/`sm:`
                    variant is BOTH outside `tailwind-merge`'s conflict group (different
                    variant set) AND higher specificity than a bare `.pl-4`. Measured on
                    /admin @1440: with `!` 16px, without it 4px. */}
                <TableHeader className="pl-4!">Project</TableHeader>
                <TableHeader className="hidden w-24 text-right md:table-cell">Copilots</TableHeader>
                <TableHeader className="hidden w-24 text-right lg:table-cell">Success</TableHeader>
                {/* Runs and cost were stacked two-deep in a single "24h" cell,
                    which made the row taller than every other table in the app
                    and buried the cost under the run count. They are now two
                    peer columns on one baseline; the shared window is stated
                    once in the header rather than repeated per cell. */}
                <TableHeader className="hidden w-24 text-right sm:table-cell">
                  Runs<span className="sr-only"> over the last 24 hours</span>
                  <span aria-hidden="true" className="ml-1 font-normal text-zinc-400">24h</span>
                </TableHeader>
                <TableHeader className="hidden w-24 text-right sm:table-cell">
                  Cost<span className="sr-only"> over the last 24 hours</span>
                  <span aria-hidden="true" className="ml-1 font-normal text-zinc-400">24h</span>
                </TableHeader>
                {/* Trailing edge. `pr-4!` fights a variant (`last:pr-(--gutter)` +
                    `sm:last:pr-1`) and keeps its marker for the same reason as `pl-4!` above.
                    `pl-2!`/`sm:pl-4!` are a DIFFERENT case, and the honest version is this:
                    they are redundant at runtime and they stay anyway.
                      · Measured: `pl-2` bare renders 8px at 390 and `sm:pl-4` renders 16px at
                        1440 — the intended values, with or without `!`. The only competing
                        default is the primitive's bare `px-4`, and `.px-4` (sheet line 3041)
                        is emitted BEFORE `.pl-2` (3249), so the caller already wins.
                      · `check:class-collision` disagrees and fails the build without them. It
                        is not being silly: `tailwind-merge` does NOT treat `px-*` and `pl-*`
                        as one conflict group (verified — `twMerge('px-4','pl-2')` returns
                        both), so the gate cannot resolve the pair and falls back to assuming
                        the default wins. It has no view of the compiled sheet order that in
                        fact decides.
                      · The gate offers an allowlist for measured false positives (there is
                        already one such entry, for `aigent-sidebar.tsx`), but that file is
                        outside this lot and shared with other agents in flight. Keeping the
                        two markers costs nothing on screen and keeps the gate green; the
                        allowlist entry is the follow-up, not a change to smuggle in here. */}
                <TableHeader className="w-28 pr-4! pl-2! text-right sm:w-32 sm:pl-4!">Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((project) => {
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
                    {/* `py-2` pins every row to the h-14 (56px) set on the row itself — still
                        load-bearing as a VALUE, no longer as an ESCAPE. It used to be written
                        `py-2!` because the primitive's `py-4` won on stylesheet order; `cn()`
                        drops that default now (bare-vs-bare, same conflict group), so the `!`
                        bought nothing and only blocked any override downstream. Measured
                        8px/8px with and without on /admin @1440, row height 56px unchanged. */}
                    <TableCell className="py-2 pl-4!">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProjectAvatar name={project.name} src={logo} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900 dark:text-white group-hover:underline">{project.name}</div>
                          {/* zinc-400 throughout this table, not zinc-500:
                              `check:contrast` measures zinc-500 at 3.59:1 on the
                              raised row plane and 4.02:1 in the sticky head —
                              both under the 4.5 AA floor. The repo slug is the
                              only thing distinguishing two projects with similar
                              names, so it is not decoration. */}
                          <div className="truncate font-mono text-xs text-zinc-400">
                            {project.repoFullName ?? 'no repo linked'}
                          </div>
                          {/* Below sm both 24h columns are dropped so Project keeps the
                              majority of the width; their values fold here rather
                              than being squeezed into 48px and spilling left. */}
                          <div className="truncate font-mono text-xs tabular-nums text-zinc-400 sm:hidden">
                            {project.runsLast24h.toLocaleString()} runs · {cost}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 md:table-cell">
                      {project.activeCount}<span className="text-zinc-400"> / {project.copilotCount}</span>
                    </TableCell>
                    <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 lg:table-cell">
                      {project.passRate === null ? '—' : formatPercent(project.passRate)}
                    </TableCell>
                    <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                      {project.runsLast24h > 0 ? project.runsLast24h.toLocaleString() : <NotMeasuredDash />}
                    </TableCell>
                    <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 sm:table-cell dark:text-zinc-400">
                      {project.runsLast24h > 0 ? formatUsd(project.costLast24hUsd) : <NotMeasuredDash />}
                    </TableCell>
                    <TableCell className="py-2 pr-4! pl-2 text-right sm:pl-4">
                      {hasSignal ? (
                        <Badge color="accent" className="uppercase tracking-widest">
                          Healthy
                        </Badge>
                      ) : (
                        // A project with no pass rate and no runs has produced no
                        // observation to call healthy.
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
        /* No `className="py-12"`: it restated the component's own default, so it
           read as a decision the caller had made and was in fact inert. Padding
           is chosen through the `padding` prop now — the default is this. */
        <EmptyState
          title="No projects yet"
          description="Register the first product surface to see its delivery KPIs here."
          action={
            <SoftAccentLink href="/admin/projects/new">New project</SoftAccentLink>
          }
        />
      )}
    </SurfaceCard>
  )
}
