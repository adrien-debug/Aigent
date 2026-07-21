import { ArrowUpCircleIcon } from '@heroicons/react/24/outline'

import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { GateHistoryFeed, type GateHistoryEvent } from '@/components/agent-ops/gate-history-feed'
import { ReleaseCandidateCard } from '@/components/agent-ops/release-candidate-card'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { Button } from '@/components/catalyst/button'
import { getCopilot, getVersionsForCopilot } from '@/lib/agent-mission-control/data'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import { evaluateReleaseGate } from '@/lib/agent-mission-control/release-gate'

/**
 * Release / Publish surface.
 *
 * SINGLE gate, SINGLE Promote button. The card is driven entirely by
 * `evaluateReleaseGate` — every check is recomputed live from the candidate's
 * real test run, benchmark and tool policy, and the promotion route re-checks
 * the same gate server-side before writing (fail-closed). There is no legacy
 * `promotion_gates` surface here anymore: no second gate card, no duplicate
 * pipeline stepper, no competing Promote/rollback buttons.
 */
export async function PublishSection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

  const [releaseGate, allVersions] = await Promise.all([
    evaluateReleaseGate(id),
    getVersionsForCopilot(id),
  ])

  // No candidate distinct from the version currently in production → nothing to
  // promote. Show an honest empty state pointing at the Improve loop.
  if (!releaseGate || releaseGate.candidateVersionId === copilot.productionVersionId) {
    return (
      <EmptyStatePanel
        icon={ArrowUpCircleIcon}
        title="No release candidate."
        description="Run an improvement cycle to produce a candidate version, then its release gate appears here."
        action={
          <Button outline href={`/admin/agents/${id}/improve`}>
            Go to Improve
          </Button>
        }
      />
    )
  }

  const { evidence } = releaseGate
  const candidateVersion = allVersions.find((v) => v.id === releaseGate.candidateVersionId)
  const productionVersion = evidence.currentProductionVersionId
    ? allVersions.find((v) => v.id === evidence.currentProductionVersionId)
    : undefined
  const currentProductionLabel = productionVersion?.label ?? evidence.currentProductionVersionId ?? null

  // Rollback target: the previous production version — the newest archived
  // version created before the one currently serving production. Same semantics
  // as the Versions page. No previous production → no rollback affordance.
  const rollbackVersion = productionVersion
    ? allVersions
        .filter((v) => v.stage === 'archived' && v.createdAt < productionVersion.createdAt)
        .reduce<(typeof allVersions)[number] | null>(
          (newest, v) => (newest === null || v.createdAt > newest.createdAt ? v : newest),
          null
        )
    : null

  // History feed built from LIVE data only — the gate evaluation, when the
  // candidate version entered, and the version currently serving production.
  const passedChecks = releaseGate.checks.filter((check) => check.status === 'pass').length
  const historyEvents: GateHistoryEvent[] = [
    {
      id: 'evaluated',
      kind: 'evaluated',
      content: `Gate evaluated — ${passedChecks} of ${releaseGate.checks.length} checks passing, status`,
      target: releaseGate.promotable ? 'ready' : 'blocked',
      date: formatTimestamp(releaseGate.evaluatedAt),
      datetime: releaseGate.evaluatedAt,
    },
  ]
  if (candidateVersion) {
    historyEvents.push({
      id: 'candidate-entered',
      kind: 'entered',
      content: `Candidate created by ${candidateVersion.createdBy} entered the gate —`,
      target: candidateVersion.label,
      date: formatTimestamp(candidateVersion.createdAt),
      datetime: candidateVersion.createdAt,
    })
  }
  if (productionVersion) {
    historyEvents.push({
      id: 'last-promotion',
      kind: 'promoted',
      content: 'Promoted to production, currently serving traffic —',
      target: productionVersion.label,
      date: formatTimestamp(productionVersion.createdAt),
      datetime: productionVersion.createdAt,
    })
  }

  return (
    <div className="space-y-8">
      <ReleaseCandidateCard
        copilotId={id}
        checks={releaseGate.checks}
        promotable={releaseGate.promotable}
        evidence={evidence}
        currentProductionLabel={currentProductionLabel}
        rollbackVersionId={rollbackVersion?.id ?? null}
        rollbackVersionLabel={rollbackVersion?.label ?? null}
      />

      <AgentSectionCard title="History" description="Recent gate activity for this candidate.">
        <GateHistoryFeed events={historyEvents} />
      </AgentSectionCard>
    </div>
  )
}
