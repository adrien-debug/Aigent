import { KpiTile } from '@/components/admin-dashboard/kpi-tile'
import { Badge } from '@/components/ui/badge'
import { Heading, Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Text } from '@/components/ui/text'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

const CARD = 'rounded-2xl bg-surface-raised p-6'
const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/**
 * `/admin`, rebuilt in P004 on the frame's composition: a 2/3 summary beside a
 * 1/3 rate ring, then a 2/3 table beside a 1/3 queue.
 *
 * Catalyst primitives only, and no Panel/Section/Card wrapper — each surface is
 * a plain `<section>` on a theme plane whose values were measured off the frame.
 *
 * Every figure here is nullable by contract (`dashboard-overview.ts`), and the
 * rendering honours that: "Not measured" rather than a zero, in every tile.
 */
export function DashboardView({ overview }: { overview: DashboardOverview }) {
  const { kpis, projects, actionItems, dataWarnings } = overview

  return (
    <div className="flex flex-col gap-6">
      {dataWarnings.length > 0 ? (
        <div
          role="status"
          className="rounded-2xl bg-surface-sunken px-4 py-3 ring-1 ring-[var(--surface-border-strong)]"
        >
          <p className="text-xs/5 text-zinc-300">
            <span className="font-medium text-white">Partial data.</span>{' '}
            {dataWarnings.join(' · ')}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${CARD} flex flex-col lg:col-span-2`} aria-labelledby="fleet-heading">
          <Heading id="fleet-heading" level={1}>
            Fleet
          </Heading>
          <Text size="xs" className="mt-1 max-w-2xl">
            What the agent fleet did in the last 24 hours, and what is waiting on a human.
          </Text>

          <dl className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiTile
              label="Runs, last 24h"
              value={String(kpis.runs24h)}
              note={kpis.runs24h > 0 ? undefined : 'no operational run in the window'}
            />
            <KpiTile
              label="Executable now"
              value={
                kpis.executableNow === null || kpis.executableTotal === null
                  ? null
                  : `${kpis.executableNow} / ${kpis.executableTotal}`
              }
              note="agents the runtime would accept a run for"
              tone="accent"
            />
            <KpiTile
              label="Blocked deliveries"
              value={kpis.blockedDeliveries === null ? null : String(kpis.blockedDeliveries)}
              tone={kpis.blockedDeliveries ? 'danger' : undefined}
            />
            <KpiTile
              label="Cost, last 24h"
              value={kpis.cost24h === null ? null : formatUsd(kpis.cost24h)}
              note={kpis.cost24h === null ? 'nothing to sum in the window' : undefined}
            />
          </dl>
        </section>

        <section className={`${CARD} flex flex-col`} aria-labelledby="success-heading">
          <Subheading id="success-heading" level={2}>
            Success, last 24h
          </Subheading>
          <Text size="xs" className="mt-1">
            Completed vs terminal runs
          </Text>

          <div className="flex flex-1 flex-col items-center justify-center py-6">
            {kpis.success24h === null ? (
              <>
                <div
                  className="flex size-34 items-center justify-center rounded-full ring-1 ring-[var(--surface-border-strong)] ring-inset"
                  aria-hidden="true"
                >
                  <span className="text-sm text-zinc-400">—</span>
                </div>
                <p className="mt-4 text-sm font-medium text-white">Not measured</p>
                <Text size="2xs" className="mt-1 max-w-60 text-center">
                  No run reached a terminal state in the window, so there is no denominator to
                  compute a rate from.
                </Text>
              </>
            ) : (
              <>
                <div className="relative size-34">
                  {/* Literal geometry — one circle, one dash offset. Not a plotted series. */}
                  <svg
                    viewBox="0 0 136 136"
                    className="size-full -rotate-90"
                    role="img"
                    aria-label={`Success rate ${kpis.success24h}% over the last 24 hours`}
                  >
                    <circle
                      cx="68"
                      cy="68"
                      r={RADIUS}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="10"
                      className="text-zinc-800"
                    />
                    <circle
                      cx="68"
                      cy="68"
                      r={RADIUS}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={CIRCUMFERENCE * (1 - kpis.success24h / 100)}
                      className="text-accent-500"
                    />
                  </svg>
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-white tabular-nums"
                  >
                    {kpis.success24h}%
                  </span>
                </div>
                <Link href="/admin/runs" className="mt-4 text-xs text-zinc-400 hover:underline">
                  Open the run console
                </Link>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 min-[1500px]:grid-cols-3">
        <section
          className={`${CARD} flex min-w-0 flex-col min-[1500px]:col-span-2`}
          aria-labelledby="projects-heading"
        >
          <Subheading id="projects-heading" level={2}>
            Projects
          </Subheading>

          {projects.length === 0 ? (
            <Text size="xs" className="mt-6">
              No project is registered yet.
            </Text>
          ) : (
            <div className="mt-4">
              <Table dense bleed caption="Projects and their agent activity">
                <TableHead>
                  <TableRow>
                    <TableHeader>Project</TableHeader>
                    <TableHeader>Agents</TableHeader>
                    <TableHeader>Runs 24h</TableHeader>
                    <TableHeader>Cost 24h</TableHeader>
                    <TableHeader>Pass rate</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="max-w-56">
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="block truncate text-white hover:underline"
                        >
                          {project.name}
                        </Link>
                        {project.repoFullName ? (
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-400">
                            {project.repoFullName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {project.activeCount} / {project.copilotCount}
                      </TableCell>
                      <TableCell className="tabular-nums">{project.runsLast24h}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatUsd(project.costLast24hUsd)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {project.passRate === null ? (
                          <span className="text-zinc-400">Not measured</span>
                        ) : (
                          formatPercent(project.passRate)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className={`${CARD} flex flex-col`} aria-labelledby="queue-heading">
          <Subheading id="queue-heading" level={2}>
            Needs action
          </Subheading>
          <Text size="xs" className="mt-1">
            {actionItems.length === 0 ? 'Nothing is waiting on a human.' : 'Oldest first'}
          </Text>

          {actionItems.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {actionItems.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-2xl bg-surface-sunken px-4 py-3 hover:bg-surface-raised-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[11px]/4 text-zinc-400">
                        {item.meta}
                      </span>
                    </span>
                    <Badge
                      color={
                        item.kind === 'sandbox_failed' ||
                        item.kind === 'release_gate_red' ||
                        item.kind === 'mission_blocked'
                          ? 'danger'
                          : 'zinc'
                      }
                    >
                      {item.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  )
}
