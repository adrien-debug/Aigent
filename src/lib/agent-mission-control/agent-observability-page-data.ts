import { getAgentDetail, type AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import {
  getBenchmarkRunsForSuites,
  getBenchmarkSuitesForCopilot,
  getTestRunsForCopilot,
} from '@/lib/agent-mission-control/data'
import type { BenchmarkRun, BenchmarkSuite, TestRun } from '@/lib/agent-mission-control/types'

export interface AgentObservabilityPageData {
  detail: AgentDetail
  suites: BenchmarkSuite[]
  benchmarkRuns: BenchmarkRun[]
  testRuns: TestRun[]
}

/**
 * `/admin/agents/[id]/observability` data-fetch, extracted so `page.tsx` stays
 * a pure `data + <View />` shell (see `scripts/check-views.mjs`).
 *
 * Benchmarks and tests are read live: absence is a fact to report, not to hide.
 */
export async function getAgentObservabilityPageData(copilotId: string): Promise<AgentObservabilityPageData | undefined> {
  const detail = await getAgentDetail(copilotId)
  if (!detail) return undefined

  const [suites, testRuns] = await Promise.all([
    getBenchmarkSuitesForCopilot(copilotId),
    getTestRunsForCopilot(copilotId),
  ])
  const benchmarkRuns = suites.length > 0 ? await getBenchmarkRunsForSuites(suites.map((s) => s.id)) : []

  return { detail, suites, benchmarkRuns, testRuns }
}
