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
 *
 * "Tool Calls" surfaces the AGENTS.md LangGraph trap at the fleet level:
 * `invoked / signaled` runs, plus a hint calling out how many completed runs
 * carried a tool signal but invoked zero tools — a catalogue can look
 * healthy (runs complete) while every run reached the model with no tool
 * mounted. Renders '—' when the emitter never reports the signal at all
 * (`toolSignals.state !== 'MEASURED'`), never a fabricated 0.
 */
export function TelemetryKpiBand({
  summary,
  className,
}: {
  summary: RuntimeTelemetryFleetSummary
  className?: string
}) {
  // Real terminal counts from the store's per-agent rollup. NEVER reconstruct the
  // completed/failed split by multiplying a float success rate by a denominator
  // that includes in-flight 'started' pings — that fabricated a split up to 10x
  // off (the store documents completedRuns/failedRuns exactly to avoid this).
  const completedTotal = summary.byAgent.reduce((sum, a) => sum + a.completedRuns, 0)
  const failedTotal = summary.byAgent.reduce((sum, a) => sum + a.failedRuns, 0)
  const terminalTotal = completedTotal + failedTotal

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
      hint: summary.measurement.tokens === 'UNAVAILABLE' ? 'not reported by emitter' : undefined,
    },
    {
      name: 'Tool Calls',
      value:
        summary.toolSignals.state !== 'MEASURED'
          ? '—'
          : `${numberFormat.format(summary.toolSignals.runsInvokedTools ?? 0)} / ${numberFormat.format(
              summary.toolSignals.runsWithToolSignal ?? 0
            )}`,
      valueTone:
        summary.toolSignals.state === 'MEASURED' &&
        (summary.toolSignals.runsExecutedWithoutTools ?? 0) > 0
          ? 'default'
          : 'muted',
      hint:
        summary.toolSignals.state !== 'MEASURED'
          ? 'not reported by emitter'
          : (summary.toolSignals.runsExecutedWithoutTools ?? 0) > 0
            ? `${numberFormat.format(summary.toolSignals.runsExecutedWithoutTools ?? 0)} ran without invoking a tool`
            : 'every signaled run invoked a tool',
    },
  ]

  return <AgentKpiBand stats={stats} className={className} />
}
