import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { BenchmarkComparisonTable } from '@/components/agent-ops/benchmark-comparison-table'
import { BenchmarkScoreCard } from '@/components/agent-ops/benchmark-score-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import {
  MODEL_PROVIDER_LABELS,
  getBenchmarkResultForRun,
  getBenchmarkRunsForSuite,
  getBenchmarkSuitesForCopilot,
  getCopilot,
} from '@/lib/agent-mission-control/mock-data'
import type { BenchmarkResult, BenchmarkRun } from '@/lib/agent-mission-control/types'

type ScoredRow = { run: BenchmarkRun; result: BenchmarkResult }

function scoredRowsForSuite(suiteId: string): ScoredRow[] {
  return getBenchmarkRunsForSuite(suiteId)
    .map((run) => ({ run, result: getBenchmarkResultForRun(run.id) }))
    .filter((row): row is ScoredRow => row.result !== undefined)
    .sort((a, b) => b.result.score - a.result.score)
}

export default async function BenchmarksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const suites = getBenchmarkSuitesForCopilot(id)

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

  const suiteRows = suites.map((suite) => ({ suite, rows: scoredRowsForSuite(suite.id) }))
  const allRows = suiteRows.flatMap(({ rows }) => rows)

  const best =
    allRows.length > 0 ? allRows.reduce((acc, row) => (row.result.score > acc.result.score ? row : acc)) : null
  const viable = allRows.filter((row) => row.result.unsafeActionCount === 0)
  const cheapestViable =
    viable.length > 0
      ? viable.reduce((acc, row) => (row.result.avgCostPerTaskUsd < acc.result.avgCostPerTaskUsd ? row : acc))
      : null

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AgentMetricCard
          label="Best score"
          value={best ? `${best.result.score} / 100` : '—'}
          hint={best ? `${best.run.model} · ${MODEL_PROVIDER_LABELS[best.run.modelProvider]}` : 'No completed benchmark runs'}
        />
        <AgentMetricCard
          label="Cheapest viable candidate"
          value={cheapestViable ? `${formatUsd(cheapestViable.result.avgCostPerTaskUsd)} / task` : '—'}
          hint={
            cheapestViable
              ? `${cheapestViable.run.model} · 0 unsafe actions`
              : 'No candidate without unsafe actions'
          }
        />
        <AgentMetricCard
          label="Runs compared"
          value={String(allRows.length)}
          hint={`Across ${suites.length} ${suites.length === 1 ? 'suite' : 'suites'}`}
        />
      </div>

      {suiteRows.map(({ suite, rows }) => (
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-500">Dimensions</span>
              {suite.dimensions.map((dimension) => (
                <Badge key={dimension} color="zinc" className="font-mono">
                  {dimension}
                </Badge>
              ))}
            </div>
          </AgentSectionCard>

          {rows.length === 0 ? (
            <div className="rounded-xl bg-white px-6 py-5 ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
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
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
