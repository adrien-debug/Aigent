import clsx from 'clsx'
import { BoltIcon, CpuChipIcon, ShieldCheckIcon, ServerStackIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { surfaceCardClass, surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getRecentRuns, getRegistryKpis, type RegistryKpis } from '@/lib/agent-mission-control/data'
import { formatPercent, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Command Center — Aigent',
}

const numberFormat = new Intl.NumberFormat('en-US')

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Run status → accent intensity ladder (doctrine: colour never the sole signal,
 * the LABEL carries meaning; intensity encodes escalation). completed = soft
 * accent, failed/blocked = solid accent, everything else = neutral zinc.
 */
function runStatusBadgeColor(status: string): 'accent' | 'accentSolid' | 'zinc' {
  if (status === 'completed') return 'accent'
  if (status === 'failed' || status === 'blocked') return 'accentSolid'
  return 'zinc'
}

function AttentionZone({ copilots }: { copilots: Copilot[] }) {
  const flagged = copilots
    .filter((copilot) => copilot.health.openWarnings > 0)
    .sort((a, b) => b.health.openWarnings - a.health.openWarnings)
    .slice(0, 4)

  if (flagged.length === 0) return null

  return (
    <div className="rounded-xl border border-(--accent-line) bg-(--accent-soft) p-6">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheckIcon className="size-5 text-accent-400" />
        <h2 className="text-sm font-semibold text-accent-400 uppercase tracking-widest">Needs Attention</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {flagged.map(copilot => (
          <div key={copilot.id} className="group relative flex flex-col gap-2 rounded-lg border border-(--accent-line) bg-black/40 p-4 transition-colors hover:bg-black/60">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/admin/agents/${copilot.id}`} className="min-w-0 truncate text-sm font-medium text-white group-hover:underline before:absolute before:inset-0">
                {copilot.name}
              </Link>
              <Badge color="accentStrong" className="shrink-0">{copilot.health.openWarnings}</Badge>
            </div>
            <div className="truncate font-mono text-xs text-zinc-400">{copilot.slug}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemTopology() {
  return (
    <div className={clsx(surfaceCardClass, 'group relative flex h-full flex-col')}>
      <div className="relative z-10 flex items-center justify-between border-b border-white/5 bg-black/20 px-6 py-5">
        <h2 className="text-xl font-semibold tracking-tight text-white">System Topology</h2>
        <div className="flex items-center gap-2 rounded-full border border-(--accent-line) bg-(--accent-soft) px-2.5 py-1">
          <span className="relative flex size-1.5">
            <span className="relative inline-flex size-1.5 rounded-full bg-accent-500"></span>
          </span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-accent-400">Connected</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className={clsx(surfaceInsetClass, 'flex size-12 items-center justify-center')}>
          <ServerStackIcon className="size-6 text-zinc-500" />
        </div>
        <p className="text-sm font-medium text-zinc-300">Dynamic animated canvas</p>
        <p className="max-w-xs text-xs text-zinc-500">Live topology visualization coming here.</p>
      </div>
    </div>
  )
}

function FleetDistribution() {
  return (
    <div className={clsx(surfaceCardClass, 'flex flex-col h-full')}>
      <div className="flex items-center justify-between border-b border-white/5 bg-black/20 px-6 py-5">
        <h2 className="text-xl font-semibold tracking-tight text-white">Fleet Distribution</h2>
        <Link href="/admin/agents" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
          View Fleet &rarr;
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className={clsx(surfaceInsetClass, 'flex size-12 items-center justify-center')}>
          <CpuChipIcon className="size-6 text-zinc-500" />
        </div>
        <p className="text-sm font-medium text-zinc-300">Dynamic animated canvas</p>
        <p className="max-w-xs text-xs text-zinc-500">Live fleet distribution visualization coming here.</p>
      </div>
    </div>
  )
}

const DASHBOARD_KPIS = (kpis: RegistryKpis) => [
  { name: 'Active Fleet', value: String(kpis.activeCopilots), suffix: `/ ${kpis.totalCopilots}` },
  { name: '24h Volume', value: numberFormat.format(kpis.runsLast24h), suffix: 'runs' },
  { name: '24h Compute Cost', value: formatUsd(kpis.totalCostLast24hUsd) },
  { name: 'Avg Test Pass', value: kpis.avgTestPassRate > 0 ? formatPercent(kpis.avgTestPassRate) : '—' },
  {
    name: 'System Health',
    value: kpis.openWarnings > 0 ? String(kpis.openWarnings) : '100%',
    suffix: kpis.openWarnings > 0 ? 'warnings' : 'nominal',
  },
]

function RunActivity({ runs, copilotNameById, kpis }: { runs: AgentRun[], copilotNameById: Map<string, string>, kpis: RegistryKpis }) {
  const shown = runs.slice(0, 8)

  return (
    <div className={clsx(surfaceCardClass, 'flex flex-col h-full')}>
      <div className="border-b border-white/5 bg-black/20 px-6 py-6 lg:px-8">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Dashboard</h1>
      </div>

      {/* KPI band under the title */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-b border-white/5 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5 lg:px-8">
        {DASHBOARD_KPIS(kpis).map((kpi) => (
          <div key={kpi.name} className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{kpi.name}</span>
            <span className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-light tabular-nums tracking-tight text-white">{kpi.value}</span>
              {kpi.suffix ? <span className="text-sm text-zinc-500">{kpi.suffix}</span> : null}
            </span>
          </div>
        ))}
      </div>

      {runs.length > 0 ? (
        <div className="flex flex-col flex-1">
          <Table className="px-6 [--gutter:--spacing(6)]">
            <TableHead>
              <TableRow>
                <TableHeader className="w-1/3">Copilot</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader className="text-right">Latency</TableHeader>
                <TableHeader className="text-right">Cost</TableHeader>
                <TableHeader className="text-right">Started</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                        className="text-sm font-medium text-zinc-200 hover:text-white transition-colors truncate"
                      >
                        {copilotNameById.get(run.copilotId) ?? run.copilotId}
                      </Link>
                      <span className="text-[10px] font-mono text-zinc-600 mt-0.5 truncate">{run.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge color={runStatusBadgeColor(run.status)} className="uppercase tracking-widest">
                      {statusLabel(run.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-400">
                    {run.latencyMs}ms
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-400">
                    {formatUsd(run.costUsd)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-500">
                    {formatTimestamp(run.startedAt).replace(' UTC', '')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
          <BoltIcon className="size-8 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-white">No runs recorded</p>
          <p className="text-xs text-zinc-500 mt-1">System is standing by for traffic.</p>
        </div>
      )}
    </div>
  )
}

export default async function DashboardPage() {
  const [copilots, runs, kpis] = await Promise.all([
    getCopilots(),
    getRecentRuns(30),
    getRegistryKpis(),
  ])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))
  const hasWarnings = copilots.some((copilot) => copilot.health.openWarnings > 0)

  return (
    <div className="flex flex-col gap-8 pb-12">
      {hasWarnings ? (
        <StaggerFade delay={0}>
          <AttentionZone copilots={copilots} />
        </StaggerFade>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 min-h-[600px]">
        <StaggerFade delay={1} className="xl:col-span-2 h-full">
          <RunActivity runs={runs} copilotNameById={copilotNameById} kpis={kpis} />
        </StaggerFade>

        <div className="flex flex-col gap-6 h-full">
          <StaggerFade delay={2} className="flex-1">
            <SystemTopology />
          </StaggerFade>
          <StaggerFade delay={3} className="flex-1">
            <FleetDistribution />
          </StaggerFade>
        </div>
      </div>
    </div>
  )
}
