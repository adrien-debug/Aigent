import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { formatDurationMs, formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import type { RuntimeTelemetrySummary } from '@/lib/agent-mission-control/runtime-telemetry-store'

/**
 * Runtime Telemetry — compact, read-only readout of the opt-in runtime signal
 * reported by delivered agents (POST /api/runtime-telemetry). Purely additive
 * next to the Delivery Scorecard: no telemetry configured/reported yet →
 * the canonical EmptyState, never a custom empty markup.
 */
export function RuntimeTelemetryCard({ summary }: { summary: RuntimeTelemetrySummary | null }) {
  const hasData = summary !== null && summary.totalRuns > 0

  return (
    <AgentSectionCard
      title="Runtime telemetry"
      description="Opt-in signal reported by the delivered agent from the target repo."
      contentClassName={hasData ? 'px-6 py-5' : undefined}
    >
      {hasData ? (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Last seen</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
              {summary.lastSeenAt !== null ? formatTimestamp(summary.lastSeenAt) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Success rate</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
              {summary.successRate !== null ? formatPercent(summary.successRate) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Avg latency</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
              {summary.avgLatencyMs !== null ? formatDurationMs(summary.avgLatencyMs) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Failures</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
              {summary.successRate !== null ? summary.totalRuns - Math.round(summary.totalRuns * summary.successRate) : '—'}
            </dd>
          </div>
        </dl>
      ) : (
        <EmptyState
          title="No runtime telemetry"
          description="This agent hasn't reported any runtime signal yet — telemetry is opt-in from the delivered runtime."
        />
      )}
    </AgentSectionCard>
  )
}
