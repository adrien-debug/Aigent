import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { RunTestsButton } from '@/components/agent-ops/run-tests-button'
import { TestCaseTable } from '@/components/agent-ops/test-case-table'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { formatDate, formatPercent } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getTestCasesForSuite,
  getTestResultsForRun,
  getTestRunsForCopilot,
  getTestSuitesForCopilot,
} from '@/lib/agent-mission-control/data'
import type { TestRun, TestSuite } from '@/lib/agent-mission-control/types'
import { BeakerIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

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

  const passRateSeries = testRuns
    .filter((run) => run.status === 'completed')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((run) => run.passRate)

  const latestRun = testRuns.length > 0 ? testRuns.reduce((latest, run) => (run.startedAt > latest.startedAt ? run : latest)) : null

  return (
    <div className="space-y-8">
      <AgentKpiBand
        stats={[
          { name: 'Test Suites', value: String(suites.length) },
          {
            name: 'Latest Pass Rate',
            value: latestRun && latestRun.status === 'completed' ? formatPercent(latestRun.passRate) : '—',
            valueTone: 'accent',
            viz: passRateSeries.length > 1 ? (
              <div className="h-8 w-24">
                <Sparkline points={passRateSeries} ariaLabel="Pass rate trend" />
              </div>
            ) : undefined,
          },
          {
            name: 'Latest Run',
            value: latestRun ? formatDate(latestRun.startedAt) : '—',
            valueSize: 'small',
            hint: latestRun ? runStatusConfig[latestRun.status].label : undefined,
          },
          {
            name: 'Actions',
            content: (
              <div className="flex flex-col justify-center">
                <RunTestsButton copilotId={id} />
              </div>
            ),
          },
        ]}
      />

      {suites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 rounded-2xl border border-white/5 border-dashed bg-white/[0.01]">
          <BeakerIcon className="size-12 text-zinc-700 mb-4" />
          <h3 className="text-sm font-medium text-white">No test suites configured</h3>
          <p className="text-sm text-zinc-500 mt-1">Add test suites to evaluate this copilot&apos;s behavior.</p>
        </div>
      ) : (
        <div className="space-y-12">
          {suites.map(async (suite) => {
            const cases = await getTestCasesForSuite(suite.id)
            const latestRunId = suite.lastRunId
            const run = latestRunId ? runsById.get(latestRunId) : undefined
            const results = run ? await getTestResultsForRun(run.id) : []
            const resultsByCase = Object.fromEntries(results.map((r) => [r.caseId, r]))

            return (
              <div key={suite.id} className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-accent-500/10 ring-1 ring-accent-500/20">
                      <BeakerIcon className="size-4 text-accent-400" />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="text-sm font-semibold text-white">{suite.name}</h3>
                      <span className="text-xs text-zinc-500">{suiteKindConfig[suite.kind].label} &bull; {cases.length} cases</span>
                    </div>
                  </div>
                  {run && (
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <CheckCircleIcon className="size-4 text-accent-400" />
                        <span>{Math.round(run.passRate * run.resultIds.length)} passed</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <XCircleIcon className="size-4 text-accent-400" />
                        <span>{run.resultIds.length - Math.round(run.passRate * run.resultIds.length)} failed</span>
                      </div>
                      <span className="text-zinc-600">|</span>
                      <span className="text-zinc-400">{formatDate(run.startedAt)}</span>
                    </div>
                  )}
                </div>

                <TestCaseTable cases={cases} resultsByCase={resultsByCase} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
