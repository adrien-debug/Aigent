import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { formatDurationMs, formatPercent } from '@/lib/agent-mission-control/format'
import type { RuntimeTelemetryFleetSummary } from '@/lib/agent-mission-control/runtime-telemetry-store'

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * TelemetryKpiBand — fleet-wide headline stats for /admin/telemetry, mirrors
 * FleetKpiBand's canon (AgentKpiBand + SplitBar, one accent). Everything
 * derives from summarizeFleetRuntimeTelemetry() — a signal without data
 * renders '—', never a fabricated number.
 */
export function TelemetryKpiBand({
  summary,
  className,
}: {
  summary: RuntimeTelemetryFleetSummary
  className?: string
}) {
  const terminalTotal = summary.byAgent.reduce(
    (sum, a) => sum + (a.successRate !== null ? a.totalRuns : 0),
    0
  )
  const completedTotal = Math.round((summary.successRate ?? 0) * terminalTotal)
  const failedTotal = terminalTotal - completedTotal

  const stats: AgentKpiStat[] = [
    {
      name: 'Total Events',
      value: numberFormat.format(summary.totalRuns),
      valueTone: summary.totalRuns > 0 ? 'accent' : 'muted',
      hint: `across ${summary.reportingAgents} agent${summary.reportingAgents === 1 ? '' : 's'}`,
    },
    {
      name: 'Success Rate',
      value: summary.successRate === null ? '—' : formatPercent(summary.successRate, 0),
      valueTone: summary.successRate !== null && summary.successRate >= 0.9 ? 'accent' : 'default',
      viz:
        terminalTotal > 0 ? (
          <SplitBar
            showLegend={false}
            segments={[
              { key: 'completed', label: 'Completed', value: completedTotal, tone: 'accent-500' },
              { key: 'failed', label: 'Failed', value: failedTotal, tone: 'zinc' },
            ]}
          />
        ) : undefined,
      hint: terminalTotal > 0 ? `${completedTotal} completed · ${failedTotal} failed` : undefined,
    },
    {
      name: 'Avg Latency',
      value: summary.avgLatencyMs === null ? '—' : formatDurationMs(summary.avgLatencyMs),
    },
    {
      name: 'P95 Latency',
      value: summary.p95LatencyMs === null ? '—' : formatDurationMs(summary.p95LatencyMs),
    },
    {
      name: 'Total Tokens',
      value: summary.totalTokens === null ? '—' : numberFormat.format(summary.totalTokens),
      valueTone: 'muted',
    },
  ]

  return <AgentKpiBand stats={stats} className={className} />
}
