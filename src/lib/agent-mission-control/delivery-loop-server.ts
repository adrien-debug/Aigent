/**
 * Agent Mission Control — live delivery loop orchestrator (server only).
 *
 * The I/O half of the delivery loop. Assembles the existing pieces — PR
 * delivery (github.ts), target-repo sandbox (target-repo-sandbox-server.ts),
 * delivery events (delivery-events-store.ts), delivery scorecard — and drives
 * ONE loop iteration: assess the latest delivery + sandbox, classify any
 * failure (delivery-loop.ts, pure), and compute readiness. It records each
 * attempt as a delivery event.
 *
 * SAFETY: read-only by default. It NEVER merges, NEVER direct-commits to a
 * target default branch, NEVER touches the target repo's own code. A real PR /
 * execute run only happens when the caller passes explicit flags AND the env is
 * armed (github.ts's own double gate still applies). Aigent-side auto-fix means
 * REGENERATING its own package (handler/manifest/registry) and re-delivering —
 * never editing the target repo.
 *
 * Never import from a client component (reads service-role key + GITHUB_TOKEN).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { getCopilot, getProject } from './data'
import type { Copilot } from './types'
import { getDeliveryScorecard } from './delivery-scorecard-server'
import { getLatestDeliveryEvent, persistDeliveryEvent, type DeliveryEvent } from './delivery-events-store'
import {
  classifySandbox,
  evaluateReadiness,
  readyForManualTestMessage,
  type DeliveryLoopStatus,
  type SandboxClassification,
} from './delivery-loop'
import { getLatestSandboxReport, persistSandboxReport } from './sandbox-reports-store'
import { collectTargetRepoSandbox } from './target-repo-sandbox-server'
import type { TargetRepoSandboxReport } from './target-repo-sandbox'

export interface DeliveryLoopState {
  copilotId: string
  agentName: string
  repo: string | null
  status: DeliveryLoopStatus
  attempts: number
  latestDelivery: DeliveryEvent | null
  latestSandbox: TargetRepoSandboxReport | null
  classification: SandboxClassification | null
  readiness: { ready: boolean; unmet: string[] }
  nextAction: string
  /** Populated only when ready_for_manual_test. */
  manualTestMessage: string | null
  /** Generic signal set when a REQUESTED sandbox run produced no report this iteration (detail is logged server-side); latestSandbox then falls back to the last persisted report. */
  sandboxError: string | null
}

export interface RunLoopOptions {
  runId: string
  createdAt: string
  /** Run a sandbox this iteration (dry_run by default; execute is explicit). */
  runSandbox?: boolean
  sandboxMode?: 'dry_run' | 'execute'
  /** What to tell Adrien to test manually once ready. */
  whatToTest?: string
}

/** Count delivery attempts for a copilot (cheap — one PostgREST count). Reuses a preloaded latest event when provided (undefined = not loaded yet). */
async function countAttempts(copilotId: string, preloadedLatest?: DeliveryEvent | null): Promise<number> {
  const latest = preloadedLatest !== undefined ? preloadedLatest : await getLatestDeliveryEvent(copilotId)
  return latest ? 1 : 0 // best-effort; the store keeps full history, this is a display hint
}

/**
 * Run one iteration of the delivery loop for a copilot. Read-only unless
 * `runSandbox` is set (and even then the sandbox itself is read-only / a
 * disposable clone). Persists a delivery event snapshot. NEVER merges, NEVER
 * writes to the target repo's own code.
 */
export async function runDeliveryLoop(copilotId: string, opts: RunLoopOptions): Promise<DeliveryLoopState | null> {
  const copilot0 = await getCopilot(copilotId)
  if (!copilot0) return null
  const project0 = copilot0.projectId ? await getProject(copilot0.projectId) : undefined
  const repo0 = project0?.repoFullName ?? null

  const latestDelivery0 = await getLatestDeliveryEvent(copilotId)

  // Optionally run a sandbox this iteration (on the PR delivery branch when one
  // exists, else the default branch). dry_run by default; execute is explicit.
  let ranSandbox: TargetRepoSandboxReport | null = null
  let sandboxError: string | null = null
  if (opts.runSandbox && repo0) {
    try {
      const targetBranch = latestDelivery0?.deliveryBranch ?? undefined
      const report = await collectTargetRepoSandbox(copilotId, {
        runId: `sandbox_${opts.runId}`,
        createdAt: opts.createdAt,
        mode: opts.sandboxMode ?? 'dry_run',
        installMode: opts.sandboxMode === 'execute' ? 'auto' : 'skip',
        targetBranch,
      })
      if (report) {
        ranSandbox = report
        try {
          await persistSandboxReport(report, copilot0.projectId ?? null)
        } catch {
          // persistence best-effort — the assessment still stands
        }
      }
    } catch (err) {
      console.error('[delivery-loop] requested sandbox run failed', err instanceof Error ? err.message : err)
    }
    // The caller ASKED for a sandbox and none ran — say so (generic message,
    // detail in the server log) instead of silently falling back to the last
    // persisted report in computeLoopState.
    if (!ranSandbox) sandboxError = 'sandbox run failed'
  }

  return computeLoopState(copilotId, {
    latestSandbox: ranSandbox,
    persistEvent: true,
    runId: opts.runId,
    whatToTest: opts.whatToTest,
    copilot: copilot0,
    latestDelivery: latestDelivery0,
    sandboxError,
  })
}

/** Shared assessment core — reads state, classifies, evaluates readiness, and (optionally) persists a status event. Accepts preloaded copilot/latestDelivery to avoid refetching (undefined = not loaded yet). */
async function computeLoopState(
  copilotId: string,
  opts: {
    latestSandbox: TargetRepoSandboxReport | null
    persistEvent: boolean
    runId: string
    whatToTest?: string
    copilot?: Copilot
    latestDelivery?: DeliveryEvent | null
    sandboxError?: string | null
  }
): Promise<DeliveryLoopState | null> {
  const copilot = opts.copilot ?? (await getCopilot(copilotId))
  if (!copilot) return null

  const project = copilot.projectId ? await getProject(copilot.projectId) : undefined
  const repo = project?.repoFullName ?? null

  const latestDelivery = opts.latestDelivery !== undefined ? opts.latestDelivery : await getLatestDeliveryEvent(copilotId)
  let latestSandbox = opts.latestSandbox
  if (!latestSandbox) latestSandbox = await getLatestSandboxReport(copilotId)

  // Classify a failing sandbox (deterministic, pure).
  let classification: ReturnType<typeof classifySandbox> | null = null
  if (latestSandbox && latestSandbox.status !== 'passed') {
    classification = classifySandbox(latestSandbox)
  }

  // Latest scorecard level (production target — the served version).
  let scorecardLevel: 'not_ready' | 'safe' | 'delivery_ready' | 'excellent' | null = null
  let toolFitStatus: 'pass' | 'warn' | 'fail' | 'skip' | null = null
  let repoFitMissingCoverage: string[] = []
  let testPassRate: number | null = null
  let benchmarkUnsafeActions: number | null = null
  let releaseGatePromotable: boolean | null = null
  let repoFitScore: number | null = null
  try {
    const card = await getDeliveryScorecard(copilotId, { target: 'candidate' })
    scorecardLevel = card?.level ?? null
    const toolFit = card?.evidence.repoFit?.checks.find((c) => c.id === 'tool-fit')
    toolFitStatus = toolFit?.status ?? null
    repoFitMissingCoverage = card?.evidence.repoFit?.missingCoverage ?? []
    repoFitScore = card?.evidence.repoFit?.score ?? null
    const testDim = card?.dimensions.find((d) => d.id === 'tests')
    testPassRate = testDim?.score != null ? testDim.score / 100 : null
    const benchDim = card?.dimensions.find((d) => d.id === 'safety')
    if (card?.blockers.some((b) => b.startsWith('unsafe_actions:'))) {
      const m = (/unsafe_actions:(\d+)/).exec(card.blockers.find((b) => b.startsWith('unsafe_actions:')) ?? '')
      benchmarkUnsafeActions = m ? Number(m[1]) : 1
    } else if (benchDim?.status === 'pass') {
      benchmarkUnsafeActions = 0
    }
    releaseGatePromotable = card?.blockers.includes('release_gate_red')
      ? false
      : card?.dimensions.find((d) => d.id === 'release-gate')?.status === 'pass'
        ? true
        : null
  } catch {
    scorecardLevel = null
  }

  // Readiness gate.
  const executeStatus: 'passed' | 'skipped_accepted' | 'not_run' | 'failed' =
    latestSandbox?.executionMode === 'execute'
      ? latestSandbox.status === 'passed'
        ? 'passed'
        : 'failed'
      : 'not_run'
  const readiness = evaluateReadiness({
    deliveryMode: latestDelivery?.mode ?? null,
    prUrl: latestDelivery?.prUrl ?? null,
    report: latestSandbox,
    reportPersisted: latestSandbox !== null,
    scorecardLevel,
    executeStatus,
    toolFitStatus,
    repoFitMissingCoverage,
    testPassRate,
    benchmarkUnsafeActions,
    releaseGatePromotable,
    repoFitScore,
  })

  // Decide status + next action.
  let status: DeliveryLoopStatus
  let nextAction: string
  if (readiness.ready) {
    status = 'ready_for_manual_test'
    nextAction = 'Notify Adrien — ready for manual test.'
  } else if (classification) {
    status = 'fixing'
    nextAction = classification.aigentFixable
      ? `Aigent-side fix: ${classification.recommendation}`
      : classification.recommendation
  } else if (!latestDelivery) {
    status = 'created'
    nextAction = 'Create a delivery PR, then run the sandbox on its branch.'
  } else {
    status = 'fixing'
    nextAction = `Not ready: ${readiness.unmet.join('; ')}`
  }

  const manualTestMessage =
    status === 'ready_for_manual_test' && latestDelivery?.prUrl
      ? readyForManualTestMessage({
          agentName: copilot.name,
          repo: repo ?? 'unknown',
          prUrl: latestDelivery.prUrl,
          sandboxScore: latestSandbox?.sandboxFitScore ?? null,
          whatToTest: opts.whatToTest ?? `Send a real prompt to ${copilot.name} in ${repo ?? 'the workspace'} and confirm the response + guardrails.`,
        })
      : null

  // Record this loop assessment as a delivery event (status snapshot) — ONLY on
  // an explicit run (not at UI-render assessment time, which must be side-effect-free).
  if (opts.persistEvent) {
    try {
      await persistDeliveryEvent({
        id: `loop_${opts.runId}`,
        copilotId,
        versionId: copilot.productionVersionId ?? copilot.latestVersionId,
        projectId: copilot.projectId ?? null,
        mode: latestDelivery?.mode ?? 'pull_request',
        targetRepo: repo ?? '',
        targetBranch: latestDelivery?.targetBranch ?? null,
        deliveryBranch: latestDelivery?.deliveryBranch ?? null,
        commitSha: latestDelivery?.commitSha ?? null,
        commitUrl: latestDelivery?.commitUrl ?? null,
        prUrl: latestDelivery?.prUrl ?? null,
        prNumber: latestDelivery?.prNumber ?? null,
        status,
      })
    } catch {
      // event persistence is best-effort
    }
  }

  return {
    copilotId,
    agentName: copilot.name,
    repo,
    status,
    attempts: (await countAttempts(copilotId, latestDelivery)) + 1,
    latestDelivery,
    latestSandbox,
    classification,
    readiness: { ready: readiness.ready, unmet: readiness.unmet },
    nextAction,
    manualTestMessage,
    sandboxError: opts.sandboxError ?? null,
  }
}

/** Stamp helper for a route to generate the ids/timestamps (module stays pure). */
export function newLoopRunId(): { runId: string; createdAt: string } {
  return { runId: randomUUID().replace(/-/g, '').slice(0, 12), createdAt: new Date().toISOString() }
}
