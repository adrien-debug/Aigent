import { notFound } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunTestsButton } from '@/components/agent-ops/run-tests-button'
import { TestCaseTable } from '@/components/agent-ops/test-case-table'
import { TestResultBadge } from '@/components/agent-ops/test-result-badge'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { formatPercent } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getTestCasesForSuite,
  getTestResultsForRun,
  getTestRunsForCopilot,
  getTestSuitesForCopilot,
} from '@/lib/agent-mission-control/data'
import type { TestResult, TestResultStatus, TestRun, TestSuite } from '@/lib/agent-mission-control/types'

const suiteKindConfig: Record<TestSuite['kind'], { label: string; color: 'zinc' | 'amber' }> = {
  behavior: { label: 'Behavior', color: 'zinc' },
  safety: { label: 'Safety', color: 'amber' },
  regression: { label: 'Regression', color: 'zinc' },
  'output-contract': { label: 'Output contract', color: 'zinc' },
}

const runStatusConfig: Record<TestRun['status'], { label: string; color: 'green' | 'blue' | 'zinc' | 'rose' }> = {
  completed: { label: 'Completed', color: 'green' },
  running: { label: 'Running', color: 'blue' },
  queued: { label: 'Queued', color: 'zinc' },
  aborted: { label: 'Aborted', color: 'rose' },
}

export default async function CopilotTestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const [suites, testRuns] = await Promise.all([getTestSuitesForCopilot(id), getTestRunsForCopilot(id)])
  const runsById = new Map(testRuns.map((run) => [run.id, run]))

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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Subheading>Test suites</Subheading>
        <div className="flex flex-wrap items-center gap-3">
          <RunTestsButton />
          {/* V1 stub — visibly inert until suite-scoped runs ship. */}
          <Button outline disabled title="Suite-scoped runs ship in V2">
            Run safety suite only
          </Button>
        </div>
      </div>

      {suiteViews.map(({ suite, lastRun, results, resultsByCase, counts, cases }) => {
        const kind = suiteKindConfig[suite.kind]
        const runStatus = lastRun ? runStatusConfig[lastRun.status] : null

        const totalStatuses: TestResultStatus[] = ['pass', 'fail', 'skip']
        if (counts.error > 0) totalStatuses.splice(2, 0, 'error')

        return (
          <AgentSectionCard
            key={suite.id}
            title={suite.name}
            description={suite.description}
            actions={
              <>
                <Badge color={kind.color}>{kind.label}</Badge>
                {lastRun && runStatus ? (
                  <>
                    <Badge color={runStatus.color}>{runStatus.label}</Badge>
                    <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatPercent(lastRun.passRate)} pass
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-500">Never run</span>
                )}
              </>
            }
          >
            <div className="space-y-4">
              {results.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  {totalStatuses.map((status) => (
                    <div key={status} className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium tabular-nums text-zinc-950 dark:text-white">{counts[status]}</span>
                      <TestResultBadge result={status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  This suite has never been run — expected columns are defined, results are pending a first run.
                </p>
              )}

              <TestCaseTable cases={cases} resultsByCase={resultsByCase} />
            </div>
          </AgentSectionCard>
        )
      })}
    </div>
  )
}
