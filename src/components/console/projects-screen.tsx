import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot, CopilotHealthMetric, Project } from '@/lib/agent-mission-control/types'

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
 * Is this health metric a MEASUREMENT on this copilot?
 *
 * `healthUnavailableFields` names what the data layer could not prove. An
 * UNDEFINED list means the row never went through the data layer, so nothing is
 * proven — the contract (`types.ts`) says to treat every metric as unavailable
 * in that case, not as measured.
 */
function isMeasured(copilot: Copilot, metric: CopilotHealthMetric): boolean {
  if (copilot.healthUnavailableFields === undefined) return false
  if (copilot.healthUnavailableFields.includes(metric)) return false
  return Number.isFinite(copilot.health?.[metric])
}

/** A rollup and how much of the team it could not cover. */
type MeasuredSum = { value: number; unmeasured: number }

/**
 * Sum a health metric over a team, counting ONLY the members that proved it.
 *
 * `null` when a non-empty team proved none — a total nobody measured is not 0.
 * An EMPTY team returns a measured 0: with no agent assigned there is no run and
 * no cost to account for, which is a fact rather than a placeholder.
 */
function sumMeasured(team: Copilot[], metric: CopilotHealthMetric): MeasuredSum | null {
  let value = 0
  let measured = 0
  let unmeasured = 0
  for (const copilot of team) {
    if (isMeasured(copilot, metric)) {
      value += copilot.health[metric]
      measured += 1
    } else {
      unmeasured += 1
    }
  }
  if (team.length > 0 && measured === 0) return null
  return { value, unmeasured }
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
  const assigned = copilots === null ? null : copilots.filter((copilot) => copilot.projectId !== null)
  const bench = copilots === null ? null : copilots.filter((copilot) => copilot.projectId === null)
  const serving = assigned === null ? null : assigned.filter(isServing)

  const fleetRuns = assigned === null ? null : sumMeasured(assigned, 'runsLast24h')
  const fleetCost = assigned === null ? null : sumMeasured(assigned, 'costLast24hUsd')

  // Per project: the team is the assigned copilots pointing at it. With the
  // copilot read down there is no team to compute, so every figure is absent —
  // NOT zero.
  const rollups: ProjectRollup[] = projects.map((project) => {
    if (assigned === null) {
      return { project, team: 0, serving: 0, runs24h: null, cost24h: null }
    }
    const team = assigned.filter((copilot) => copilot.projectId === project.id)
    return {
      project,
      team: team.length,
      serving: team.filter(isServing).length,
      runs24h: sumMeasured(team, 'runsLast24h'),
      cost24h: sumMeasured(team, 'costLast24hUsd'),
    }
  })

  const unmeasuredAgents =
    assigned === null ? 0 : assigned.filter((copilot) => !isMeasured(copilot, 'runsLast24h')).length

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
        <KpiCard label="Projects" value={projects.length} detail="Persisted workspaces" />

        <KpiCard
          label="Assigned agents"
          value={assigned === null ? unavailableFigure : assigned.length}
          detail="Linked to a project"
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
          detail="Across assigned agents"
        />

        <KpiCard
          label="Cost · 24h"
          value={fleetCost === null ? unavailableFigure : formatUsd(fleetCost.value)}
          detail="Across assigned agents"
        />
      </div>

      {/* ── ROW 2 · the registry · fleet assignment + bench ───────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section
          title="Project registry"
          description={`${projects.length} live record${projects.length === 1 ? '' : 's'} from the Aigent perimeter`}
        >
          <div className={TABLE_SCROLL}>
            {projects.length === 0 ? (
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
                  const runs = isMeasured(copilot, 'runsLast24h') ? copilot.health.runsLast24h : null
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
