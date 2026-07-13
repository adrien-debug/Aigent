import { notFound } from 'next/navigation'

import { ImproveWorkbench } from '@/components/agent-ops/improve-workbench'
import { getCopilot, getVersionsForCopilot } from '@/lib/agent-mission-control/data'
import { nextRecommendedAction } from '@/lib/agent-mission-control/improvement-diagnosis'
import {
  collectImprovementSignals,
  compareImprovementVersions,
  diagnoseSignals,
  getLatestProposalForCopilot,
  type VersionComparison,
} from '@/lib/agent-mission-control/improvement-loop'

/**
 * Improve tab — the Agent Improvement Loop surface. Server component: loads
 * the copilot, its latest proposal (the current cycle), the DB-only signal
 * summary (failing cases, benchmark scores — no network edges on render) and,
 * once a V2 draft exists, the live V1-vs-V2 comparison recomputed from
 * test_runs/benchmark_runs. All mutations go through the improve API routes.
 */
export default async function ImprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const [versions, proposal] = await Promise.all([getVersionsForCopilot(id), getLatestProposalForCopilot(id)])
  // Pin the signal summary to the OPEN cycle's base version: after V2 creation
  // `latest_version_id` is the V2, so the default resolution would describe the
  // wrong version as "base".
  const signals = await collectImprovementSignals(id, {
    includeObservability: false,
    baseVersionId: proposal?.baseVersionId,
  })

  const baseVersion = versions.find((v) => v.id === (proposal?.baseVersionId ?? signals.baseVersion.id)) ?? null
  const v2Version = proposal?.v2VersionId ? (versions.find((v) => v.id === proposal.v2VersionId) ?? null) : null

  let comparison: VersionComparison | null = null
  if (proposal?.v2VersionId) {
    comparison = await compareImprovementVersions(id, proposal.baseVersionId, proposal.v2VersionId)
  }

  // Deterministic diagnoses — recomputed live on every render (pure, no I/O),
  // so even a cycle persisted before the diagnosis engine gets classified.
  const diagnoses = diagnoseSignals(signals)
  const nextAction = nextRecommendedAction(diagnoses)

  return (
    <ImproveWorkbench
      copilotId={id}
      copilotName={copilot.name}
      baseVersion={{
        id: signals.baseVersion.id,
        label: baseVersion?.label ?? signals.baseVersion.label,
        stage: baseVersion?.stage ?? signals.baseVersion.stage,
      }}
      v2Version={v2Version ? { id: v2Version.id, label: v2Version.label, stage: v2Version.stage } : null}
      proposal={proposal}
      suites={signals.suites}
      benchmarks={signals.benchmarks}
      comparison={comparison}
      diagnoses={diagnoses}
      nextAction={nextAction}
    />
  )
}
