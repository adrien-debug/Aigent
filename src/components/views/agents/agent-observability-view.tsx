import {
  CostValue,
  CountValue,
  DurationValue,
  RateValue,
  TimeAgoValue,
} from '@/components/agent-ops/agent-detail/agent-value'
import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { PageLayout } from '@/components/shell/page-layout'
import { eyebrowClass } from '@/components/shell/page-header'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import type { AgentObservabilityPageData } from '@/lib/agent-mission-control/agent-observability-page-data'
import {
  AGENT_STATUS_DIMENSION_LABELS,
  AVAILABLE_AGENT_STATUS_LABELS,
  agentExecutableLabel,
} from '@/lib/agent-mission-control/labels'

/** Compact, honest absence: cause + impact + action, on a few lines. */
function NotConfigured({ cause, impact, action }: { cause: string; impact: string; action: string }) {
  return (
    // zinc-400 on the <dt> labels, not -500: check-contrast measures -500 at
    // 3.59:1 on this raised plane (rgb(26,26,30)) for a 4.5 threshold. The label
    // stays quieter than its <dd> (zinc-300), which is all the hierarchy needed.
    <dl className="flex flex-col gap-2 text-xs leading-5">
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-400">Cause</dt>
        <dd className="text-zinc-300">{cause}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-400">Impact</dt>
        <dd className="text-zinc-300">{impact}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-400">Action</dt>
        <dd className="text-zinc-300">{action}</dd>
      </div>
    </dl>
  )
}

/**
 * Observability — health, reliability, readiness (AIGENT-AGENT-PAGES-021).
 *
 * Consolidates the legacy Quality, Improve, Tests and Release pages. Those
 * filled large surfaces with placeholder scores; here an absent measurement is
 * a compact honest line stating cause, impact and action — never a fake 100%,
 * never a big dashed box.
 */
export function AgentObservabilityView({ detail, suites, benchmarkRuns, testRuns }: AgentObservabilityPageData) {
  const { agent, metrics, runs, tools, blockers, executable } = detail

  const failed = runs.filter((r) => r.status === 'failed').length
  // `agent_runs.unsafe_attempt_count` is typed `number` but arrives from an
  // unvalidated row: coalescing a missing count to 0 published "0 unsafe
  // attempts" — a SAFETY claim — for runs that never recorded one. Only runs
  // that actually carry a number are counted, and none of them means unknown.
  const unsafeCounted = runs.filter((r) => typeof r.unsafeAttemptCount === 'number')
  const unsafeTotal =
    unsafeCounted.length > 0 ? unsafeCounted.reduce((a, r) => a + r.unsafeAttemptCount, 0) : null
  const errorRuns = runs.filter((r) => r.status === 'failed' || r.status === 'blocked')

  return (
    <PageLayout>
      <Section title="Readiness" description="Whether this agent can serve, and what stands in the way.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={executable ? 'accent' : 'zinc'}>
              {AGENT_STATUS_DIMENSION_LABELS.executable}: {agentExecutableLabel(executable)}
            </Badge>
            {/* An agent absent from the canonical catalogue has NO runtime
                status; `?? 'unavailable'` printed a derived status the
                catalogue never derived, which is a fabricated measurement. */}
            <Badge color="zinc">
              {AGENT_STATUS_DIMENSION_LABELS.runtime}:{' '}
              {agent ? AVAILABLE_AGENT_STATUS_LABELS[agent.status] : 'Not in catalogue'}
            </Badge>
            <Badge color={metrics.totalRuns > 0 ? 'accent' : 'zinc'}>
              {metrics.totalRuns > 0 ? `${metrics.totalRuns} proof runs` : 'No proof run'}
            </Badge>
            {/* No catalogue entry ⇒ nobody resolved this agent's tools. "0
                unresolved tools" claimed a check that never ran. */}
            {agent === undefined ? (
              <Badge color="zinc">Unresolved tools: unknown</Badge>
            ) : (
              <Badge color={agent.unresolvedToolIds.length === 0 ? 'accent' : 'accentSolid'}>
                {agent.unresolvedToolIds.length} unresolved tools
              </Badge>
            )}
          </div>

          {blockers.length > 0 ? (
            <div>
              <p className={eyebrowClass}>Blockers</p>
              <ul className="mt-2 flex flex-col">
                {blockers.map((b) => (
                  <li key={b.code} className="border-b border-white/5 py-2.5 text-sm leading-6 last:border-0">
                    <span className="font-medium text-zinc-100">{b.label}</span>
                    <span className="text-zinc-400"> — {b.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Text className="!text-xs">No blocker. The run gate accepts this agent.</Text>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Run reliability" description="Measured across the recorded run history.">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            {[
              { label: 'Total runs', value: String(metrics.totalRuns) },
              { label: 'Success rate', value: <RateValue value={metrics.successRate} /> },
              { label: 'Failed runs', value: String(failed) },
              { label: 'Avg duration', value: <DurationValue value={metrics.avgDurationMs} /> },
              { label: 'Cost 24h', value: <CostValue value={metrics.cost24hUsd} /> },
              { label: 'Unsafe attempts', value: <CountValue value={unsafeTotal} /> },
            ].map((cell) => (
              <div key={cell.label}>
                <dt className={eyebrowClass}>{cell.label}</dt>
                <dd className="mt-1 font-mono text-lg/6 font-light tabular-nums text-zinc-100">{cell.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="Tool reliability"
          description="Mounted tools and their execution readiness. Last use is not recorded by the runner today."
        >
          {tools.length === 0 ? (
            <Text className="!text-xs">No tool mounted.</Text>
          ) : (
            <ul className="flex flex-col">
              {tools.map((tool) => (
                <li
                  key={tool.id}
                  className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0"
                >
                  <span className="truncate font-mono text-xs text-zinc-300">{tool.name}</span>
                  {/* `tools.last_used_at` exists in the schema (migration 0001)
                      but NOTHING in `src/` ever writes it. A NULL therefore
                      proves the column is unwritten, not that the tool was never
                      called — "never used" turned a missing writer into a
                      measurement, on tools that had demonstrably run. */}
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    {tool.lastUsedAt ? <TimeAgoValue value={tool.lastUsedAt} /> : 'Last use unknown'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Benchmarks" description="Scored evaluations of this agent.">
          {benchmarkRuns.length === 0 ? (
            <NotConfigured
              cause="No benchmark run has been recorded for this agent."
              impact="There is no scored quality baseline. No score is shown, because none exists."
              action="Run a benchmark suite to establish a baseline."
            />
          ) : (
            <Text className="!text-xs">
              {benchmarkRuns.length} benchmark run{benchmarkRuns.length === 1 ? '' : 's'} across {suites.length} suite
              {suites.length === 1 ? '' : 's'}.
            </Text>
          )}
        </Section>

        <Section title="Test coverage" description="Functional suites executed against this agent.">
          {testRuns.length === 0 ? (
            <NotConfigured
              cause="No test run has been recorded for this agent."
              impact="Behaviour is unverified beyond its live runs."
              action="Generate and run a test suite."
            />
          ) : (
            <Text className="!text-xs">
              {testRuns.length} test run{testRuns.length === 1 ? '' : 's'} recorded.
            </Text>
          )}
        </Section>
      </div>

      <Section title="Errors" description="Runs that failed or were blocked by a guardrail.">
        {errorRuns.length === 0 ? (
          <Text className="!text-xs">No failed or blocked run recorded.</Text>
        ) : (
          <ul className="flex flex-col">
            {errorRuns.slice(0, 10).map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 py-2.5 last:border-0"
              >
                <RunStatusText status={run.status} />
                <span className="truncate text-xs text-zinc-400">{run.outputSummary || 'No output recorded'}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">
                  <TimeAgoValue value={run.startedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageLayout>
  )
}
