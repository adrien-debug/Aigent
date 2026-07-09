import { notFound } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ReleasePathSteps } from '@/components/agent-ops/release-path-steps'
import { VersionComparisonCard, VersionStageBadge, versionNeverTested } from '@/components/agent-ops/version-comparison-card'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatPercent } from '@/lib/agent-mission-control/format'
import { getCopilot, getVersionsForCopilot } from '@/lib/agent-mission-control/data'
import type { CopilotVersion } from '@/lib/agent-mission-control/types'

export default async function VersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const versions = await getVersionsForCopilot(id)

  const isProduction = (version: CopilotVersion) =>
    copilot.productionVersionId !== null
      ? version.id === copilot.productionVersionId
      : version.stage === 'production'

  // Production first, then newest first (ISO timestamps sort lexicographically).
  const sorted = [...versions].sort((a, b) => {
    const prodDelta = Number(isProduction(b)) - Number(isProduction(a))
    if (prodDelta !== 0) return prodDelta
    return b.createdAt.localeCompare(a.createdAt)
  })

  const productionVersion = sorted.find(isProduction) ?? null

  // Rollback target: the previous production version — the newest archived
  // version created before the one currently serving production. Same
  // semantics as the Publish page. No previous production → no target.
  const rollbackTarget = productionVersion
    ? sorted
        .filter((version) => version.stage === 'archived' && version.createdAt < productionVersion.createdAt)
        .reduce<CopilotVersion | null>(
          (newest, version) => (newest === null || version.createdAt > newest.createdAt ? version : newest),
          null
        )
    : null

  const emptyState = sorted.length === 0 || (sorted.length === 1 && sorted[0].stage === 'draft')

  if (emptyState) {
    return (
      <div className="space-y-8">
        <div className="rounded-xl bg-white px-6 py-12 text-center ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Versions</p>
          <Subheading className="mt-2">Nothing to compare yet</Subheading>
          <Text className="mx-auto mt-2 max-w-md">
            This copilot only has a single draft version. Build a track record — run its test suites and a
            benchmark — before comparing or promoting anything.
          </Text>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button outline href={`/admin/agents/${id}/tests`}>
              Run tests
            </Button>
            <Button plain href={`/admin/agents/${id}/benchmarks`}>
              View benchmarks
            </Button>
          </div>
        </div>

        {sorted.length === 1 ? (
          <section>
            <Subheading>Draft in progress</Subheading>
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <VersionComparisonCard version={sorted[0]} />
            </div>
          </section>
        ) : null}
      </div>
    )
  }

  // Release path candidate: the highest non-production version in flight
  // (beta > draft). No draft/beta candidate → everything shipped, all steps
  // complete.
  const candidateStage = sorted.some((version) => version.stage === 'beta')
    ? ('beta' as const)
    : sorted.some((version) => version.stage === 'draft')
      ? ('draft' as const)
      : ('production' as const)

  return (
    <div className="space-y-8">
      <ReleasePathSteps candidateStage={candidateStage} />

      <AgentSectionCard
        title="Score comparison"
        description="Every version side by side — test pass rate, benchmark score, shadow agreement and unsafe actions."
        contentClassName="px-6 py-4"
      >
        <Table dense bleed className="[--gutter:--spacing(6)]">
          <TableHead>
            <TableRow>
              <TableHeader>Version</TableHeader>
              <TableHeader>Stage</TableHeader>
              <TableHeader className="text-right">Test pass</TableHeader>
              <TableHeader className="text-right">Benchmark</TableHeader>
              <TableHeader className="text-right">Shadow agreement</TableHeader>
              <TableHeader className="text-right">Unsafe</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((version) => (
              <TableRow key={version.id}>
                <TableCell>
                  <span className="font-mono text-xs tabular-nums text-zinc-950 dark:text-white">{version.label}</span>
                </TableCell>
                <TableCell>
                  <VersionStageBadge stage={version.stage} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                  {versionNeverTested(version) ? (
                    <span className="text-zinc-500">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">not measured</span>
                    </span>
                  ) : (
                    formatPercent(version.scores.testPassRate)
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                  {versionNeverTested(version) ? (
                    <span className="text-zinc-500">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">not measured</span>
                    </span>
                  ) : (
                    version.scores.benchmarkScore
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {version.scores.shadowAgreement === null ? (
                    <span className="text-xs text-zinc-500">Never shadowed</span>
                  ) : (
                    <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                      {formatPercent(version.scores.shadowAgreement)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      version.scores.unsafeActionCount === 0
                        ? 'font-mono tabular-nums text-green-700 dark:text-green-400'
                        : 'font-mono tabular-nums text-rose-600 dark:text-rose-400'
                    }
                  >
                    {version.scores.unsafeActionCount}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AgentSectionCard>

      <section>
        <Subheading>All versions</Subheading>
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {sorted.map((version) => (
            <VersionComparisonCard
              key={version.id}
              version={version}
              isProduction={isProduction(version)}
              isRollbackTarget={rollbackTarget !== null && version.id === rollbackTarget.id}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
