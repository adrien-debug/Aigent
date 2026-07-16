/**
 * Agent Mission Control — Delivery Scorecard collector (server only).
 *
 * The I/O half of the scorecard: gather the ALREADY run-backed evidence from
 * the live perimeter and hand it to the pure `computeDeliveryScorecard`. Reuses
 * the Release Gate as the single source of test/benchmark/tool evidence (it
 * already reads the latest completed runs pinned to the candidate version, never
 * the stale scores blob), and recomputes repo-fit over the PERSISTED test cases
 * against the project's cached RepoMap (no new scan).
 *
 * Read-only: never writes, never promotes, never touches GitHub. Fail-soft on
 * repo-fit (a missing/empty repo intelligence yields a manifest-only warning,
 * not an error). Never import from a client component (reads service-role key).
 */
import 'server-only'

import {
  computeDeliveryScorecard,
  type AgentDeliveryScorecard,
} from './delivery-scorecard'
import {
  getCopilot,
  getTestCasesForSuite,
  getTestSuitesForCopilot,
  getToolsForCopilot,
} from './data'
import { evaluateReleaseGate } from './release-gate'
import { computeRepoFit, type RepoFitCase, type RepoFitResult } from './repo-fit'
import { loadRepoIntelligence } from './repo-intelligence-store'
import { buildRepoSuiteContext } from './repo-suite-context'

/**
 * Recompute repo-fit for a copilot from its PERSISTED test cases + the project's
 * cached RepoMap. Returns null when there is no repo intelligence to validate
 * against (manifest-only), which the scorecard treats as a warning. Never scans.
 */
async function resolveRepoFit(
  copilotId: string,
  projectId: string | null,
  toolNames: string[],
  roleText: string
): Promise<RepoFitResult | null> {
  if (!projectId) return null
  try {
    const stored = await loadRepoIntelligence(projectId)
    const repoAware = buildRepoSuiteContext(stored.intelligence) !== null
    if (!stored.intelligence?.map) return null

    const suites = await getTestSuitesForCopilot(copilotId)
    const caseArrays = await Promise.all(suites.map((s) => getTestCasesForSuite(s.id)))
    const cases: RepoFitCase[] = caseArrays.flat().map((c) => ({
      name: c.name,
      input: c.input,
      expectedBehavior: c.expectedBehavior,
      expectedToolCalls: c.expectedToolCalls,
      tags: c.tags,
    }))

    return computeRepoFit({
      suiteSource: repoAware ? 'repo_aware' : 'manifest_only',
      cases,
      toolNames,
      repoMap: stored.intelligence.map,
      residueCount: stored.intelligence.residue?.length ?? 0,
      roleText,
    })
  } catch {
    return null
  }
}

/**
 * Build the full delivery scorecard for a copilot's candidate version. `null`
 * only when the copilot itself is not found. All numeric evidence is run-backed
 * via the Release Gate; repo-fit is recomputed over persisted cases.
 */
export async function getDeliveryScorecard(
  copilotId: string,
  candidateVersionId?: string
): Promise<AgentDeliveryScorecard | null> {
  const copilot = await getCopilot(copilotId)
  if (!copilot) return null

  // The gate carries the run-backed test/benchmark/tool evidence in one call.
  // Fail-soft: a gate evaluation error must not break the scorecard — we fall
  // back to null evidence (which the pure scorecard renders as `missing`).
  let gate: Awaited<ReturnType<typeof evaluateReleaseGate>> = null
  try {
    gate = await evaluateReleaseGate(copilotId, candidateVersionId)
  } catch {
    gate = null
  }

  // Real mounted tool names so repo-fit's tool check sees the read tools.
  const tools = await getToolsForCopilot(copilotId)
  const repoFit = await resolveRepoFit(
    copilotId,
    copilot.projectId,
    tools.map((t) => t.name),
    `${copilot.description} ${copilot.tags.join(' ')}`
  )

  return computeDeliveryScorecard({
    repoFit,
    testRun: gate?.evidence.testRun
      ? { id: gate.evidence.testRun.id, passRate: gate.evidence.testRun.passRate, hasRecursionError: gate.evidence.testRun.hasRecursionError }
      : null,
    benchmark: gate?.evidence.benchmark
      ? {
          id: gate.evidence.benchmark.id,
          score: gate.evidence.benchmark.score,
          accuracy: gate.evidence.benchmark.accuracy,
          unsafeActionCount: gate.evidence.benchmark.unsafeActionCount,
          confirmationMistakeCount: gate.evidence.benchmark.confirmationMistakeCount,
        }
      : null,
    toolRiskWrites: gate?.evidence.toolRiskWrites ?? [],
    releaseGatePromotable: gate ? gate.promotable : null,
  })
}
