
import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunTestsButton } from '@/components/agent-ops/run-tests-button'
import { TestCaseTable } from '@/components/agent-ops/test-case-table'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { SplitBar, type SplitSegment } from '@/components/agent-ops/widgets/split-bar'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { formatDate, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getTestCasesForSuite,
  getTestResultsForRun,
  getTestRunsForCopilot,
  getTestSuitesForCopilot,
} from '@/lib/agent-mission-control/data'
import type { TestResult, TestResultStatus, TestRun, TestSuite } from '@/lib/agent-mission-control/types'

const suiteKindConfig: Record<TestSuite['kind'], { label: string }> = {
  behavior: { label: 'Behavior' },
  safety: { label: 'Safety' },
  regression: { label: 'Regression' },
  'output-contract': { label: 'Output contract' },
}

const runStatusConfig: Record<TestRun['status'], { label: string }> = {
  completed: { label: 'Completed' },
  running: { label: 'Running' },
  queued: { label: 'Queued' },
  aborted: { label: 'Aborted' },
}

export async function TestsSection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

  const [suites, testRuns] = await Promise.all([getTestSuitesForCopilot(id), getTestRunsForCopilot(id)])
  const runsById = new Map(testRuns.map((run) => [run.id, run]))

  // Pass-rate trend series (completed runs, oldest → newest) — folded into the
  // KPI strip as an inline server Sparkline, no client chart boundary.
  const passRateSeries = testRuns
    .filter((run) => run.status === 'completed')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((run) => run.passRate)

  // Most recent run overall (any status) drives the "Last run cost" cell.
  const latestRun = [...testRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]

  const suiteViews = await Promise.all(
    suites.map(async (suite) => {
      const lastRun = suite.lastRunId ? runsById.get(suite.lastRunId) : undefined
      const [results, cases] = await Promise.all([
        lastRun ? getTestResultsForRun(lastRun.id) : ([] as TestResult[]),
        getTestCasesForSuite(suite.id),
      ])

      const resultsByCase: Record<string, TestResult | undefined> = {}
      const counts: Record<TestResultStatus, number> = { pass: 0, fail: 0, error: 0, skip: 0, running: 0 }
      for (const result of results) {
        resultsByCase[result.caseId] = result
        counts[result.status] += 1
      }

      return { suite, lastRun, results, resultsByCase, counts, cases }
    })
  )

  if (suites.length === 0) {
    return (
      <section className="rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
        <div className="px-6 py-12 sm:px-12">
          <div className="max-w-xl">
            <Subheading>No test suites yet</Subheading>
            <Text className="mt-2">
              This copilot ships without a test harness. Before it serves real traffic, give the promotion gate
              something to measure:
            </Text>
            <ul className="mt-6 space-y-3">
              {[
                'Start with a behavior suite covering the copilot’s core scenarios end-to-end.',
                'Add a safety suite for forbidden actions, PII handling and confirmation policy.',
                'Freeze regressions: every production incident becomes a permanent test case.',
                'Pin the output contract so schema drift fails a test instead of a customer.',
              ].map((step) => (
                <li key={step} className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                  {step}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    )
  }

  // Cross-suite aggregates — one dense stat band replacing the standalone trend
  // panel and the per-suite scatter.
  const casesTotal = suiteViews.reduce((sum, view) => sum + view.cases.length, 0)
  const agg: Record<TestResultStatus, number> = { pass: 0, fail: 0, error: 0, skip: 0, running: 0 }
  for (const view of suiteViews) {
    for (const status of Object.keys(agg) as TestResultStatus[]) agg[status] += view.counts[status]
  }
  const evaluated = agg.pass + agg.fail + agg.error
  const overallPassRate = evaluated > 0 ? agg.pass / evaluated : null
  const suitesFailing = suiteViews.filter((view) => view.counts.fail > 0 || view.counts.error > 0).length

  return (
    <div className="space-y-8">
      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
        <AgentMetricCard
          label="Suites"
          value={String(suiteViews.length)}
          hint={suitesFailing > 0 ? `${suitesFailing} with failures` : 'All suites green'}
        />
        <AgentMetricCard label="Test cases" value={String(casesTotal)} hint="Across all suites" />
        <AgentMetricCard
          label="Overall pass rate"
          value={overallPassRate !== null ? formatPercent(overallPassRate) : '—'}
          hint={overallPassRate !== null ? `${agg.pass} / ${evaluated} evaluated` : 'No runs yet'}
          viz={
            overallPassRate !== null ? (
              <div className="space-y-2">
                <LinearMeter value={overallPassRate} max={1} tone="accent" ariaLabel="Overall pass rate" />
                {passRateSeries.length >= 2 ? (
                  <Sparkline
                    points={passRateSeries}
                    tone="accent"
                    width={132}
                    height={24}
                    ariaLabel="Pass rate trend across runs"
                  />
                ) : null}
              </div>
            ) : undefined
          }
        />
        <AgentMetricCard
          label="Last run cost"
          value={latestRun ? formatUsd(latestRun.totalCostUsd) : '—'}
          hint={latestRun ? `${formatDate(latestRun.startedAt)} · ${latestRun.triggeredBy}` : 'No runs yet'}
        />
      </div>

      <AgentSectionCard title="Test suites">
        <div className="space-y-8">
          {suiteViews.map(({ suite, lastRun, results, resultsByCase, counts, cases }) => {
            const kind = suiteKindConfig[suite.kind]
            const runStatus = lastRun ? runStatusConfig[lastRun.status] : null

            const segments: SplitSegment[] = [
              { key: 'pass', label: 'Pass', value: counts.pass, tone: 'accent-400' },
              { key: 'error', label: 'Error', value: counts.error, tone: 'accent-600' },
              { key: 'fail', label: 'Fail', value: counts.fail, tone: 'accent-700' },
              { key: 'skip', label: 'Skip', value: counts.skip, tone: 'zinc' },
            ]

            return (
              <div
                key={suite.id}
                className="border-t border-zinc-950/5 pt-8 first:border-0 first:pt-0 dark:border-white/5"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 lg:flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Subheading level={3}>{suite.name}</Subheading>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{kind.label}</span>
                      {runStatus ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{runStatus.label}</span>
                      ) : (
                        <span className="text-xs text-zinc-500">Never run</span>
                      )}
                      {lastRun ? (
                        <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {formatDate(lastRun.startedAt)}
                        </span>
                      ) : null}
                    </div>
                    {suite.description ? (
                      <p className="mt-1 max-w-prose text-sm text-zinc-500 dark:text-zinc-400">{suite.description}</p>
                    ) : null}
                    <div className="mt-3">
                      <RunTestsButton copilotId={id} suiteId={suite.id} />
                    </div>
                  </div>

                  {results.length > 0 && lastRun ? (
                    <div className="w-full shrink-0 space-y-3 lg:w-96">
                      <SplitBar segments={segments} />
                      <LinearMeter
                        value={lastRun.passRate}
                        max={1}
                        label="Pass rate"
                        valueText={formatPercent(lastRun.passRate)}
                        tone="accent"
                        ariaLabel={`Pass rate for ${suite.name}`}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 lg:w-96 lg:shrink-0">
                      Never run — expected columns are defined, results pending a first run.
                    </p>
                  )}
                </div>

                <div className="mt-6">
                  <TestCaseTable cases={cases} resultsByCase={resultsByCase} />
                </div>
              </div>
            )
          })}
        </div>
      </AgentSectionCard>
    </div>
  )
}
