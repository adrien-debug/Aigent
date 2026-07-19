
import clsx from 'clsx'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard, surfaceSectionClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { ReplayCandidatePicker, type ReplayCandidateItem } from '@/components/agent-ops/replay-candidate-picker'
import { ChipCluster } from '@/components/agent-ops/widgets/chip-cluster'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { SplitBar, type SplitSegment } from '@/components/agent-ops/widgets/split-bar'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getReplayComparisonsForCopilot,
  getVersion,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'
import { REPLAY_OUTCOME_LABELS } from '@/lib/agent-mission-control/labels'
import type { ReplayCandidate, ReplayComparison } from '@/lib/agent-mission-control/types'

const statusConfig: Record<ReplayComparison['status'], { label: string; color: 'zinc' | 'accent' | 'accentStrong' }> = {
  draft: { label: 'Draft', color: 'zinc' },
  ready: { label: 'Ready', color: 'zinc' },
  matched: { label: 'Matched', color: 'accent' },
  diverged: { label: 'Diverged', color: 'accentStrong' },
}

const OUTCOME_MIX: { key: ReplayCandidate['outcome']; label: string; tone: SplitSegment['tone'] }[] = [
  { key: 'matched', label: REPLAY_OUTCOME_LABELS.matched, tone: 'accent-400' },
  { key: 'improved', label: REPLAY_OUTCOME_LABELS.improved, tone: 'accent-500' },
  { key: 'diverged', label: REPLAY_OUTCOME_LABELS.diverged, tone: 'accent-600' },
  { key: 'unsafe', label: REPLAY_OUTCOME_LABELS.unsafe, tone: 'accent-700' },
  { key: 'pending', label: REPLAY_OUTCOME_LABELS.pending, tone: 'zinc' },
]

export async function ReplaySection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

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

  // Outcome mix → dense split bar under the divergences KPI.
  const outcomeSegments: SplitSegment[] = OUTCOME_MIX.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: allCandidates.filter((candidate) => candidate.outcome === bucket.key).length,
    tone: bucket.tone,
  }))

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
            viz:
              bestMatchRate !== null ? (
                <LinearMeter value={bestMatchRate} ariaLabel="Best candidate match rate" />
              ) : undefined,
          },
          {
            name: 'Divergences',
            value: String(divergedCount),
            changeType: divergedCount > 0 ? 'negative' : undefined,
            hint: divergedCount > 0 ? 'Behaviour differs from production' : 'All candidates aligned',
            viz: allCandidates.length > 0 ? <SplitBar segments={outcomeSegments} showLegend={false} /> : undefined,
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
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
            <p className="mt-1.5 text-xs text-zinc-500">Replay queueing ships in V2.</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Replays execute in a sandboxed runtime — tool calls with side effects are stubbed, production traffic is
          never touched.
        </p>
      </AgentSectionCard>

      {comparisons.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01]">
          <EmptyState
            title="No replays yet"
            description="Replay a production run to compare behavior before promoting. Candidates run against the recorded transcript — never against live users."
            action={
              <Button outline href={`/admin/agents/${id}/runs`}>
                Browse production runs
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-8">
          {comparisonItems.map(({ comparison, items }) => {
            const status = statusConfig[comparison.status]

            return (
              <section
                key={comparison.id}
                className={clsx('overflow-hidden', surfaceSectionClass)}
              >
                <h3 className="sr-only">Replay of run {comparison.sourceRunId}</h3>
                <div className={clsx(surfaceCardHeaderClass, 'flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4')}>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                    <Link
                      href={`/admin/agents/${id}/runs?run=${comparison.sourceRunId}`}
                      className="font-mono text-sm text-zinc-950 underline decoration-zinc-950/30 hover:decoration-zinc-950 dark:text-white dark:decoration-white/30 dark:hover:decoration-white"
                    >
                      {comparison.sourceRunId}
                    </Link>
                    <ChipCluster
                      items={[
                        { key: 'replayed', text: `Replayed ${formatTimestamp(comparison.createdAt)}` },
                        { key: 'cases', text: `${comparison.caseCount} case${comparison.caseCount === 1 ? '' : 's'}` },
                      ]}
                    />
                  </div>
                  <Badge color={status.color}>{status.label}</Badge>
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
