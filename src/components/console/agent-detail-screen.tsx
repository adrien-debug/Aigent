import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import { Metric, ScreenHeader, Section } from './screen-primitives'

const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`

export function AgentDetailScreen({ detail }: { detail: AgentDetail }) {
  const { copilot, agent, metrics, blockers } = detail
  return (
    <div className="space-y-8">
      <ScreenHeader
        title={copilot.name}
        description={copilot.description}
        actions={<Button href="/admin/agents" outline>Back to agents</Button>}
      />
      <div className="flex flex-wrap gap-3">
        <StatusDot tone={detail.executable ? 'positive' : 'neutral'}>
          {detail.executable ? 'Executable now' : 'Execution blocked'}
        </StatusDot>
        <span className="text-xs text-zinc-400">Runtime: {agent?.runtime ?? 'unavailable'}</span>
        <span className="text-xs text-zinc-400">Lifecycle: {agent?.lifecycleStatus ?? copilot.status}</span>
      </div>
      <div className="grid divide-y divide-white/8 border-y border-white/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="Runs · 24h" value={metrics.runs24h} detail={`${metrics.totalRuns} loaded`} />
        <Metric label="Success" value={percent(metrics.successRate)} detail="Terminal runs only" />
        <Metric label="Tool calls" value={metrics.toolCallCount ?? '—'} detail={`${metrics.completedRuns} completed runs`} />
        <Metric label="Cost · 24h" value={metrics.cost24hUsd === null ? '—' : `$${metrics.cost24hUsd.toFixed(4)}`} detail={`${metrics.runsWithoutCost} uncosted`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Execution gate" description="The same blockers enforced by the run endpoint">
          {blockers.length === 0 ? (
            <div className="px-6 py-10"><StatusDot tone="positive">All runtime requirements are satisfied</StatusDot></div>
          ) : (
            <div className="divide-y divide-white/8">
              {blockers.map((blocker) => (
                <div key={blocker.code} className="px-5 py-4 sm:px-6">
                  <p className="text-sm font-medium text-white">{blocker.label}</p>
                  <p className="mt-1 text-xs text-zinc-400">{blocker.detail}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Mounted tools" description="Persisted tool definitions for the current agent">
          <div className="divide-y divide-white/8">
            {detail.tools.length === 0 ? (
              <p className="px-6 py-10 text-sm text-zinc-400">No mounted tool is available.</p>
            ) : detail.tools.map((tool) => (
              <div key={tool.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{tool.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{tool.riskLevel} risk</p>
                </div>
                <StatusDot tone={tool.enabled ? 'positive' : 'neutral'}>{tool.enabled ? 'Enabled' : 'Disabled'}</StatusDot>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
