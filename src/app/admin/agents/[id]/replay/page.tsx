import { notFound } from 'next/navigation'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ReplayCandidatePicker, type ReplayCandidateItem } from '@/components/agent-ops/replay-candidate-picker'
import { ReplayProgressDots } from '@/components/agent-ops/replay-progress-dots'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Subheading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { Text } from '@/components/catalyst/text'
import { formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getReplayComparisonsForCopilot,
  getVersion,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'
import type { ReplayComparison } from '@/lib/agent-mission-control/types'

const statusConfig: Record<ReplayComparison['status'], { label: string; color: 'zinc' | 'accent' | 'accentStrong' }> = {
  draft: { label: 'Draft', color: 'zinc' },
  ready: { label: 'Ready', color: 'zinc' },
  matched: { label: 'Matched', color: 'accent' },
  diverged: { label: 'Diverged', color: 'accentStrong' },
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const [comparisons, versions] = await Promise.all([
    getReplayComparisonsForCopilot(id),
    getVersionsForCopilot(id),
  ])
  const comparisonItems = await Promise.all(
    comparisons.map(async (comparison) => ({
      comparison,
      items: await Promise.all(
        comparison.candidates.map(
          async (candidate): Promise<ReplayCandidateItem> => ({
            candidate,
            versionLabel: (await getVersion(candidate.versionId))?.label ?? candidate.versionId,
          })
        )
      ),
    }))
  )
  const models = Array.from(
    new Set([
      copilot.model,
      ...versions.map((version) => version.model),
      ...comparisons.flatMap((comparison) => comparison.candidates.map((candidate) => candidate.model)),
    ])
  ).sort()

  // KPI aggregates across every replay comparison for this copilot.
  const allCandidates = comparisons.flatMap((comparison) => comparison.candidates)
  const matchRates = allCandidates
    .map((candidate) => candidate.matchRate)
    .filter((rate): rate is number => rate !== null)
  const bestMatchRate = matchRates.length > 0 ? Math.max(...matchRates) : null
  const divergedCount = allCandidates.filter(
    (candidate) => candidate.outcome === 'diverged' || candidate.outcome === 'unsafe'
  ).length
  const unsafeCount = allCandidates.filter((candidate) => candidate.outcome === 'unsafe').length

  return (
    <div className="space-y-8">
      <AgentKpiBand
        stats={[
          {
            name: 'Replays',
            value: String(comparisons.length),
            hint:
              comparisons.length > 0
                ? `${allCandidates.length} candidate${allCandidates.length === 1 ? '' : 's'} compared`
                : 'No replays yet',
          },
          {
            name: 'Best match rate',
            value: bestMatchRate !== null ? formatPercent(bestMatchRate) : '—',
            hint: bestMatchRate !== null ? 'Closest candidate to production' : 'No completed replays',
          },
          {
            name: 'Divergences',
            value: String(divergedCount),
            changeType: divergedCount > 0 ? 'negative' : undefined,
            hint: divergedCount > 0 ? 'Behaviour differs from production' : 'All candidates aligned',
          },
          {
            name: 'Unsafe proposals',
            value: String(unsafeCount),
            changeType: unsafeCount > 0 ? 'negative' : undefined,
            hint: unsafeCount > 0 ? 'Blocks promotion' : 'None flagged',
          },
        ]}
      />

      <AgentSectionCard
        title="Replay lab"
        description="Re-run historical production runs against candidate versions and models — no live side effects."
      >
        <p className="text-sm font-medium text-zinc-950 dark:text-white">Compare versions &amp; models</p>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:max-w-xl">
            <Field>
              <Label>Candidate version</Label>
              <Select name="replay-version" defaultValue={copilot.latestVersionId}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label} · {version.stage}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Model</Label>
              <Select name="replay-model" defaultValue={copilot.model}>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="shrink-0">
            <Button type="button" outline disabled title="Replay queueing ships in V2">
              Queue replay
            </Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Replays execute in a sandboxed runtime — tool calls with side effects are stubbed, production traffic is
          never touched.
        </p>
      </AgentSectionCard>

      {comparisons.length === 0 ? (
        <section className="rounded-xl bg-white px-6 py-12 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
          <div className="mx-auto max-w-md text-center">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Replay lab</p>
            <Subheading level={3} className="mt-2">
              No replays yet
            </Subheading>
            <Text className="mt-2">
              Replay a production run to compare behavior before promoting. Candidates run against the recorded
              transcript — never against live users.
            </Text>
            <div className="mt-6">
              <Button outline href={`/admin/agents/${id}/runs`}>
                Browse production runs
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-8">
          {comparisonItems.map(({ comparison, items }) => {
            const status = statusConfig[comparison.status]

            return (
              <section key={comparison.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
                <h3 className="sr-only">Replay of run {comparison.sourceRunId}</h3>
                <div className="border-b border-zinc-950/5 dark:border-white/5 px-6 py-4">
                  <div className="sm:flex sm:items-start sm:justify-between sm:gap-6">
                    <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Source run</dt>
                        <dd className="mt-1">
                          <Link
                            href={`/admin/agents/${id}/runs?run=${comparison.sourceRunId}`}
                            className="font-mono text-sm text-zinc-950 underline decoration-zinc-950/30 hover:decoration-zinc-950 dark:text-white dark:decoration-white/30 dark:hover:decoration-white"
                          >
                            {comparison.sourceRunId}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Replayed</dt>
                        <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{formatTimestamp(comparison.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Cases</dt>
                        <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{comparison.caseCount}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 sm:mt-0">
                      <ReplayProgressDots status={comparison.status} />
                      <Badge color={status.color}>{status.label}</Badge>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-5">
                  <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Candidates</p>
                  <div className="mt-3">
                    <ReplayCandidatePicker items={items} />
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
