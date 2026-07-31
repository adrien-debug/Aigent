/**
 * Agent Mission Control — live delivery loop (PURE, no I/O, no secrets).
 *
 * The operational glue that turns "deliver an agent" into a loop:
 *   deliver → test (sandbox) → classify → fix (Aigent-side only) → redeliver →
 *   retest → ready_for_manual_test.
 *
 * This module is the DETERMINISTIC brain: from a persisted TargetRepoSandboxReport
 * it classifies WHY a delivery failed, decides whether Aigent can auto-fix it
 * (only its OWN generated package — never the target repo), computes the next
 * action, and evaluates the strict readiness gate that lets Aigent honestly say
 * "ready for manual test". It performs NO I/O — the server orchestrator
 * (delivery-loop-server.ts) does the GitHub/DB work and calls this to decide.
 *
 * NEVER blames the agent for a target-repo problem, NEVER proposes touching the
 * target repo's own code/config, NEVER auto-merges.
 */

import type { TargetRepoSandboxReport } from './target-repo-sandbox'

/** Delivery lifecycle states — stored in agent_delivery_events.status (no CHECK constraint, no migration). */
export type DeliveryLoopStatus =
  | 'created'
  | 'dry_run_passed'
  | 'execute_running'
  | 'execute_failed'
  | 'fixing'
  | 'redelivered'
  | 'ready_for_manual_test'
  | 'manual_test_requested'
  | 'abandoned'
  | 'superseded'

/** Root cause of a sandbox failure. */
export type SandboxFailureClass =
  | 'AIGENT_GENERATOR_BUG'
  | 'TARGET_REPO_DEPENDENCY_MISSING'
  | 'TARGET_REPO_EXISTING_FAILURE'
  | 'HANDLER_TYPECHECK_FAILURE'
  | 'SECRET_SCAN_FAILURE'
  | 'REGISTRY_FAILURE'
  | 'MANIFEST_FAILURE'
  | 'SCRIPT_TIMEOUT'
  | 'UNKNOWN'

export interface SandboxClassification {
  failureClass: SandboxFailureClass
  /** True when Aigent owns the fix (its generated package), false for target-repo issues. */
  aigentFixable: boolean
  /** Human-readable evidence line (already sanitized — never a secret). */
  evidence: string
  /** Recommended next action, e.g. retry with installMode auto. */
  recommendation: string
}

// Signatures in a script's output that mean "the target repo lacks installed
// deps" rather than "the delivered handler is broken". `@types/node` / a bare
// missing module resolves once `npm ci` runs — that's a dependency gap, not an
// Aigent bug.
const DEP_MISSING_SIGNATURES = [
  'cannot find module',
  'cannot find name \'process\'',
  'do you need to install type definitions',
  '@types/node',
  'module not found',
  'err_module_not_found',
  'command not found',
]

/** Does an output excerpt point at the delivered handler file specifically? */
function mentionsDeliveredHandler(text: string, agentSlug: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes(`agents/${agentSlug.toLowerCase()}/handler`)
}

function anySignature(text: string, sigs: string[]): boolean {
  const lower = text.toLowerCase()
  return sigs.some((s) => lower.includes(s))
}

/**
 * Classify a failed sandbox report. Deterministic, evidence-based. Order matters:
 * artifact/secret blockers (Aigent-side) are checked before script failures, and
 * a dependency-missing signature is preferred over "handler bug" so we never
 * blame a handler that only fails because the repo has no node_modules.
 */
export function classifySandbox(report: TargetRepoSandboxReport): SandboxClassification {
  const b = new Set(report.blockers)

  // 1. Secret leak in a delivered artifact — Aigent's package, always fixable.
  if (b.has('secret_in_artifacts')) {
    return {
      failureClass: 'SECRET_SCAN_FAILURE',
      aigentFixable: true,
      evidence: report.checks.find((c) => c.id === 'security:secret-scan')?.reason ?? 'secret pattern in delivered artifacts',
      recommendation: 'Regenerate the agent package — a secret pattern was found in a delivered artifact.',
    }
  }

  // 2. Registry problems — Aigent writes the registry.
  if (b.has('agent_not_pushed_to_target_repo') || b.has('registry_unparseable') || b.has('agent_absent_from_registry')) {
    return {
      failureClass: 'REGISTRY_FAILURE',
      aigentFixable: true,
      evidence: [...b].filter((x) => x.includes('registry') || x.includes('agent_')).join(', ') || 'registry issue',
      recommendation: 'Re-deliver: the agent registry entry is missing or malformed.',
    }
  }

  // 3. Manifest problems — Aigent generates the manifest.
  if (b.has('manifest_missing') || b.has('manifest_invalid_json')) {
    return {
      failureClass: 'MANIFEST_FAILURE',
      aigentFixable: true,
      evidence: b.has('manifest_missing') ? 'manifest.json missing' : 'manifest.json is not valid JSON',
      recommendation: 'Re-deliver: the manifest is missing or invalid.',
    }
  }

  // 4. Script timeout — bounded run hit the limit.
  const timeoutBlocker = [...b].find((x) => x.startsWith('script_timeout:'))
  if (timeoutBlocker) {
    return {
      failureClass: 'SCRIPT_TIMEOUT',
      aigentFixable: false,
      evidence: timeoutBlocker,
      recommendation: 'Retry with a longer budget or a reduced script set — the target repo script timed out.',
    }
  }

  // 5. Script failures — dig into the output to tell handler-TS from repo/deps.
  const failedScripts = report.checks.filter((c) => c.id.startsWith('script:') && c.status === 'failed')
  if (failedScripts.length > 0) {
    const combined = failedScripts.map((c) => c.outputExcerpt ?? '').join('\n')

    // Dependency-missing signatures (no node_modules) → target-repo dep gap,
    // NOT an Aigent bug. This is exactly the installMode:skip situation.
    if (anySignature(combined, DEP_MISSING_SIGNATURES) && report.installMode === 'skip') {
      return {
        failureClass: 'TARGET_REPO_DEPENDENCY_MISSING',
        aigentFixable: false,
        evidence: 'scripts failed for lack of installed dependencies (installMode: skip)',
        recommendation: 'Re-run the sandbox with installMode: auto so dependencies are installed before the scripts.',
      }
    }

    // The delivered handler itself fails typecheck (deps present) → Aigent bug.
    const handlerTsFail = failedScripts.some(
      (c) => (c.id === 'script:typecheck' || c.id === 'script:build') && mentionsDeliveredHandler(c.outputExcerpt ?? '', report.agentSlug)
    )
    if (handlerTsFail) {
      return {
        failureClass: 'HANDLER_TYPECHECK_FAILURE',
        aigentFixable: true,
        evidence: `typecheck/build failed inside agents/${report.agentSlug}/handler`,
        recommendation: 'Regenerate the handler — the delivered handler does not typecheck in the target repo.',
      }
    }

    // Scripts fail but NOT on the delivered artifacts → the target repo's own
    // code is failing. Never blame the agent.
    return {
      failureClass: 'TARGET_REPO_EXISTING_FAILURE',
      aigentFixable: false,
      evidence: 'target repo gate scripts fail on the repo’s own code, not the delivered agent',
      recommendation: 'Not an agent defect — the target repo’s existing checks are red. Report to the repo owner.',
    }
  }

  return {
    failureClass: 'UNKNOWN',
    aigentFixable: false,
    evidence: report.blockers.join(', ') || 'no classified blocker',
    recommendation: 'Manual review — the failure did not match a known class.',
  }
}

/** Minimum sandbox score to be considered ready for manual test. */
const READINESS_MIN_SCORE = 95

export interface ReadinessInput {
  deliveryMode: 'direct_commit' | 'pull_request' | null
  prUrl: string | null
  report: TargetRepoSandboxReport | null
  /** Was the report actually persisted (has a stored id)? */
  reportPersisted: boolean
  /** Latest Delivery Scorecard level (from the scorecard). */
  scorecardLevel: 'not_ready' | 'safe' | 'delivery_ready' | 'excellent' | null
  /** Was execute run, or explicitly skipped with an accepted reason? */
  executeStatus: 'passed' | 'skipped_accepted' | 'not_run' | 'failed'
  /** Repo-fit tool-fit check — fail blocks manual test readiness. */
  toolFitStatus?: 'pass' | 'warn' | 'fail' | 'skip' | null
  /** Repo-fit missing coverage keys (e.g. secrets, repo_risks). */
  repoFitMissingCoverage?: string[]
  /** Latest test pass rate pinned to the candidate (0..1). */
  testPassRate?: number | null
  /** Benchmark unsafe actions on the candidate version. */
  benchmarkUnsafeActions?: number | null
  /** Release gate promotable on the candidate version. */
  releaseGatePromotable?: boolean | null
  /** Repo-fit score (0..100). */
  repoFitScore?: number | null
}

export interface ReadinessResult {
  ready: boolean
  status: DeliveryLoopStatus
  /** Reasons the readiness gate is NOT satisfied (empty when ready). */
  unmet: string[]
}

/**
 * The strict gate that lets Aigent say "ready for manual test". Every condition
 * must hold; any miss is listed in `unmet` and `ready` is false. This never
 * fabricates readiness — a missing PR, a red sandbox, a low score, a secret
 * warning, or an un-persisted report all block it.
 */
export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const unmet: string[] = []
  const r = input.report

  if (input.deliveryMode !== 'pull_request') unmet.push('delivery must be a pull request')
  if (!input.prUrl) unmet.push('a PR URL is required')
  if (!r) unmet.push('a sandbox report is required')
  if (!input.reportPersisted) unmet.push('the sandbox report must be persisted')

  if (r) {
    if (r.blockers.length > 0) unmet.push(`sandbox has blockers: ${r.blockers.join(', ')}`)
    if ((r.sandboxFitScore ?? 0) < READINESS_MIN_SCORE) unmet.push(`sandboxFitScore < ${READINESS_MIN_SCORE}`)
    // Secret warning is a hard stop even if not a blocker.
    if (r.warnings.some((w) => w.includes('secret'))) unmet.push('a secret warning is present')
    // dry-run must be green.
    const dryPassed = r.status === 'passed'
    if (!dryPassed) unmet.push('sandbox dry-run is not passed')
    // handler must compile: no typecheck/build script failed.
    const handlerBroken = r.checks.some(
      (c) => (c.id === 'script:typecheck' || c.id === 'script:build') && c.status === 'failed'
    )
    if (handlerBroken) unmet.push('handler does not compile (typecheck/build failed)')
  }

  // execute must have passed, or be explicitly skipped with an accepted reason.
  if (input.executeStatus === 'failed') unmet.push('sandbox execute failed')
  if (input.executeStatus === 'not_run') unmet.push('sandbox execute has not run (nor been accepted as skipped)')

  // scorecard must be at least delivery_ready.
  if (input.scorecardLevel !== 'delivery_ready' && input.scorecardLevel !== 'excellent') {
    unmet.push('delivery scorecard below delivery_ready')
  }

  // tool-fit must not be fail for repo-linked inspection agents.
  if (input.toolFitStatus === 'fail') unmet.push('repo-fit tool-fit is fail (inspection role without repo-read tools)')

  // Critical repo risk coverage must be present when repo-fit was computed.
  if (input.repoFitMissingCoverage?.length && input.repoFitMissingCoverage.length > 0) {
    unmet.push(`repo risk coverage missing: ${input.repoFitMissingCoverage.join(', ')}`)
  }

  // Tests must be 100 % on the candidate version.
  if (input.testPassRate == null) unmet.push('no completed test run on the candidate')
  else if (input.testPassRate < 1) unmet.push(`test pass rate < 100% (${Math.round(input.testPassRate * 100)}%)`)

  // Benchmark must have zero unsafe actions.
  if (input.benchmarkUnsafeActions == null) unmet.push('no completed benchmark on the candidate')
  else if (input.benchmarkUnsafeActions > 0) unmet.push(`benchmark unsafe_actions: ${input.benchmarkUnsafeActions}`)

  // Release gate must be green on the candidate.
  if (input.releaseGatePromotable !== true) unmet.push('release gate is not green')

  // Repo-fit must stay strong after runtime improvements.
  if (input.repoFitScore != null && input.repoFitScore < 95) {
    unmet.push(`repoFitScore < 95 (${input.repoFitScore})`)
  }

  return {
    ready: unmet.length === 0,
    status: unmet.length === 0 ? 'ready_for_manual_test' : 'fixing',
    unmet,
  }
}

/** Compose the human "ready for manual test" message. No secrets. */
export function readyForManualTestMessage(input: {
  agentName: string
  repo: string
  prUrl: string
  sandboxScore: number | null
  whatToTest: string
}): string {
  return [
    `Adrien, c'est prêt pour test manuel.`,
    `PR : ${input.prUrl}`,
    `Agent : ${input.agentName}`,
    `Workspace : ${input.repo}`,
    `Sandbox : passed`,
    `Score : ${input.sandboxScore ?? '—'}/100`,
    `Ce que tu dois tester manuellement : ${input.whatToTest}`,
  ].join('\n')
}
