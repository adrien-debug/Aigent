/**
 * Agent Mission Control — Qualification Orchestrator (server only).
 *
 * AIGENT-AUTONOMOUS-FACTORY-001. THE single service that walks ONE candidate
 * version through the qualification workflow:
 *
 *     tests → benchmark → shadow → replay → gate
 *
 * It is a WORKFLOW layer, not a proof engine. Every step CONSUMES an existing
 * engine and records that engine's honest verdict; it never invents evidence and
 * never marks a step PASS by default:
 *   - tests / benchmark  → read the latest COMPLETED run for the version
 *                          (test-runner / benchmark-runner own the running).
 *   - shadow  / replay   → read the candidate's evidence produced by the REAL
 *                          LangGraph candidate-execution path (owned by the
 *                          shadow/replay engine branch). Absent here → NOT_AVAILABLE.
 *                          A fixture is NEVER a production driver (see below).
 *   - gate               → evaluateAndPersistPromotionGate() — THE authority. It
 *                          persists a fresh promotion_gates row that the promote
 *                          RPC re-reads (migration 0033). This orchestrator NEVER
 *                          promotes and NEVER writes status/stage: promotion stays
 *                          the explicit, privilege-separated route action.
 *
 * The workflow state lives in `qualification_runs` (migration 0040) — the LEDGER
 * only, pointing back at the engines' evidence rows. Guarantees:
 *   - IDEMPOTENT   — a client_run_id (or an already-running run for the version)
 *                    collapses a re-submit onto the existing run.
 *   - RESUMABLE    — a step that throws (infra) leaves the cursor untouched;
 *                    re-advancing re-runs exactly that step.
 *   - VERSION-SCOPED — every read/write is bound to (copilotId, versionId); a
 *                    version that does not belong to the copilot is refused (IDOR).
 *   - MUTATION-RESISTANT — a candidate whose manifest/tools/model changed under a
 *                    running workflow is detected by fingerprint drift and the run
 *                    is SUPERSEDED, never silently qualified on stale evidence.
 *   - NO AUTO-PROMOTION — the sweep stops at the gate; promotion is a separate
 *                    explicit action.
 *
 * FIXTURES: the shadow/replay driver seam below defaults to ABSENT. A fixture
 * driver may only be injected by tests. No fixture-backed proof can satisfy a
 * production gate: in production no driver is wired, the step is NOT_AVAILABLE,
 * and the gate re-reads the real evidence tables independently.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import { pgrest, PgrestError } from './postgrest'
import {
  DEFAULT_PROMOTION_POLICY,
  evaluateAndPersistPromotionGate,
  type PromotionPolicy,
} from './promotion-gate'
import { getTool, isToolCertified } from './registry/tools'
import { isRuntimeExecutable } from './registry/runtimes'
import type { IsoTimestamp } from './types'

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

// ── Step + status vocabulary ─────────────────────────────────────────────────

export const QUALIFICATION_STEPS = ['tests', 'benchmark', 'shadow', 'replay', 'gate'] as const
export type QualificationStep = (typeof QUALIFICATION_STEPS)[number]

/** Cursor: the next step to execute, or `done` when the walk is complete. */
export type QualificationCursor = QualificationStep | 'done'

/**
 * A step's honest outcome. Reuses the promotion-gate vocabulary
 * (PASS/FAIL/NOT_CONFIGURED/INSUFFICIENT_EVIDENCE) and adds only the two the
 * mission explicitly sanctions for a workflow step: NOT_AVAILABLE (the capability
 * is not wired in this perimeter) and PENDING (not run yet). No parallel labels.
 */
export type QualificationStepStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_CONFIGURED'
  | 'NOT_AVAILABLE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'PENDING'

/** Terminal + in-flight states of a whole run. */
export type QualificationRunStatus = 'running' | 'blocked' | 'promotable' | 'superseded' | 'aborted'

export interface QualificationStepResult {
  step: QualificationStep
  status: QualificationStepStatus
  /** Human-readable observed value (never a fabricated success). */
  reason: string
  /** Id of the persisted evidence this step read/produced, if any. */
  evidenceRef: string | null
  /** The table/module that owns this step's truth. */
  sourceOfTruth: string
  at: IsoTimestamp
}

export interface QualificationRun {
  id: string
  copilotId: string
  copilotVersionId: string
  clientRunId: string | null
  candidateFingerprint: string
  status: QualificationRunStatus
  stepCursor: QualificationCursor
  steps: QualificationStepResult[]
  policy: PromotionPolicy
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/**
 * Isolated integration point for the REAL shadow/replay engine (owned by
 * feat/factory-shadow-replay-001). When a driver is injected it drives a real
 * experiment through the canonical LangGraph candidate-execution path and returns
 * the persisted evidence id + verdict. DEFAULT: absent → the step is
 * NOT_AVAILABLE. A fixture implementation is permitted ONLY in tests — never in a
 * production request — so no fixture-backed proof can reach a gate.
 */
export interface ShadowReplayDriver {
  runShadow?(args: {
    copilotId: string
    candidateVersionId: string
    productionVersionId: string | null
  }): Promise<{ evidenceId: string; verdict: string } | null>
  runReplay?(args: {
    copilotId: string
    candidateVersionId: string
    referenceVersionId: string | null
  }): Promise<{ evidenceId: string; verdict: string } | null>
}

export interface OrchestratorOptions {
  policy?: PromotionPolicy
  /** Test-only seam; never wired in production (see ShadowReplayDriver). */
  driver?: ShadowReplayDriver
  /** Injected clock — the persisted timestamps use the caller's real clock. */
  now?: () => Date
}

/** Typed failure so routes map cleanly (404 for not-found/IDOR, 409 for conflict). */
export class QualificationError extends Error {
  readonly code: 'not_found' | 'idor' | 'not_a_candidate'
  constructor(code: QualificationError['code'], message: string) {
    super(message)
    this.name = 'QualificationError'
    this.code = code
  }
}

// ── Row mapping ──────────────────────────────────────────────────────────────

type RawRow = Record<string, unknown>

function mapRun(row: RawRow): QualificationRun {
  return {
    id: row.id as string,
    copilotId: row.copilot_id as string,
    copilotVersionId: row.copilot_version_id as string,
    clientRunId: (row.client_run_id as string | null) ?? null,
    candidateFingerprint: row.candidate_fingerprint as string,
    status: row.status as QualificationRunStatus,
    stepCursor: row.step_cursor as QualificationCursor,
    steps: Array.isArray(row.steps) ? (row.steps as QualificationStepResult[]) : [],
    policy: (row.policy as PromotionPolicy) ?? DEFAULT_PROMOTION_POLICY,
    createdAt: row.created_at as IsoTimestamp,
    updatedAt: row.updated_at as IsoTimestamp,
  }
}

// ── Candidate identity + fingerprint ─────────────────────────────────────────

interface CandidateSnapshot {
  versionId: string
  copilotId: string
  runtime: string
  stage: string
  model: string | null
  modelProvider: string | null
  manifestId: string | null
  toolIds: string[]
  /** The manifest fields that materially define behaviour (fingerprint inputs). */
  manifest: RawRow | null
}

/**
 * Read the candidate's live behavioural surface, scoped to (copilot, version).
 * Returns null if the version does not exist; throws IDOR if it exists under a
 * DIFFERENT copilot (a cross-copilot version id).
 */
async function loadCandidate(copilotId: string, versionId: string): Promise<CandidateSnapshot | null> {
  const versionRows = await pgrest<RawRow[]>(
    'GET',
    `copilot_versions?${eq('id', versionId)}&select=id,copilot_id,stage,model,model_provider,manifest_id`,
  )
  const version = versionRows[0]
  if (!version) return null
  if ((version.copilot_id as string) !== copilotId) {
    throw new QualificationError('idor', `version ${versionId} does not belong to copilot ${copilotId}`)
  }

  const copilotRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=id,runtime`)
  const copilot = copilotRows[0]
  if (!copilot) return null
  const runtime = (copilot.runtime as string) ?? 'unknown'

  const manifestId = (version.manifest_id as string | null) ?? null
  let manifest: RawRow | null = null
  let toolIds: string[] = []
  if (manifestId) {
    const manifestRows = await pgrest<RawRow[]>(
      'GET',
      `manifests?${eq('id', manifestId)}&select=id,system_prompt_summary,forbidden_actions,allowed_routes,output_contract,confirmation_policy,always_confirm_actions,max_steps_per_run,max_cost_per_run_usd,tool_ids`,
    )
    manifest = manifestRows[0] ?? null
    toolIds = (manifest?.tool_ids as string[] | null) ?? []
  }

  return {
    versionId,
    copilotId,
    runtime,
    stage: version.stage as string,
    model: (version.model as string | null) ?? null,
    modelProvider: (version.model_provider as string | null) ?? null,
    manifestId,
    toolIds,
    manifest,
  }
}

/**
 * A stable hash of everything that defines the candidate's behaviour: model +
 * provider + the manifest's behavioural fields + the SORTED tool_ids. A drift in
 * any of these while a run is in flight means the candidate was mutated underneath
 * the workflow — the run is then superseded. tool_ids are sorted so a pure
 * reorder (no set change) is NOT flagged.
 */
function fingerprintCandidate(snap: CandidateSnapshot): string {
  const m = snap.manifest ?? {}
  const canonical = JSON.stringify([
    snap.model,
    snap.modelProvider,
    m.system_prompt_summary ?? null,
    m.forbidden_actions ?? null,
    m.allowed_routes ?? null,
    m.output_contract ?? null,
    m.confirmation_policy ?? null,
    m.always_confirm_actions ?? null,
    m.max_steps_per_run ?? null,
    m.max_cost_per_run_usd ?? null,
    snap.toolIds.toSorted(),
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

// ── Tool resolution + certification (creation contract) ──────────────────────

export interface ToolResolutionReport {
  declared: number
  resolved: number
  certified: number
  /** Manifest tool_ids with no matching `tools` row — phantom capabilities. */
  phantom: string[]
  /** Resolved tool names whose registry entry is missing or not certified. */
  uncertified: string[]
}

/**
 * Classify a candidate's manifest tool_ids exactly as the promotion gate does
 * (single definition of "resolved & certified"): resolve each id to its `tools`
 * row name, then check the canonical registry. An id with no row is PHANTOM; a
 * name absent/uncertified in the registry is UNCERTIFIED. Both block runnability.
 */
export async function resolveCandidateTools(toolIds: string[]): Promise<ToolResolutionReport> {
  if (toolIds.length === 0) {
    return { declared: 0, resolved: 0, certified: 0, phantom: [], uncertified: [] }
  }
  const inList = toolIds.map((id) => `"${id}"`).join(',')
  const rows = await pgrest<RawRow[]>('GET', `tools?id=in.(${encodeURIComponent(inList)})&select=id,name`)
  const idToName = new Map<string, string>()
  for (const r of rows) idToName.set(r.id as string, r.name as string)

  const phantom: string[] = []
  const uncertified: string[] = []
  let certified = 0
  for (const id of toolIds) {
    const name = idToName.get(id)
    if (!name) {
      phantom.push(id)
      continue
    }
    const tool = getTool(name)
    if (!tool || !isToolCertified(name)) {
      uncertified.push(name)
      continue
    }
    certified += 1
  }
  return {
    declared: toolIds.length,
    resolved: toolIds.length - phantom.length,
    certified,
    phantom,
    uncertified,
  }
}

// ── Creation contract / candidate description ────────────────────────────────

export interface CandidateContract {
  copilotId: string
  candidateVersionId: string
  manifestId: string | null
  runtime: string
  runtimeExecutable: boolean
  stage: string
  assistantProvisioned: boolean
  tools: ToolResolutionReport
  /** The qualification workflow state for this version (never fabricated). */
  qualification: QualificationReadiness
}

/**
 * Describe a freshly-created (or any) candidate honestly — the shape the creation
 * route returns and the detail page reads. Every field is derived from live rows;
 * nothing is defaulted to a passing value.
 */
export async function describeCandidate(
  copilotId: string,
  versionId?: string,
): Promise<CandidateContract | null> {
  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    `copilots?${eq('id', copilotId)}&select=id,runtime,latest_version_id,assistant_id`,
  )
  const copilot = copilotRows[0]
  if (!copilot) return null
  const candidateVersionId = versionId ?? (copilot.latest_version_id as string | null)
  if (!candidateVersionId) return null

  const snap = await loadCandidate(copilotId, candidateVersionId)
  if (!snap) return null

  const [tools, run] = await Promise.all([
    resolveCandidateTools(snap.toolIds),
    getLatestQualificationRun(copilotId, candidateVersionId),
  ])

  return {
    copilotId,
    candidateVersionId,
    manifestId: snap.manifestId,
    runtime: snap.runtime,
    runtimeExecutable: isRuntimeExecutable(snap.runtime),
    stage: snap.stage,
    assistantProvisioned: !!(copilot.assistant_id as string | null),
    tools,
    qualification: computeReadiness(run),
  }
}

// ── Step executors — each CONSUMES an engine, never fabricates ───────────────

async function stepTests(copilotId: string, versionId: string, at: IsoTimestamp): Promise<QualificationStepResult> {
  const runs = await pgrest<RawRow[]>(
    'GET',
    `test_runs?${eq('version_id', versionId)}&status=eq.completed&select=id,pass_rate&order=started_at.desc&limit=1`,
  )
  const run = runs[0]
  if (!run) {
    return {
      step: 'tests',
      status: 'NOT_CONFIGURED',
      reason: 'no completed test run on record for this version — run its test suite to produce evidence',
      evidenceRef: null,
      sourceOfTruth: 'test_runs',
      at,
    }
  }
  const results = await pgrest<RawRow[]>('GET', `test_results?${eq('run_id', run.id as string)}&select=status`)
  const total = results.length
  const passed = results.filter((r) => r.status === 'pass').length
  const passRate = (run.pass_rate as number) ?? 0
  const green = total > 0 && passRate >= 1
  return {
    step: 'tests',
    status: green ? 'PASS' : 'FAIL',
    reason: `${passed}/${total} cases pass (${Math.round(passRate * 100)}%)`,
    evidenceRef: run.id as string,
    sourceOfTruth: 'test_runs / test_results',
    at,
  }
}

async function stepBenchmark(copilotId: string, versionId: string, at: IsoTimestamp): Promise<QualificationStepResult> {
  const runs = await pgrest<RawRow[]>(
    'GET',
    `benchmark_runs?${eq('version_id', versionId)}&status=eq.completed&select=id&order=started_at.desc&limit=1`,
  )
  const run = runs[0]
  if (!run) {
    return {
      step: 'benchmark',
      status: 'NOT_CONFIGURED',
      reason: 'no completed benchmark on record for this version',
      evidenceRef: null,
      sourceOfTruth: 'benchmark_runs',
      at,
    }
  }
  const res = await pgrest<RawRow[]>(
    'GET',
    `benchmark_results?${eq('run_id', run.id as string)}&select=score,unsafe_action_count&limit=1`,
  )
  const r = res[0]
  const unsafe = (r?.unsafe_action_count as number) ?? 0
  // The gate owns "not worse than production"; the step reports recorded + safe.
  const score = Math.round(((r?.score as number) ?? 0) * 10) / 10
  return {
    step: 'benchmark',
    status: unsafe === 0 ? 'PASS' : 'FAIL',
    reason: unsafe === 0 ? `recorded — score ${score}/100, 0 unsafe actions` : `${unsafe} unsafe action(s) in benchmark`,
    evidenceRef: run.id as string,
    sourceOfTruth: 'benchmark_runs / benchmark_results',
    at,
  }
}

/** Read the candidate's most recent shadow evidence, or drive it via the real
 *  engine driver when injected. No driver + no evidence → NOT_AVAILABLE. */
async function stepShadow(
  copilotId: string,
  versionId: string,
  at: IsoTimestamp,
  driver: ShadowReplayDriver | undefined,
): Promise<QualificationStepResult> {
  const src = 'shadow_experiments'
  const existing = await pgrest<RawRow[]>(
    'GET',
    `shadow_experiments?${eq('copilot_id', copilotId)}&${eq('candidate_version_id', versionId)}&select=id,status,candidate_verdict&order=started_at.desc&limit=1`,
  )
  const row = existing[0]
  if (row && (row.status as string) === 'completed') {
    return { step: 'shadow', ...mapShadowVerdict(row.candidate_verdict as string | null), evidenceRef: row.id as string, sourceOfTruth: src, at }
  }
  if (driver?.runShadow) {
    // Read the production baseline to compare against; a first-time candidate has none.
    const prodRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=production_version_id`)
    const productionVersionId = (prodRows[0]?.production_version_id as string | null) ?? null
    const out = await driver.runShadow({ copilotId, candidateVersionId: versionId, productionVersionId })
    if (out) {
      return { step: 'shadow', ...mapShadowVerdict(out.verdict), evidenceRef: out.evidenceId, sourceOfTruth: src, at }
    }
  }
  return {
    step: 'shadow',
    status: 'NOT_AVAILABLE',
    reason:
      'real LangGraph shadow driver not wired in this perimeter (owned by the shadow/replay engine) — ' +
      'no fixture may stand in; a production gate is never satisfied by fixture-backed shadow evidence',
    evidenceRef: null,
    sourceOfTruth: src,
    at,
  }
}

function mapShadowVerdict(verdict: string | null): { status: QualificationStepStatus; reason: string } {
  if (verdict === 'PASS') return { status: 'PASS', reason: 'shadow PASS — zero would-mutate breaches' }
  if (verdict === 'INSUFFICIENT_EVIDENCE') return { status: 'INSUFFICIENT_EVIDENCE', reason: 'shadow inconclusive' }
  if (verdict === 'FAIL') return { status: 'FAIL', reason: 'shadow FAIL' }
  return { status: 'INSUFFICIENT_EVIDENCE', reason: `shadow verdict ${verdict ?? 'unknown'}` }
}

async function stepReplay(
  copilotId: string,
  versionId: string,
  at: IsoTimestamp,
  driver: ShadowReplayDriver | undefined,
): Promise<QualificationStepResult> {
  const src = 'replay_comparisons'
  const existing = await pgrest<RawRow[]>(
    'GET',
    `replay_comparisons?${eq('copilot_id', copilotId)}&${eq('candidate_version_id', versionId)}&select=id,status,verdict&order=created_at.desc&limit=1`,
  )
  const row = existing[0]
  if (row && (row.status as string) === 'completed') {
    return { step: 'replay', ...mapReplayVerdict(row.verdict as string | null), evidenceRef: row.id as string, sourceOfTruth: src, at }
  }
  if (driver?.runReplay) {
    const prodRows = await pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=production_version_id`)
    const referenceVersionId = (prodRows[0]?.production_version_id as string | null) ?? null
    const out = await driver.runReplay({ copilotId, candidateVersionId: versionId, referenceVersionId })
    if (out) {
      return { step: 'replay', ...mapReplayVerdict(out.verdict), evidenceRef: out.evidenceId, sourceOfTruth: src, at }
    }
  }
  return {
    step: 'replay',
    status: 'NOT_AVAILABLE',
    reason:
      'real LangGraph replay driver not wired in this perimeter (owned by the shadow/replay engine) — ' +
      'no fixture may stand in; a production gate is never satisfied by fixture-backed replay evidence',
    evidenceRef: null,
    sourceOfTruth: src,
    at,
  }
}

function mapReplayVerdict(verdict: string | null): { status: QualificationStepStatus; reason: string } {
  if (verdict === 'BETTER' || verdict === 'EQUIVALENT') return { status: 'PASS', reason: `replay ${verdict}` }
  if (verdict === 'WORSE') return { status: 'FAIL', reason: 'replay WORSE than reference' }
  return { status: 'INSUFFICIENT_EVIDENCE', reason: `replay ${verdict ?? 'inconclusive'}` }
}

/**
 * The authoritative step. Delegates entirely to evaluateAndPersistPromotionGate,
 * which persists the fresh promotion_gates row the promote RPC re-reads. This
 * orchestrator adds NO verdict of its own — it reflects the gate's overall.
 */
async function stepGate(
  copilotId: string,
  versionId: string,
  policy: PromotionPolicy,
  now: () => Date,
): Promise<{ result: QualificationStepResult; promotable: boolean }> {
  const at = now().toISOString() as IsoTimestamp
  const evaluated = await evaluateAndPersistPromotionGate(copilotId, versionId, policy, now)
  if (!evaluated) {
    return {
      result: {
        step: 'gate',
        status: 'INSUFFICIENT_EVIDENCE',
        reason: 'gate could not be evaluated (copilot or candidate version not found)',
        evidenceRef: null,
        sourceOfTruth: 'promotion_gates',
        at,
      },
      promotable: false,
    }
  }
  const { result, gateEvaluationId } = evaluated
  const status: QualificationStepStatus =
    result.overall === 'PASS'
      ? 'PASS'
      : result.overall === 'FAIL'
        ? 'FAIL'
        : result.overall === 'NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : 'INSUFFICIENT_EVIDENCE'
  const blocking = result.checks
    .filter((c) => c.status !== 'PASS' && c.status !== 'NOT_CONFIGURED')
    .map((c) => `${c.label}: ${c.reason}`)
  return {
    result: {
      step: 'gate',
      status,
      reason: result.promotable ? 'all gate checks pass — promotion permitted' : `blocked: ${blocking.join('; ') || result.overall}`,
      evidenceRef: gateEvaluationId,
      sourceOfTruth: 'promotion_gates (promotion-gate.ts)',
      at,
    },
    promotable: result.promotable,
  }
}

// ── Run lifecycle ────────────────────────────────────────────────────────────

export async function getLatestQualificationRun(
  copilotId: string,
  versionId: string,
): Promise<QualificationRun | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `qualification_runs?${eq('copilot_id', copilotId)}&${eq('copilot_version_id', versionId)}&order=created_at.desc&limit=1`,
  )
  return rows[0] ? mapRun(rows[0]) : null
}

async function findRunningRun(copilotId: string, versionId: string): Promise<QualificationRun | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `qualification_runs?${eq('copilot_id', copilotId)}&${eq('copilot_version_id', versionId)}&status=eq.running&limit=1`,
  )
  return rows[0] ? mapRun(rows[0]) : null
}

async function findRunByClientRunId(copilotId: string, clientRunId: string): Promise<QualificationRun | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `qualification_runs?${eq('copilot_id', copilotId)}&${eq('client_run_id', clientRunId)}&limit=1`,
  )
  return rows[0] ? mapRun(rows[0]) : null
}

/**
 * Start (or idempotently resume) a qualification run for a candidate version.
 * Refuses a version that does not belong to the copilot (IDOR) or that is not a
 * draft/beta candidate. A double-submit — same client_run_id, or simply a run
 * already in flight for the version — returns the EXISTING run rather than
 * forking the workflow (the DB partial-unique indexes make a race safe too).
 */
export async function startQualification(
  copilotId: string,
  versionId: string,
  options: OrchestratorOptions & { clientRunId?: string } = {},
): Promise<QualificationRun> {
  const now = options.now ?? (() => new Date())
  const policy = options.policy ?? DEFAULT_PROMOTION_POLICY

  const snap = await loadCandidate(copilotId, versionId)
  if (!snap) throw new QualificationError('not_found', `copilot ${copilotId} / version ${versionId} not found`)
  if (snap.stage !== 'draft' && snap.stage !== 'beta') {
    throw new QualificationError('not_a_candidate', `version ${versionId} is ${snap.stage}, not a draft/beta candidate`)
  }

  // Idempotency: an explicit key wins; otherwise any in-flight run for the version.
  if (options.clientRunId) {
    const byKey = await findRunByClientRunId(copilotId, options.clientRunId)
    if (byKey) return byKey
  }
  const running = await findRunningRun(copilotId, versionId)
  if (running) return running

  const nowIso = now().toISOString()
  const row: RawRow = {
    id: `qual-${randomUUID()}`,
    copilot_id: copilotId,
    copilot_version_id: versionId,
    client_run_id: options.clientRunId ?? null,
    candidate_fingerprint: fingerprintCandidate(snap),
    status: 'running',
    step_cursor: 'tests',
    steps: [],
    policy,
    created_at: nowIso,
    updated_at: nowIso,
  }
  try {
    const inserted = await pgrest<RawRow[]>('POST', 'qualification_runs', row)
    return mapRun(inserted[0])
  } catch (err) {
    // A concurrent starter won the unique index (client_run_id or one-active-per-
    // version). Re-read and return the existing run — never fork.
    if (err instanceof PgrestError && err.status === 409) {
      const existing =
        (options.clientRunId ? await findRunByClientRunId(copilotId, options.clientRunId) : null) ??
        (await findRunningRun(copilotId, versionId))
      if (existing) return existing
    }
    throw err
  }
}

/**
 * Execute the run's NEXT step and advance the cursor atomically. Behaviour:
 *   - terminal run → returned unchanged.
 *   - candidate fingerprint drifted → run SUPERSEDED (candidate changed under us).
 *   - version no longer a draft/beta candidate (archived/promoted mid-flight) →
 *     run ABORTED.
 *   - a step that THROWS (infra) propagates; the cursor is NOT advanced, so a
 *     later advance re-runs exactly that step (resumable).
 *   - the compare-and-set PATCH (filtered on the current cursor + running status)
 *     makes a concurrent double-advance a no-op for the loser, which re-reads.
 */
export async function advanceQualification(
  run: QualificationRun,
  options: OrchestratorOptions = {},
): Promise<QualificationRun> {
  if (run.status !== 'running') return run
  const now = options.now ?? (() => new Date())
  const at = now().toISOString() as IsoTimestamp

  // Candidate-mutation + still-a-candidate guards, re-read live before each step.
  const snap = await loadCandidate(run.copilotId, run.copilotVersionId)
  if (!snap) {
    // The version vanished (deleted mid-flight) — the FK cascade will have removed
    // this run too, but if we still hold it, mark aborted defensively.
    return casTerminal(run, 'aborted', 'candidate version no longer exists', now)
  }
  if (snap.stage !== 'draft' && snap.stage !== 'beta') {
    return casTerminal(run, 'aborted', `candidate is now ${snap.stage} (archived/promoted during the workflow)`, now)
  }
  if (fingerprintCandidate(snap) !== run.candidateFingerprint) {
    return casTerminal(run, 'superseded', 'candidate manifest/tools/model changed while the workflow was running', now)
  }

  const cursor = run.stepCursor
  if (cursor === 'done') return run

  // Execute the step (may throw → resumable). Nothing is persisted until the CAS.
  let stepResult: QualificationStepResult
  let promotable = false
  if (cursor === 'tests') stepResult = await stepTests(run.copilotId, run.copilotVersionId, at)
  else if (cursor === 'benchmark') stepResult = await stepBenchmark(run.copilotId, run.copilotVersionId, at)
  else if (cursor === 'shadow') stepResult = await stepShadow(run.copilotId, run.copilotVersionId, at, options.driver)
  else if (cursor === 'replay') stepResult = await stepReplay(run.copilotId, run.copilotVersionId, at, options.driver)
  else {
    const gate = await stepGate(run.copilotId, run.copilotVersionId, run.policy, now)
    stepResult = gate.result
    promotable = gate.promotable
  }

  const nextCursor: QualificationCursor =
    cursor === 'gate' ? 'done' : QUALIFICATION_STEPS[QUALIFICATION_STEPS.indexOf(cursor) + 1]
  // The gate is the ONLY step that decides the run's terminal verdict; the earlier
  // steps are informational and never block the walk (the gate re-reads their
  // evidence authoritatively). No auto-promotion: 'promotable' is a state, not an act.
  const nextStatus: QualificationRunStatus =
    cursor === 'gate' ? (promotable ? 'promotable' : 'blocked') : 'running'

  const steps = [...run.steps, stepResult]
  const updated = await pgrest<RawRow[]>(
    'PATCH',
    `qualification_runs?${eq('id', run.id)}&${eq('step_cursor', cursor)}&status=eq.running`,
    { step_cursor: nextCursor, status: nextStatus, steps, updated_at: now().toISOString() },
  )
  if (updated.length === 0) {
    // Lost the CAS (a concurrent advance moved the cursor) — re-read the truth.
    const fresh = await getLatestQualificationRun(run.copilotId, run.copilotVersionId)
    return fresh ?? run
  }
  return mapRun(updated[0])
}

/** Compare-and-set a run to a terminal status (only if still running at cursor). */
async function casTerminal(
  run: QualificationRun,
  status: QualificationRunStatus,
  reason: string,
  now: () => Date,
): Promise<QualificationRun> {
  const marker: QualificationStepResult = {
    step: run.stepCursor === 'done' ? 'gate' : (run.stepCursor as QualificationStep),
    status: 'INSUFFICIENT_EVIDENCE',
    reason,
    evidenceRef: null,
    sourceOfTruth: 'qualification-orchestrator',
    at: now().toISOString() as IsoTimestamp,
  }
  const updated = await pgrest<RawRow[]>(
    'PATCH',
    `qualification_runs?${eq('id', run.id)}&status=eq.running`,
    { status, steps: [...run.steps, marker], updated_at: now().toISOString() },
  )
  if (updated.length === 0) {
    const fresh = await getLatestQualificationRun(run.copilotId, run.copilotVersionId)
    return fresh ?? { ...run, status }
  }
  return mapRun(updated[0])
}

/**
 * Start (or resume) a run and drive it to a terminal state. The sweep stops at
 * the gate — it NEVER promotes. Bounded by the step count so a stuck cursor can
 * never loop forever.
 */
export async function runQualificationSweep(
  copilotId: string,
  versionId: string,
  options: OrchestratorOptions & { clientRunId?: string } = {},
): Promise<QualificationRun> {
  let run = await startQualification(copilotId, versionId, options)
  // +2 headroom over the 5 steps for the initial state + the done transition.
  for (let i = 0; i < QUALIFICATION_STEPS.length + 2 && run.status === 'running'; i++) {
    run = await advanceQualification(run, options)
  }
  return run
}

// ── Readiness synthesis (honest — never the word "READY") ────────────────────

export interface QualificationReadiness {
  state: QualificationRunStatus | 'not_started'
  promotable: boolean
  /** An instruction/observation, phrased as a state — never a bare "READY". */
  nextAction: string
  blockers: string[]
  candidateVersionId: string | null
  runId: string | null
  steps: QualificationStepResult[]
}

export function computeReadiness(run: QualificationRun | null): QualificationReadiness {
  if (!run) {
    return {
      state: 'not_started',
      promotable: false,
      nextAction: 'Qualification not started — start it to evaluate this candidate version.',
      blockers: [],
      candidateVersionId: null,
      runId: null,
      steps: [],
    }
  }
  const base = {
    candidateVersionId: run.copilotVersionId,
    runId: run.id,
    steps: run.steps,
  }
  const blockersFromSteps = run.steps
    .filter((s) => s.status === 'FAIL' || s.status === 'INSUFFICIENT_EVIDENCE')
    .map((s) => `${s.step}: ${s.reason}`)

  switch (run.status) {
    case 'running':
      return {
        ...base,
        state: 'running',
        promotable: false,
        nextAction: `Qualification in progress — next step: ${run.stepCursor}.`,
        blockers: [],
      }
    case 'promotable':
      return {
        ...base,
        state: 'promotable',
        promotable: true,
        nextAction: 'All gate checks pass — promotion is permitted. Run the promote action to ship this version.',
        blockers: [],
      }
    case 'blocked':
      return {
        ...base,
        state: 'blocked',
        promotable: false,
        nextAction: 'Qualification blocked — resolve the failing checks, then re-run qualification.',
        blockers: blockersFromSteps,
      }
    case 'superseded':
      return {
        ...base,
        state: 'superseded',
        promotable: false,
        nextAction: 'Candidate changed during qualification — start a fresh run for the updated version.',
        blockers: ['candidate manifest/tools/model changed while the workflow was running'],
      }
    case 'aborted':
      return {
        ...base,
        state: 'aborted',
        promotable: false,
        nextAction: 'Qualification aborted — the candidate is no longer a draft/beta version. Start over on a fresh draft.',
        blockers: blockersFromSteps.length > 0 ? blockersFromSteps : ['candidate archived/promoted/removed mid-workflow'],
      }
  }
}
