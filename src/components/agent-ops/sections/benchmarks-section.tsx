
import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { BenchmarkComparisonTable } from '@/components/agent-ops/benchmark-comparison-table'
import { BenchmarkRunSteps } from '@/components/agent-ops/benchmark-run-steps'
import { BenchmarkScoreCard } from '@/components/agent-ops/benchmark-score-card'
import { BenchmarkScoreChart } from '@/components/agent-ops/benchmark-score-chart'
import { Badge } from '@/components/catalyst/badge'
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
              <span className="text-xs text-zinc-500">
                <span className="font-mono font-medium text-zinc-700 tabular-nums dark:text-zinc-300">{suite.taskCount}</span> tasks
              </span>
            }
            contentClassName="px-6 py-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-500">Dimensions</span>
                {suite.dimensions.map((dimension) => (
                  <Badge key={dimension} color="zinc" className="font-mono">
                    {dimension}
                  </Badge>
                ))}
              </div>
              <BenchmarkRunSteps runs={runs} />
            </div>
          </AgentSectionCard>

          {rows.length === 0 ? (
            <div className="rounded-xl bg-white px-6 py-5 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
              <Text>No completed benchmark runs for this suite yet.</Text>
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

              <AgentSectionCard title="Score comparison" description="Composite score by candidate.">
                {/* Serializable plain objects only — this crosses the server → client boundary. */}
                <BenchmarkScoreChart
                  data={rows.map((row, index) => ({
                    model: row.run.model,
                    score: row.result.score,
                    accuracy: row.result.accuracy,
                    costPerTask: row.result.avgCostPerTaskUsd,
                    unsafe: row.result.unsafeActionCount,
                    isBest: index === 0,
                  }))}
                />
              </AgentSectionCard>

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
