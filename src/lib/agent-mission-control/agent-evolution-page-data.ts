import type { EvolutionSuiteRef } from '@/components/agent-ops/agent-detail/evolution-workbench'
import { getAgentLifecycle, type AgentLifecycle } from '@/lib/agent-mission-control/agent-lifecycle'
import { getBenchmarkSuitesForCopilot, getTestSuitesForCopilot } from '@/lib/agent-mission-control/data'
import { compareImprovementVersions, type VersionComparison } from '@/lib/agent-mission-control/improvement-loop'

export interface AgentEvolutionPageData {
  lifecycle: AgentLifecycle
  testSuites: EvolutionSuiteRef[]
  benchmarkSuites: EvolutionSuiteRef[]
  comparison: VersionComparison | null
}

const toRef = (s: { id: string; name: string }): EvolutionSuiteRef => ({ id: s.id, name: s.name || s.id })

/**
 * `/admin/agents/[id]/evolution` data-fetch, extracted so `page.tsx` stays a
 * pure `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getAgentEvolutionPageData(copilotId: string): Promise<AgentEvolutionPageData | undefined> {
  const lifecycle = await getAgentLifecycle(copilotId)
  if (!lifecycle) return undefined

  const { latestProposal } = lifecycle

  // Suite lists come from the same getters Observability reads. They are the
  // targets of the run buttons — a suite that is not persisted cannot be run,
  // and the capability above already says so in words.
  const [testSuites, benchmarkSuites] = await Promise.all([
    getTestSuitesForCopilot(copilotId),
    getBenchmarkSuitesForCopilot(copilotId),
  ])

  // The V1/V2 table is recomputed live (never persisted), and only exists once
  // a V2 does. A failed read must not take the whole page down: the surface
  // renders "nothing to compare" rather than a 500 over a secondary panel.
  let comparison: VersionComparison | null = null
  if (latestProposal?.v2VersionId) {
    comparison = await compareImprovementVersions(copilotId, latestProposal.baseVersionId, latestProposal.v2VersionId).catch(
      () => null
    )
  }

  return {
    lifecycle,
    testSuites: testSuites.map(toRef),
    benchmarkSuites: benchmarkSuites.map(toRef),
    comparison,
  }
}
