import { VersionStageBadge } from '@/components/agent-ops/version-stage-badge'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { formatDate, formatPercent } from '@/lib/agent-mission-control/format'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

// Moved to its own module so pages can use the badge without pulling this card.
export { VersionStageBadge } from '@/components/agent-ops/version-stage-badge'

/**
 * A draft with all-zero test/benchmark scores was never run: render "—"
 * (not measured), never a scary "0.0%". Shared with the versions page so the
 * cards and the score comparison table agree.
 */
export function versionNeverTested(version: CopilotVersion): boolean {
  return version.stage === 'draft' && version.scores.testPassRate === 0 && version.scores.benchmarkScore === 0
}

function NotMeasured() {
  return (
    <span className="text-zinc-500">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not measured</span>
    </span>
  )
}

function ScoreCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}

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
    <article className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 dark:border-white/5 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-mono text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">{version.label}</h3>
          <VersionStageBadge stage={version.stage} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Created <time dateTime={version.createdAt}>{formatDate(version.createdAt)}</time> by {version.createdBy}
          {' · '}
          <span className="font-mono tabular-nums">{version.model}</span>
        </p>
      </div>

      <div className="flex flex-1 flex-col px-6 py-5">
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{version.changelog}</p>

        <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <ScoreCell label="Test pass">
            {neverTested ? (
              <NotMeasured />
            ) : (
              <span className="font-mono tabular-nums text-zinc-950 dark:text-white">{formatPercent(scores.testPassRate)}</span>
            )}
          </ScoreCell>
          <ScoreCell label="Benchmark">
            {neverTested ? (
              <NotMeasured />
            ) : (
              <>
                <span className="font-mono tabular-nums text-zinc-950 dark:text-white">{scores.benchmarkScore}</span>
                <span className="text-xs text-zinc-500"> / 100</span>
              </>
            )}
          </ScoreCell>
          <ScoreCell label="Shadow agreement">
            {scores.shadowAgreement === null ? (
              <span className="text-zinc-500">Never shadowed</span>
            ) : (
              <span className="font-mono tabular-nums text-zinc-950 dark:text-white">{formatPercent(scores.shadowAgreement)}</span>
            )}
          </ScoreCell>
          <ScoreCell label="Unsafe actions">
            {scores.unsafeActionCount === 0 ? (
              <>
                <span className="font-mono tabular-nums text-accent-700 dark:text-accent-400">0</span>
                <span className="text-xs text-zinc-500"> · none</span>
              </>
            ) : (
              <>
                <span className="font-mono tabular-nums text-accent-600 dark:text-accent-400">{scores.unsafeActionCount}</span>
                <span className="text-xs text-accent-600 dark:text-accent-400"> · flagged</span>
              </>
            )}
          </ScoreCell>
        </dl>
      </div>

      {/* Twin-card skeleton: every footer is the same fixed-min-height row —
          chip zone left, actions zone right — so footers align across the grid
          even when a card (production) has no actions. */}
      <footer className="flex min-h-17 flex-wrap items-center justify-between gap-3 border-t border-zinc-950/5 dark:border-white/5 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {isProduction ? (
            <Badge color="accent">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-400" />
              Serving production
            </Badge>
          ) : isRollbackTarget ? (
            <Badge color="accentStrong">Rollback target</Badge>
          ) : null}
        </div>
        {!isProduction ? (
          <div className="flex flex-wrap items-center gap-3">
            {!isRollbackTarget ? (
              <Button plain disabled title="Rollback targeting ships in V2">
                Set as rollback target
              </Button>
            ) : null}
            <Button outline href={publishHref}>
              Promote&hellip;
            </Button>
          </div>
        ) : null}
      </footer>
    </article>
  )
}
