import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentSectionCard, surfaceCardClass } from '@/components/agent-ops/surface-card'
import { BenchmarkComparisonTable } from '@/components/agent-ops/benchmark-comparison-table'
import { BenchmarkRunSteps } from '@/components/agent-ops/benchmark-run-steps'
import { BenchmarkScoreCard } from '@/components/agent-ops/benchmark-score-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunBenchmarkButton } from '@/components/agent-ops/run-benchmark-button'
import { ChipCluster } from '@/components/agent-ops/widgets/chip-cluster'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import {
  getBenchmarkResultForRun,
  getBenchmarkRunsForSuite,
  getBenchmarkSuitesForCopilot,
  getCopilot,
} from '@/lib/agent-mission-control/data'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

type ScoredRow = { run: BenchmarkRun; result: BenchmarkResult }

async function scoreRuns(runs: BenchmarkRun[]): Promise<ScoredRow[]> {
  const rows = await Promise.all(runs.map(async (run) => ({ run, result: await getBenchmarkResultForRun(run.id) })))
  return rows
    .filter((row): row is ScoredRow => row.result !== undefined)
    .sort((a, b) => b.result.score - a.result.score)
}

export async function BenchmarksSection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

  const suites = await getBenchmarkSuitesForCopilot(id)

  if (suites.length === 0) {
    return (
      <AgentBentoCard
        eyebrow="Benchmarks"
        title="No benchmark suites yet"
        description="Benchmark suites compare candidate models on accuracy, task success, latency, cost and safety before a version reaches the promotion gate. Create a suite to start ranking candidates."
      >
        <div className="space-y-3">
          {/* V1 stub — visibly inert, never a dead '#' link. */}
          <Button disabled title="Suite authoring ships in V2">
            Create benchmark suite
          </Button>
          <p className="text-xs text-zinc-500">Benchmark suite authoring ships in V2 — disabled until then.</p>
        </div>
      </AgentBentoCard>
    )
  }

  const suiteRows = await Promise.all(
    suites.map(async (suite) => {
      const runs = await getBenchmarkRunsForSuite(suite.id)
      return { suite, runs, rows: await scoreRuns(runs) }
    })
  )

  return (
    <div className="space-y-8">
      {suiteRows.map(({ suite, runs, rows }) => (
        <section key={suite.id} aria-label={suite.name} className="space-y-6">
          <AgentSectionCard
            title={suite.name}
            description={suite.description}
            actions={
              <div className="flex flex-col items-end gap-3">
                <span className="text-xs text-zinc-500">
                  <span className="font-mono font-medium text-zinc-700 tabular-nums dark:text-zinc-300">{suite.taskCount}</span> tasks
                </span>
                <RunBenchmarkButton copilotId={id} suiteId={suite.id} />
              </div>
            }
            contentClassName="px-6 py-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <ChipCluster
                label="Dimensions"
                items={suite.dimensions.map((dimension) => ({ key: dimension, text: dimension }))}
              />
              <div className="flex items-center gap-6">
                {rows.length > 0 ? (
                  <Sparkline
                    kind="bar"
                    points={rows.map((row) => row.result.score)}
                    tone="accent"
                    width={88}
                    height={28}
                    ariaLabel="Composite score spread across candidates"
                  />
                ) : null}
                <BenchmarkRunSteps runs={runs} />
              </div>
            </div>
          </AgentSectionCard>

          {rows.length === 0 ? (
            <div className={surfaceCardClass}>
              <EmptyState
                title="No completed benchmark runs yet"
                description="Run this suite against a candidate model to start ranking results."
              />
            </div>
          ) : (
            <>
              <div>
                <Subheading level={3}>Best candidate</Subheading>
                <Text className="mt-1">
                  {rows.length > 3
                    ? `Top 3 of ${rows.length} candidates by composite score. The winner is flagged.`
                    : 'Candidates ranked by composite score. The winner is flagged.'}
                </Text>
                {/* auto-fit: 2 candidates fill the row (no empty grid cell); slice(0, 3) caps at 3 per row. */}
                <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                  {rows.slice(0, 3).map((row, index) => (
                    <BenchmarkScoreCard key={row.run.id} run={row.run} result={row.result} isBest={index === 0} />
                  ))}
                </div>
              </div>

              <AgentSectionCard
                title="Model comparison"
                description="Every completed run in this suite, ranked by composite score."
                contentClassName="px-6 py-4"
              >
                <BenchmarkComparisonTable rows={rows} />
              </AgentSectionCard>
            </>
          )}
        </section>
      ))}
    </div>
  )
}
