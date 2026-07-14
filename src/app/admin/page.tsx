import { BoltIcon, CpuChipIcon, FolderIcon, ShieldCheckIcon, ChartBarIcon, ServerStackIcon, ClockIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProjects, getRecentRuns, getRegistryKpis } from '@/lib/agent-mission-control/data'
import { formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Command Center — Aigent',
}

const numberFormat = new Intl.NumberFormat('en-US')

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

interface KpiBandProps {
  kpis: {
    activeCopilots: number
    totalCopilots: number
    runsLast24h: number
    totalCostLast24hUsd: number
    openWarnings: number
  }
}

function KpiBand({ kpis }: KpiBandProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-6 border-b border-white/5 mb-8">
      <div className="flex flex-col group cursor-default">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2 group-hover:text-zinc-400 transition-colors">Active Fleet</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{kpis.activeCopilots}</span>
          <span className="text-sm text-zinc-500">/ {kpis.totalCopilots}</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2 group-hover:text-zinc-400 transition-colors">24h Volume</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{numberFormat.format(kpis.runsLast24h)}</span>
          <span className="text-sm text-zinc-500">runs</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2 group-hover:text-zinc-400 transition-colors">24h Compute Cost</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{formatUsd(kpis.totalCostLast24hUsd)}</span>
        </div>
      </div>
      <div className="flex flex-col group cursor-default">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2 group-hover:text-zinc-400 transition-colors">System Health</span>
        <div className="flex items-baseline gap-2">
          {kpis.openWarnings > 0 ? (
            <span className="text-4xl font-light tracking-tight text-accent-400">{kpis.openWarnings}</span>
          ) : (
            <span className="text-4xl font-light tracking-tight text-accent-400">100%</span>
          )}
          <span className="text-sm text-zinc-500">{kpis.openWarnings > 0 ? 'warnings' : 'nominal'}</span>
        </div>
      </div>
    </div>
  )
}

function AttentionZone({ copilots }: { copilots: Copilot[] }) {
  const flagged = copilots
    .filter((copilot) => copilot.health.openWarnings > 0)
    .sort((a, b) => b.health.openWarnings - a.health.openWarnings)
    .slice(0, 4)

  if (flagged.length === 0) return null

  return (
    <div className="mb-8 rounded-xl bg-accent-500/10 border border-accent-500/20 p-6 shadow-[0_0_30px_rgba(99,102,241,0.1)]">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheckIcon className="size-5 text-accent-400" />
        <h2 className="text-sm font-semibold text-accent-400 uppercase tracking-widest">Needs Attention</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {flagged.map(copilot => (
          <div key={copilot.id} className="group flex flex-col gap-2 bg-black/40 rounded-lg p-4 border border-accent-500/20 hover:bg-black/60 transition-colors cursor-pointer">
            <div className="flex items-start justify-between">
              <Link href={`/admin/agents/${copilot.id}`} className="text-sm font-medium text-white group-hover:underline truncate">
                {copilot.name}
              </Link>
              <Badge color="accentStrong" className="shrink-0">{copilot.health.openWarnings}</Badge>
            </div>
            <div className="text-xs text-zinc-400 font-mono truncate">{copilot.slug}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemTopology() {
  return (
    <div className="rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 p-6 flex flex-col h-full relative overflow-hidden group">
      {/* Subtle background pulse */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-accent-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-accent-500/10 transition-colors duration-1000" />
      
      <div className="flex items-center justify-between mb-8 relative z-10">
        <h2 className="text-sm font-semibold text-white">System Topology</h2>
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent-500/10 border border-accent-500/20">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75"></span>
            <span className="relative inline-flex size-1.5 rounded-full bg-accent-500"></span>
          </span>
          <span className="text-[10px] text-accent-400 font-medium uppercase tracking-widest">Connected</span>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col justify-center gap-8 relative z-10">
        <div className="flex items-center justify-between px-5 py-4 rounded-xl bg-[var(--color-surface-interactive)] border border-white/5 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-white/5 ring-1 ring-white/10">
              <ServerStackIcon className="size-5 text-zinc-300" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-white">Agent Server</span>
              <span className="text-xs font-mono text-zinc-500 mt-0.5">wss://graph.aigent.internal</span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs font-mono text-accent-400">12ms ping</span>
          </div>
        </div>
        
        {/* Animated Connection Lines */}
        <div className="relative h-12 flex justify-center w-full">
          <div className="absolute inset-0 flex justify-center">
            <div className="w-px h-full bg-gradient-to-b from-white/10 via-accent-500/50 to-white/10"></div>
          </div>
          <div className="absolute inset-0 flex justify-between px-16">
            <div className="w-px h-full bg-gradient-to-b from-white/10 via-accent-500/20 to-white/10 transform rotate-12"></div>
            <div className="w-px h-full bg-gradient-to-b from-white/10 via-accent-500/20 to-white/10 transform -rotate-12"></div>
          </div>
          {/* Moving particles */}
          <div className="absolute top-0 w-1.5 h-1.5 bg-accent-400 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-[var(--color-surface-interactive)] border border-white/5 hover:border-white/10 transition-colors">
            <div className="flex items-center justify-between">
              <CpuChipIcon className="size-4 text-zinc-400" />
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">Workers</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-light text-white">12</span>
              <span className="text-xs text-accent-400 font-medium">Active</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 p-4 rounded-xl bg-[var(--color-surface-interactive)] border border-white/5 hover:border-white/10 transition-colors">
            <div className="flex items-center justify-between">
              <ArrowPathIcon className="size-4 text-zinc-400" />
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">Throughput</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-light text-white">4.2</span>
              <span className="text-xs text-zinc-500 font-mono">req/s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FleetDistribution({ copilots }: { copilots: Copilot[] }) {
  const statuses = ['active', 'degraded', 'paused', 'draft', 'archived'] as const
  const counts = statuses.map(s => copilots.filter(c => c.status === s).length)
  const total = copilots.length
  const activeCount = counts[0]
  const activePct = Math.round((activeCount / total) * 100)

  return (
    <div className="rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold text-white">Fleet Distribution</h2>
        <Link href="/admin/agents" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
          View Fleet &rarr;
        </Link>
      </div>
      
      <div className="flex-1 flex flex-col justify-center gap-8">
        <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--color-surface-interactive)] border border-white/5">
          <div className="flex flex-col">
            <span className="text-3xl font-light text-white">{activeCount}</span>
            <span className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Active Agents</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xl font-light text-accent-400">{activePct}%</span>
            <span className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Of Total Fleet</span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Segmented Bar */}
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-white/5 gap-0.5">
            {statuses.map((status, i) => {
              const count = counts[i]
              if (count === 0) return null
              const pct = (count / total) * 100
              return (
                <div 
                  key={status}
                  className={`h-full ${status === 'active' ? 'bg-accent-500' : status === 'degraded' ? 'bg-accent-600' : status === 'draft' ? 'bg-zinc-400' : 'bg-zinc-600'}`}
                  style={{ width: `${pct}%` }}
                  title={`${statusLabel(status)}: ${count}`}
                />
              )
            })}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            {statuses.map((status, i) => {
              const count = counts[i]
              if (count === 0) return null
              return (
                <div key={status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${status === 'active' ? 'bg-accent-500' : status === 'degraded' ? 'bg-accent-600' : status === 'draft' ? 'bg-zinc-400' : 'bg-zinc-600'}`} />
                    <span className="text-zinc-400 capitalize">{statusLabel(status)}</span>
                  </div>
                  <span className="text-white font-mono">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunActivity({ runs, copilotNameById }: { runs: AgentRun[], copilotNameById: Map<string, string> }) {
  const latencyPoints = [...runs].reverse().map((run) => ({
    id: run.id,
    label: formatTimestamp(run.startedAt).replace(' UTC', ''),
    latencyMs: run.latencyMs,
    costUsd: run.costUsd,
    status: run.status,
  }))
  const shown = runs.slice(0, 8)

  return (
    <div className="rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between p-6 border-b border-white/5">
        <div>
          <h2 className="text-sm font-semibold text-white">Global Run Activity</h2>
          <p className="text-xs text-zinc-400 mt-1">Latency and cost across all copilots</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="size-2 rounded-full bg-accent-500/50 border border-accent-500"></span>
            Latency (ms)
          </span>
        </div>
      </div>
      
      {runs.length > 0 ? (
        <div className="flex flex-col flex-1">
          <div className="p-6 bg-[var(--color-surface-primary)]/30 border-b border-white/5">
            <RunLatencyChart data={latencyPoints} />
          </div>
          <Table>
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
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 text-[10px] font-medium uppercase tracking-widest ${run.status === 'completed' ? 'text-accent-400 bg-accent-400/10 ring-accent-400/20' : run.status === 'failed' ? 'text-accent-400 bg-accent-400/10 ring-accent-400/20' : 'text-zinc-400 bg-zinc-400/10 ring-zinc-400/20'}`}>
                      {statusLabel(run.status)}
                    </span>
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
  const [copilots, projects, kpis, runs] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRegistryKpis(),
    getRecentRuns(30),
  ])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AgentPageHeader 
          title="Command Center" 
          environment="Production"
          live={true}
          description="Global overview of fleet operations, system health, and agent activity."
        />
      </StaggerFade>

      <StaggerFade delay={1}>
        <KpiBand kpis={kpis} />
      </StaggerFade>

      <StaggerFade delay={2}>
        <AttentionZone copilots={copilots} />
      </StaggerFade>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 min-h-[600px]">
        <StaggerFade delay={3} className="xl:col-span-2 h-full">
          <RunActivity runs={runs} copilotNameById={copilotNameById} />
        </StaggerFade>
        
        <div className="flex flex-col gap-6 h-full">
          <StaggerFade delay={4} className="flex-1">
            <SystemTopology />
          </StaggerFade>
          <StaggerFade delay={5} className="flex-1">
            <FleetDistribution copilots={copilots} />
          </StaggerFade>
        </div>
      </div>
    </div>
  )
}
