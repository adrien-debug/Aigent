import { notFound } from 'next/navigation'
import {
  CostValue,
  DurationValue,
  RateValue,
  TimeAgoValue,
} from '@/components/agent-ops/agent-detail/agent-value'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import {
  getBenchmarkRunsForSuites,
  getBenchmarkSuitesForCopilot,
  getTestRunsForCopilot,
} from '@/lib/agent-mission-control/data'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Observability — health, reliability, readiness (AIGENT-AGENT-PAGES-021).
 *
 * Consolidates the legacy Quality, Improve, Tests and Release pages. Those
 * filled large surfaces with placeholder scores; here an absent measurement is
 * a compact honest line stating cause, impact and action — never a fake 100%,
 * never a big dashed box.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className={surfaceSectionClass}>
      <div className="px-5 pt-4 pb-3">
        <Subheading level={2}>{title}</Subheading>
        {description ? <Text className="mt-1 !text-xs">{description}</Text> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}

/** Compact, honest absence: cause + impact + action, on a few lines. */
function NotConfigured({ cause, impact, action }: { cause: string; impact: string; action: string }) {
  return (
    <dl className="flex flex-col gap-2 text-xs leading-5">
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-500">Cause</dt>
        <dd className="text-zinc-300">{cause}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-500">Impact</dt>
        <dd className="text-zinc-300">{impact}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-zinc-500">Action</dt>
        <dd className="text-zinc-300">{action}</dd>
      </div>
    </dl>
  )
}

export default async function AgentObservabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  const { agent, metrics, runs, tools, blockers, executable } = detail

  // Benchmarks and tests are read live: absence is a fact to report, not to hide.
  const suites = await getBenchmarkSuitesForCopilot(id)
  const benchmarkRuns = suites.length > 0 ? await getBenchmarkRunsForSuites(suites.map((s) => s.id)) : []
  const testRuns = await getTestRunsForCopilot(id)

  const failed = runs.filter((r) => r.status === 'failed').length
  const unsafeTotal = runs.reduce((a, r) => a + (r.unsafeAttemptCount ?? 0), 0)
  const errorRuns = runs.filter((r) => r.status === 'failed' || r.status === 'blocked')

  return (
    <div className="flex flex-col gap-6">
      <Section title="Readiness" description="Whether this agent can serve, and what stands in the way.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={executable ? 'accent' : 'zinc'}>{executable ? 'Executable' : 'Not executable'}</Badge>
            <Badge color="zinc">Status: {agent?.status ?? 'unavailable'}</Badge>
            <Badge color={metrics.totalRuns > 0 ? 'accent' : 'zinc'}>
              {metrics.totalRuns > 0 ? `${metrics.totalRuns} proof runs` : 'No proof run'}
            </Badge>
            <Badge color={(agent?.unresolvedToolIds.length ?? 0) === 0 ? 'accent' : 'accentSolid'}>
              {agent?.unresolvedToolIds.length ?? 0} unresolved tools
            </Badge>
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
              { label: 'Unsafe attempts', value: String(unsafeTotal) },
            ].map((cell) => (
              <div key={cell.label}>
                <dt className={eyebrowClass}>{cell.label}</dt>
                <dd className="mt-1 font-mono text-lg/6 font-light tabular-nums text-zinc-100">{cell.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Tool reliability" description="Mounted tools and their execution readiness.">
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
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {tool.lastUsedAt ? <TimeAgoValue value={tool.lastUsedAt} /> : 'never used'}
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
                <Badge color="accentSolid">{run.status}</Badge>
                <span className="truncate text-xs text-zinc-400">{run.outputSummary || 'No output recorded'}</span>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  <TimeAgoValue value={run.startedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
