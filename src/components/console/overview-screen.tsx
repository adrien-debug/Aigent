import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { Metric, ScreenHeader, Section } from './screen-primitives'

function metric(value: number | null, suffix = '') {
  return value === null ? '—' : `${value}${suffix}`
}

export function OverviewScreen({ overview }: { overview: DashboardOverview }) {
  const { kpis } = overview
  return (
    <div className="space-y-8">
      <ScreenHeader
        title="Overview"
        description="Agents, projects and delivery signals from the live control plane."
        actions={<Button href="/admin/runs" color="accent">Open runs <ArrowRightIcon /></Button>}
      />

      {overview.dataWarnings.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-zinc-200">
          <StatusDot tone="neutral">Partial data</StatusDot>
          <p className="mt-2 text-xs text-zinc-400">{overview.dataWarnings.join(' · ')}</p>
        </div>
      ) : null}

      <div className="grid divide-y divide-white/8 border-y border-white/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="Executable now" value={kpis.executableNow === null ? '—' : `${kpis.executableNow} / ${kpis.executableTotal}`} detail="Agents passing runtime gates" />
        <Metric label="Runs · 24h" value={kpis.runs24h} detail="Operational executions" />
        <Metric label="Success · 24h" value={metric(kpis.success24h, '%')} detail="Terminal runs only" />
        <Metric label="Needs action" value={kpis.needsAction} detail="Operator queue" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.6fr)]">
        <Section title="Projects" description="Live project rollup">
          <div className="divide-y divide-white/8">
            {overview.projects.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-zinc-400">No project is available.</p>
            ) : overview.projects.slice(0, 8).map((project) => (
              <a key={project.id} href={`/admin/projects/${project.id}/builder`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/3 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{project.name}</p>
                  <p className="mt-1 truncate text-xs text-zinc-400">{project.repoFullName ?? 'Repository not configured'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-5 text-right">
                  <div><p className="text-sm tabular-nums text-white">{project.activeCount}/{project.copilotCount}</p><p className="text-[11px] text-zinc-500">active</p></div>
                  <div><p className="text-sm tabular-nums text-white">{project.runsLast24h}</p><p className="text-[11px] text-zinc-500">runs</p></div>
                </div>
              </a>
            ))}
          </div>
        </Section>

        <Section title="Action queue" description="Highest-priority operator decisions">
          <div className="divide-y divide-white/8">
            {overview.actionItems.length === 0 ? (
              <div className="px-6 py-12 text-center"><StatusDot tone="positive">No action required</StatusDot></div>
            ) : overview.actionItems.map((item) => (
              <div key={item.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-zinc-400">{item.meta}</p>
                  </div>
                  <span className="text-xs text-zinc-500">{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
