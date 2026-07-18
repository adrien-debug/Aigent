import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'
import { Button } from '@/components/catalyst/button'
import { formatDate, formatPercent } from '@/lib/agent-mission-control/format'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

/**
 * A version with no run-backed evidence renders a muted "Not measured yet" line
 * (never a scary "0.0%" or an empty gauge). Uses `scoresEvidence` set by the
 * data layer from real runs — so a genuinely-tested version that scores 0% is
 * shown as 0% (real), and only a truly un-run version reads "not measured".
 * Falls back to the legacy zero-blob heuristic when evidence is absent (e.g. a
 * version object not sourced from the enriched getter). Shared with the versions
 * page so the cards and the score comparison table agree.
 */
export function versionNeverTested(version: CopilotVersion): boolean {
  if (version.scoresEvidence) return version.scoresEvidence === 'none'
  return version.stage === 'draft' && version.scores.testPassRate === 0 && version.scores.benchmarkScore === 0
}

/**
 * Version card — carries IDENTITY (label, stage, model, author, changelog) plus
 * the decision-critical quality/safety signal as live gauges: a benchmark
 * RadialMeter hero, a test-pass LinearMeter and an unsafe-actions chip. The
 * four-way cross-version comparison lives ONLY in the score table (no
 * duplication). Server-safe.
 */
export function VersionComparisonCard({
  version,
  isProduction,
  isRollbackTarget,
}: {
  version: CopilotVersion
  isProduction?: boolean
  isRollbackTarget?: boolean
}) {
  const { scores } = version
  const publishHref = `/admin/agents/${version.copilotId}/versions#publish`
  const neverTested = versionNeverTested(version)

  return (
    <AgentSectionCard
      className="flex h-full flex-col"
      title={version.label}
      description={`${versionStageLabels[version.stage]} · Created ${formatDate(version.createdAt)} by ${version.createdBy} · ${version.model}`}
      contentClassName="flex flex-1 flex-col px-6 py-5"
    >
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{version.changelog}</p>

      {neverTested ? (
        <p className="mt-auto border-t border-zinc-950/5 pt-4 text-sm text-zinc-500 dark:border-white/5">
          Not measured yet — run its tests and a benchmark to compare.
        </p>
      ) : (
        <div className="mt-auto flex items-center gap-6 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <RadialMeter
            value={scores.benchmarkScore}
            max={100}
            size={72}
            strokeWidth={6}
            centerText={String(scores.benchmarkScore)}
            caption="benchmark"
            ariaLabel={`Benchmark score for ${version.label}`}
          />
          <div className="flex-1 space-y-3">
            <LinearMeter
              size="xs"
              value={scores.testPassRate}
              max={1}
              label="Test pass"
              valueText={formatPercent(scores.testPassRate)}
              ariaLabel={`Test pass rate for ${version.label}`}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Unsafe actions</span>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {scores.unsafeActionCount === 0 ? '0 unsafe' : `${scores.unsafeActionCount} flagged`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Twin-card skeleton: every footer is the same fixed-min-height row —
          label zone left, action right — so footers align across the grid even
          when a card (production) has no action. mt-auto (via the parent's
          flex-1 flex-col) pins it to the bottom regardless of body height. */}
      <footer className="mt-6 flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-zinc-950/5 pt-4 dark:border-white/5">
        <div className="flex flex-wrap items-center gap-3">
          {isProduction ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Serving production</span>
          ) : isRollbackTarget ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Rollback target</span>
          ) : null}
        </div>
        {!isProduction ? (
          <Button outline href={publishHref} aria-label={`Promote ${version.label}…`}>
            Promote&hellip;
          </Button>
        ) : null}
      </footer>
    </AgentSectionCard>
  )
}
