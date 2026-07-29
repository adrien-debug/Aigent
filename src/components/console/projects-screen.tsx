import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd } from '@/lib/agent-mission-control/format'
// The ONE measurement rule + rollup, shared with the data layer
// (`dashboard-overview.ts`). Neutral module, no `server-only` — see its header
// for why it cannot live beside the rollup that consumes it.
import { isMeasuredHealth, sumMeasuredHealth, type MeasuredSum } from '@/lib/agent-mission-control/health-measure'
import { isDevSeedCopilot, isDevSeedProject } from '@/lib/agent-mission-control/dev-seed-markers'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import crossing into a sub-directory matches neither and reads as dead.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import {
  EmptyState,
  ErrorState,
  KpiCard,
  PanelRow,
  ScreenHeader,
  Section,
  TABLE_BODY,
  TABLE_HEAD,
  TABLE_NUM,
  TABLE_ROW,
  TABLE_SCROLL,
  TABLE_SHELL,
  Unavailable,
} from './screen-primitives'

/**
 * `/admin/projects` — the project registry, as a dense table.
 *
 * SERVER COMPONENT. No `'use client'`, no state: everything comes from the two
 * reads the route already performs, and the two gauges are hand-written SVG.
 *
 * IT STAYS A TABLE. One row per project, the same eight facts on each — that is
 * tabular data, and the Catalyst `Table` primitive wraps itself in
 * `overflow-x-auto` so the row scrolls horizontally on a phone rather than
 * collapsing into cards. The "Open Builder" control on every row is the same
 * destination the shipped screen carried (`/admin/projects/<id>/builder`).
 *
 * TRUTH — three distinct things this screen refuses to blur:
 *  1. THE AGENT READ FAILED (`copilots === null`). Every agent-derived figure
 *     renders `Indisponible`, never 0, and an `ErrorState` says so in the danger
 *     role. The projects themselves are real and still render.
 *  2. A METRIC WAS NEVER PROVEN. `Copilot.healthUnavailableFields` names the
 *     health metrics the data layer could NOT prove; the number sitting in
 *     `health` is then a normalisation placeholder, not a measurement. A rollup
 *     sums only proven members and reports `Indisponible` when a non-empty team
 *     proved none.
 *  3. AN EMPTY SET IS A MEASURED 0. A project with no agent has no run to have
 *     made — that 0 is a fact, and it renders as 0.
 *  4. DEV-SEED FIXTURES ARE NOT PRODUCTION TRUTH. `scripts/dev-seed.mjs` writes
 *     real, persisted rows (`seed-project-lab`, `seed-agent-*`), so a plain read
 *     cannot tell them from a genuine project or agent — but this is a console
 *     presented as the real production run stream, and `/admin/runs` already
 *     excludes the same rows from its window (`isDevSeedCopilot`,
 *     `runs-page-data.ts`). This screen applies the identical markers
 *     (`dev-seed-markers.ts`) to both `projects` and `copilots` before any KPI
 *     or table row is built, and DISCLOSES the exclusion count rather than
 *     hiding it silently.
 */

/* --------------------------------------------------------------- constants */

/** Bounded body for the bench list — same rung as `Section scroll="md"`. */
const LIST_SCROLL = 'max-h-80 overflow-y-auto'

/** `Indisponible` sized for the big KPI figure slot (`text-2xl` would clip it). */
const unavailableFigure = <Unavailable className="text-base/7" />

/** `Indisponible` sized for a dense table cell. */
const unavailableCell = <Unavailable className="text-[11px]" />

/* ----------------------------------------------------------------- helpers */

/**
 * The sub-label of a fleet KPI, stating what its figure actually covers.
 *
 * A `MeasuredSum` is a sum over the members that PROVED the metric — a lower
 * bound whenever `unmeasured > 0`. Printing it under a flat "Across assigned
 * agents" claimed a completeness nobody verified, which is the same overclaim
 * as the `$0.00` this branch removed, just phrased in prose instead of digits.
 * So the coverage is disclosed whenever it is partial, and only claimed when it
 * is whole.
 */
function coverageDetail(sum: MeasuredSum | null): string {
  if (sum === null) return 'No assigned agent proved a 24h figure'
  if (sum.unmeasured === 0) return 'Across every assigned agent'
  return `Excludes ${sum.unmeasured} agent${sum.unmeasured === 1 ? '' : 's'} with no measured figure`
}

/** The shipped definition of "serving", kept verbatim: the production pointer
 *  derived at read time, or the stored `active` column. */
function isServing(copilot: Copilot): boolean {
  return copilot.displayStatus === 'production' || copilot.status === 'active'
}

type ProjectRollup = {
  project: Project
  team: number
  serving: number
  runs24h: MeasuredSum | null
  cost24h: MeasuredSum | null
}

/* --------------------------------------------------------------- component */

export function ProjectsScreen({
  projects,
  copilots,
  agentsErrorDetail = null,
}: {
  projects: Project[]
  /** `null` when the copilot read FAILED. Every agent figure then renders
   *  `Indisponible` and the failure is stated — never flattened to 0. */
  copilots: Copilot[] | null
  /** PostgREST detail behind that failure, shown in the error panel. */
  agentsErrorDetail?: string | null
}) {
  // Dev-seed rows excluded FIRST, before any KPI, rollup or table row is built
  // from either array — see point 4 of the file doc. Real projects/agents never
  // match the marker, so this is a no-op outside a dev-seeded environment.
  const realProjects = projects.filter((project) => !isDevSeedProject(project))
  const excludedProjects = projects.length - realProjects.length
  const realCopilots = copilots === null ? null : copilots.filter((copilot) => !isDevSeedCopilot(copilot))
  const excludedCopilots = copilots === null ? 0 : copilots.length - (realCopilots?.length ?? 0)

  const assigned = realCopilots === null ? null : realCopilots.filter((copilot) => copilot.projectId !== null)
  const bench = realCopilots === null ? null : realCopilots.filter((copilot) => copilot.projectId === null)
  const serving = assigned === null ? null : assigned.filter(isServing)

  const fleetRuns = assigned === null ? null : sumMeasuredHealth(assigned, 'runsLast24h')
  const fleetCost = assigned === null ? null : sumMeasuredHealth(assigned, 'costLast24hUsd')

  // Per project: the team is the assigned copilots pointing at it. With the
  // copilot read down there is no team to compute, so every figure is absent —
  // NOT zero.
  const rollups: ProjectRollup[] = realProjects.map((project) => {
    if (assigned === null) {
      return { project, team: 0, serving: 0, runs24h: null, cost24h: null }
    }
    const team = assigned.filter((copilot) => copilot.projectId === project.id)
    return {
      project,
      team: team.length,
      serving: team.filter(isServing).length,
      runs24h: sumMeasuredHealth(team, 'runsLast24h'),
      cost24h: sumMeasuredHealth(team, 'costLast24hUsd'),
    }
  })

  /**
   * Agents whose 24h figures are NOT fully proven.
   *
   * BOTH metrics, not just runs. The footer below says "24h figures", plural,
   * and a filter on `runsLast24h` alone let it claim full coverage while a cost
   * was still unmeasured — the same class of overclaim this branch exists to
   * remove, one line further down the page. An agent counts as covered only
   * when every figure the strip sums has actually been measured for it.
   */
  const unmeasuredAgents =
    assigned === null
      ? 0
      : assigned.filter(
          (copilot) =>
            !isMeasuredHealth(copilot, 'runsLast24h') ||
            !isMeasuredHealth(copilot, 'costLast24hUsd')
        ).length

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Projects"
        description="Repositories and their persisted agent teams."
        actions={
          <Button href="/admin" outline>
            Back to overview
          </Button>
        }
      />

      {copilots === null ? (
        <ErrorState
          title="Agent registry could not be read"
          description={`The projects below are real; every agent figure on this page is unavailable for this read.${
            agentsErrorDetail === null ? '' : ` ${agentsErrorDetail}`
          }`}
        />
      ) : null}

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────────
          FIVE cards, not six: measured at 1440 a six-up band leaves ~150px per
          card and the card carrying the arc gauge truncates its own figure. The
          bench count is not lost — it is the count in the bench panel's header,
          beside the list it counts. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Projects"
          value={realProjects.length}
          detail={
            excludedProjects > 0
              ? `Persisted workspaces · ${excludedProjects} dev-seed excluded`
              : 'Persisted workspaces'
          }
        />

        <KpiCard
          label="Assigned agents"
          value={assigned === null ? unavailableFigure : assigned.length}
          detail={
            excludedCopilots > 0
              ? `Linked to a project · ${excludedCopilots} dev-seed excluded`
              : 'Linked to a project'
          }
        />

        <KpiCard
          label="Serving"
          value={serving === null ? unavailableFigure : serving.length}
          detail="Active or production"
          aside={
            serving !== null && assigned !== null && assigned.length > 0 ? (
              <ArcGauge
                value={serving.length}
                max={assigned.length}
                // 56, not the 72 default: at five cards across 1440 the card is
                // ~220px, and a 72px gauge squeezes the figure beside it until
                // "Indisponible" truncates. Measured, not guessed.
                size={56}
                ariaLabel={`Serving agents: ${serving.length} of ${assigned.length} assigned.`}
              />
            ) : undefined
          }
        />

        <KpiCard
          label="Runs · 24h"
          value={fleetRuns === null ? unavailableFigure : fleetRuns.value}
          detail={coverageDetail(fleetRuns)}
        />

        <KpiCard
          label="Cost · 24h"
          value={fleetCost === null ? unavailableFigure : formatUsd(fleetCost.value)}
          detail={coverageDetail(fleetCost)}
        />
      </div>

      {/* ── ROW 2 · the registry · fleet assignment + bench ───────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section
          title="Project registry"
          description={`${realProjects.length} live record${realProjects.length === 1 ? '' : 's'} from the Aigent perimeter${
            excludedProjects > 0 ? ` · ${excludedProjects} dev-seed project${excludedProjects === 1 ? '' : 's'} excluded` : ''
          }`}
        >
          <div className={TABLE_SCROLL}>
            {realProjects.length === 0 ? (
              <EmptyState
                title="No project is available."
                description="Nothing is persisted in the Aigent perimeter."
              />
            ) : (
              <Table caption="Project registry" className={TABLE_SHELL}>
                <TableHead className={TABLE_HEAD}>
                  <TableRow className={TABLE_ROW}>
                    <TableHeader>Project</TableHeader>
                    <TableHeader>Repository</TableHeader>
                    {/* One column, two facts: serving over team. Two separate
                        columns cost ~70px of a table that already scrolls. */}
                    <TableHeader className={TABLE_NUM}>Serving / team</TableHeader>
                    <TableHeader className={TABLE_NUM}>Runs · 24h</TableHeader>
                    <TableHeader className={TABLE_NUM}>Cost · 24h</TableHeader>
                    {/* A control, not a figure: right-aligned without `tabular-nums`. */}
                    <TableHeader className="text-right">Builder</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody className={TABLE_BODY}>
                  {rollups.map(({ project, team, serving: teamServing, runs24h, cost24h }) => (
                    // Inert row: the only destination is the "Open Builder"
                    // control in the last cell, so the ROW itself must not light
                    // up as if the whole line were clickable.
                    <TableRow key={project.id} className={TABLE_ROW}>
                      <TableCell>
                        <p className="max-w-56 truncate text-white">{project.name}</p>
                        {/* Platform rides in the subtitle rather than owning a
                            column: same fact, ~80px cheaper in a table that
                            already has to scroll horizontally. */}
                        <p className="max-w-56 truncate text-[11px]/4 text-zinc-500">
                          {project.platform} · {project.description || project.slug}
                        </p>
                      </TableCell>

                      <TableCell>
                        {project.repoFullName ? (
                          <span className="font-mono text-[11px] text-zinc-400">{project.repoFullName}</span>
                        ) : (
                          <span className="text-[11px] text-zinc-500">not configured</span>
                        )}
                      </TableCell>

                      <TableCell className={TABLE_NUM}>
                        {assigned === null ? (
                          unavailableCell
                        ) : (
                          <>
                            <span className={teamServing > 0 ? 'text-accent-300' : 'text-zinc-500'}>
                              {teamServing}
                            </span>
                            <span className="text-zinc-600"> / </span>
                            <span className="text-zinc-300">{team}</span>
                          </>
                        )}
                      </TableCell>

                      <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                        {runs24h === null ? unavailableCell : runs24h.value}
                      </TableCell>

                      <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                        {cost24h === null ? unavailableCell : formatUsd(cost24h.value)}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button href={`/admin/projects/${project.id}/builder`} outline>
                          Open Builder <ArrowRightIcon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Coverage disclosure, outside the scroll area: a rollup that could
              not cover every member is stated, never quietly presented as a
              fleet total. */}
          <div className="border-t border-line px-4 py-2">
            <p className="text-[11px]/4 text-zinc-500">
              {assigned === null
                ? 'Agent figures unavailable for this read'
                : unmeasuredAgents === 0
                  ? '24h figures cover every assigned agent'
                  : `${unmeasuredAgents} assigned agent${unmeasuredAgents === 1 ? '' : 's'} carried no measured 24h figure`}
            </p>
          </div>
        </Section>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Fleet assignment" description="Agents serving over agents assigned">
            {assigned !== null && assigned.length === 0 ? (
              <EmptyState
                title="No agent is assigned to a project."
                description="Every agent is still on the validation bench."
              />
            ) : (
              <div className="flex flex-col items-center px-4 pt-4 pb-3">
                <RingGauge
                  value={serving === null ? null : serving.length}
                  max={assigned === null || assigned.length === 0 ? 100 : assigned.length}
                  label="Agents serving over agents assigned"
                  caption={assigned === null ? undefined : `of ${assigned.length}`}
                  size={168}
                />
                <p className="mt-2 text-center text-[11px]/4 text-zinc-500">
                  {serving === null || assigned === null
                    ? 'The agent registry could not be read'
                    : `${serving.length} of ${assigned.length} assigned agents are active or serving production`}
                </p>
              </div>
            )}
          </Section>

          <Section
            title="Validation bench"
            description="Agents with no project assignment yet"
            actions={
              <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
                {bench === null ? <Unavailable className="text-[11px]/4" /> : bench.length}
              </span>
            }
          >
            <div className={LIST_SCROLL}>
              {bench === null ? (
                <EmptyState
                  title="Bench unavailable."
                  description="The agent registry could not be read for this request."
                />
              ) : bench.length === 0 ? (
                <EmptyState
                  title="The bench is empty."
                  description="Every agent is assigned to a project."
                />
              ) : (
                bench.map((copilot) => {
                  const runs = isMeasuredHealth(copilot, 'runsLast24h')
                    ? copilot.health.runsLast24h
                    : null
                  return (
                    <PanelRow
                      key={copilot.id}
                      href={`/admin/agents/${copilot.id}`}
                      title={copilot.name}
                      subtitle={`${copilot.runtime} · ${copilot.displayStatus ?? copilot.status}`}
                      values={[
                        { label: 'runs', value: runs === null ? <Unavailable className="text-[11px]" /> : runs },
                      ]}
                    />
                  )
                })
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
