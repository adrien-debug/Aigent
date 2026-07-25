import { getAgentLifecycle, type AgentLifecycle } from '@/lib/agent-mission-control/agent-lifecycle'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { evaluatePromotionGate, type PromotionGateResult } from '@/lib/agent-mission-control/promotion-gate'
import {
  computeReadiness,
  getLatestQualificationRun,
  type QualificationReadiness,
} from '@/lib/agent-mission-control/qualification-orchestrator'

export interface ShadowEvidenceData {
  status: string
  candidateVerdict: string | null
  wouldMutateCount: number
  sampledRunCount: number
  /** 'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown' — provenance the
   *  promotion gate keys off (a fixture can't satisfy a required check). */
  executionMode: string
}

export interface ReplayEvidenceData {
  verdict: string | null
  caseCount: number
  divergent: Array<{ comparison: string; note: string }>
  executionMode: string
}

export interface AgentReleasePageData {
  lifecycle: AgentLifecycle
  promotionGate: PromotionGateResult | null
  qualificationReadiness: QualificationReadiness
  candidateVersionIdForEvidence: string | null
  shadow: ShadowEvidenceData | null
  replay: ReplayEvidenceData | null
}

/**
 * `/admin/agents/[id]/release` data-fetch, extracted so `page.tsx` stays a
 * pure `data + <View />` shell (see `scripts/check-views.mjs`). Every read
 * here is the SAME source of truth the view and the promotion route already
 * agree on (`getAgentLifecycle`'s `evaluateReleaseGate`, `evaluatePromotionGate`,
 * the qualification orchestrator) — this module recomputes nothing, it only
 * fetches and shapes for the view.
 */
export async function getAgentReleasePageData(copilotId: string): Promise<AgentReleasePageData | undefined> {
  const lifecycle = await getAgentLifecycle(copilotId)
  if (!lifecycle) return undefined

  const { gate, candidateVersion } = lifecycle

  // Promotion evidence — the extended gate `evaluatePromotionGate` already
  // computes for the promotion route. Read-only, same source of truth as
  // "Promote or roll back"; never a second gate that could disagree.
  const candidateVersionIdForEvidence = gate?.candidateVersionId ?? candidateVersion?.id ?? null
  const promotionGate = candidateVersionIdForEvidence
    ? await evaluatePromotionGate(lifecycle.copilotId, candidateVersionIdForEvidence).catch(() => null)
    : null

  // Qualification workflow state — the ordered walk (tests → benchmark → shadow →
  // replay → gate) + the recommended next action. Read-only, from the same
  // orchestrator the product API drives; the page never runs the workflow.
  const qualificationRun = candidateVersionIdForEvidence
    ? await getLatestQualificationRun(lifecycle.copilotId, candidateVersionIdForEvidence).catch(() => null)
    : null
  const qualificationReadiness = computeReadiness(qualificationRun)

  const shadowRows = candidateVersionIdForEvidence
    ? await pgrest<Record<string, unknown>[]>(
        'GET',
        `shadow_experiments?copilot_id=eq.${encodeURIComponent(lifecycle.copilotId)}&candidate_version_id=eq.${encodeURIComponent(candidateVersionIdForEvidence)}&select=status,candidate_verdict,would_mutate_count,sampled_run_count,execution_mode&order=started_at.desc&limit=1`,
      ).catch(() => [])
    : []
  const shadowRow = shadowRows[0] ?? null
  const shadow: ShadowEvidenceData | null = shadowRow
    ? {
        status: shadowRow.status as string,
        candidateVerdict: (shadowRow.candidate_verdict as string | null) ?? null,
        wouldMutateCount: shadowRow.would_mutate_count as number,
        sampledRunCount: shadowRow.sampled_run_count as number,
        // Never defaulted to a passing/live value — an absent column reads as
        // legacy_unknown (unproven), exactly like the gate treats it.
        executionMode: (shadowRow.execution_mode as string | undefined) ?? 'legacy_unknown',
      }
    : null

  const replayRows = candidateVersionIdForEvidence
    ? await pgrest<Record<string, unknown>[]>(
        'GET',
        `replay_comparisons?copilot_id=eq.${encodeURIComponent(lifecycle.copilotId)}&select=verdict,case_count,candidates,execution_mode&order=created_at.desc&limit=1`,
      ).catch(() => [])
    : []
  const replayRow = replayRows[0] ?? null
  const replay: ReplayEvidenceData | null = replayRow
    ? {
        verdict: (replayRow.verdict as string | null) ?? null,
        caseCount: replayRow.case_count as number,
        divergent: ((replayRow.candidates as Array<{ comparison: string; note: string }>) ?? []).filter(
          (c) => c.comparison === 'worse' || c.comparison === 'nondeterministic',
        ),
        executionMode: (replayRow.execution_mode as string | undefined) ?? 'legacy_unknown',
      }
    : null

  return {
    lifecycle,
    promotionGate,
    qualificationReadiness,
    candidateVersionIdForEvidence,
    shadow,
    replay,
  }
}
