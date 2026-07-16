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
  type DeliveryScorecardTarget,
  type ScorecardTargetKind,
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
 * Build the delivery scorecard for a copilot, targeting a specific version.
 *
 *   auto (default): score the SERVED production version when one exists
 *     (production_version_id), else the latest candidate.
 *   production: score the served production version; if none, a missing/not_ready
 *     scorecard with a `no_production_version` warning (never lies).
 *   candidate: score the latest candidate / latest_version_id.
 *
 * A production scorecard reflects the version already serving traffic — it does
 * NOT block on the live gate refusing to re-promote an already-production stage
 * (see the pure helper). `null` only when the copilot is not found.
 */
export async function getDeliveryScorecard(
  copilotId: string,
  opts: { target?: DeliveryScorecardTarget } = {}
): Promise<AgentDeliveryScorecard | null> {
  const copilot = await getCopilot(copilotId)
  if (!copilot) return null

  const productionVersionId = copilot.productionVersionId
  const candidateVersionId = copilot.latestVersionId
  const requested: DeliveryScorecardTarget = opts.target ?? 'auto'

  // Resolve which version to score + whether it's a production or candidate view.
  let targetKind: ScorecardTargetKind
  let targetVersionId: string | null
  if (requested === 'production') {
    targetKind = 'production'
    targetVersionId = productionVersionId
  } else if (requested === 'candidate') {
    targetKind = 'candidate'
    targetVersionId = candidateVersionId
  } else {
    // auto: production if served, else candidate.
    if (productionVersionId) {
      targetKind = 'production'
      targetVersionId = productionVersionId
    } else {
      targetKind = 'candidate'
      targetVersionId = candidateVersionId
    }
  }

  // Real mounted tool names so repo-fit's tool check sees the read tools.
  const tools = await getToolsForCopilot(copilotId)
  const repoFit = await resolveRepoFit(
    copilotId,
    copilot.projectId,
    tools.map((t) => t.name),
    `${copilot.description} ${copilot.tags.join(' ')}`
  )

  const baseFields = {
    repoFit,
    productionVersionId,
    candidateVersionId,
    target: targetKind,
    targetVersionId,
  }

  // production explicitly requested but nothing served → honest not_ready.
  if (requested === 'production' && !productionVersionId) {
    const card = computeDeliveryScorecard({
      ...baseFields,
      testRun: null,
      benchmark: null,
      toolRiskWrites: [],
      releaseGatePromotable: null,
    })
    card.warnings = ['no_production_version', ...card.warnings]
    card.level = 'not_ready'
    card.status = 'fail'
    return card
  }

  // The gate carries the run-backed evidence PINNED to the target version. Even
  // when its `is-draft` check fails on a production stage, testRun/benchmark/
  // toolRiskWrites are still resolved for that exact version. Fail-soft.
  let gate: Awaited<ReturnType<typeof evaluateReleaseGate>> = null
  try {
    gate = targetVersionId ? await evaluateReleaseGate(copilotId, targetVersionId) : await evaluateReleaseGate(copilotId)
  } catch {
    gate = null
  }

  return computeDeliveryScorecard({
    ...baseFields,
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
