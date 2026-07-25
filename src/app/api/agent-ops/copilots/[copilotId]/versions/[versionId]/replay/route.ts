import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest, PgrestError } from '@/lib/agent-mission-control/postgrest'
import { runReplayComparison, persistReplayComparison, type ReplayOutcome, type ReplayRunner } from '@/lib/agent-mission-control/replay'
import { makeLiveReplayRunner } from '@/lib/agent-mission-control/replay-live'
import { emitReplayTelemetry } from '@/lib/agent-mission-control/runtime-telemetry-store'
import {
  isValidId,
  liveBackendConfigured,
  loadOwnedVersion,
  readVersionStage,
  resolveCorpus,
} from '@/lib/agent-mission-control/shadow-replay-routes-shared'

/** A deterministic $0 fixture outcome — mirrors prove-factory-e2e.ts's replay fixture. */
function fixtureOutcome(better: boolean): ReplayOutcome {
  return {
    ok: true,
    outputShape: '{words,chars}',
    score: better ? 0.95 : 0.9,
    toolsCalled: ['count_words'],
    unsafeActions: 0,
    latencyMs: 5,
    costUsd: 0,
  }
}

/**
 * POST /api/agent-ops/copilots/:copilotId/versions/:versionId/replay — replay
 * a corpus on the copilot's current PRODUCTION version (reference) and on
 * `versionId` (candidate), and persist a functional comparison bound to this
 * exact candidate (candidate_version_id — migration 0030's fix, still honored
 * here: a replay produced for candidate A must never satisfy candidate B).
 *
 * Body: { inputs?: unknown[], useFixture?: boolean }. Two execution modes
 * (AIGENT-FACTORY-READY-001):
 *   - `useFixture` omitted/true → the deterministic $0 fixture path.
 *     `execution_mode: 'deterministic_fixture'`.
 *   - `useFixture:false` → BOTH the reference (production) and the candidate are
 *     run through the REAL LangGraph runtime via their ephemeral assistants
 *     (replay-live.ts `makeLiveReplayRunner`). `execution_mode: 'live_langgraph'`
 *     — the ONLY mode a REQUIRED promotion-gate replay check accepts. Same
 *     write-safety as live shadow (mutating tools interrupt, never execute).
 *     Requires a production version to compare against (else 409).
 *
 * Idempotence: partial UNIQUE index (migration 0034) on
 * replay_comparisons(copilot_id, candidate_version_id) WHERE status IN
 * ('queued','running') — same real DB-layer concurrency control as shadow.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ copilotId: string; versionId: string }> }
) {
  const { copilotId, versionId } = await params
  if (!isValidId(copilotId) || !isValidId(versionId)) {
    return NextResponse.json({ error: 'invalid copilotId or versionId' }, { status: 400 })
  }
  if (!liveBackendConfigured()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: { inputs?: unknown; cases?: unknown; useFixture?: boolean }
  try {
    const parsed: unknown = await request.json().catch(() => ({}))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const owned = await loadOwnedVersion(copilotId, versionId)
  if (!owned) {
    return NextResponse.json({ error: 'version not found' }, { status: 404 })
  }
  if (owned.stage === 'archived') {
    return NextResponse.json({ error: 'candidate version is archived — cannot replay an archived version', stage: owned.stage }, { status: 409 })
  }
  const referenceVersionId = owned.productionVersionId
  if (!referenceVersionId) {
    return NextResponse.json({ error: 'copilot has no production version to replay against yet' }, { status: 409 })
  }

  const corpus = resolveCorpus(body)
  if (!corpus.ok) {
    return NextResponse.json(
      { error: 'INSUFFICIENT_EVIDENCE: corpus (inputs/cases) was explicitly empty — refusing rather than silently substituting a default', code: 'INSUFFICIENT_EVIDENCE' },
      { status: 422 }
    )
  }

  // AIGENT-FACTORY-READY-001: real (non-fixture) replay execution IS now wired.
  //   useFixture omitted/true → deterministic $0 fixture proof (deterministic_fixture)
  //   useFixture:false        → REAL LangGraph runs of BOTH the reference and the
  //                             candidate via their ephemeral assistants (live_langgraph)
  //                             — the ONLY mode a REQUIRED promotion-gate replay check accepts.
  const useFixture = body.useFixture !== false
  const executionMode = useFixture ? 'deterministic_fixture' : 'live_langgraph'

  const comparisonId = `replay-${randomUUID()}`
  const createdAt = new Date().toISOString()
  try {
    await pgrest('POST', 'replay_comparisons', {
      id: comparisonId,
      copilot_id: copilotId,
      source_run_id: referenceVersionId,
      candidate_version_id: versionId,
      created_at: createdAt,
      status: 'queued',
      case_count: 0,
      candidates: [],
      triggered_by: 'agent-ops-api',
      // Records the TRUE provenance (never the DB default legacy_unknown):
      // 'live_langgraph' for a real run of both sides, 'deterministic_fixture' for
      // the $0 proof. The promotion gate's provenance check reads exactly this.
      execution_mode: executionMode,
    })
  } catch (err) {
    if (err instanceof PgrestError && err.status === 409) {
      return NextResponse.json({ error: 'replay already in progress for this candidate', status: 409 }, { status: 409 })
    }
    console.error('[replay route] failed to reserve replay row', err)
    return NextResponse.json({ error: 'failed to launch replay comparison' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  await emitReplayTelemetry({ eventType: 'replay_started', copilotId, candidateVersionId: versionId, comparisonId })

  // On the live path, provision BOTH versions' ephemeral assistants; tear them
  // down in `finally` no matter how the run ends.
  let liveCleanups: Array<() => Promise<void>> = []
  try {
    // Fixture ($0, deterministic) OR REAL LangGraph runs of reference + candidate.
    let runReference: ReplayRunner
    let runCandidate: ReplayRunner
    if (useFixture) {
      runReference = async () => fixtureOutcome(false)
      runCandidate = async () => fixtureOutcome(true)
    } else {
      // Track each cleanup the moment its assistant is provisioned, so the
      // reference assistant is still torn down if the candidate provision throws.
      const ref = await makeLiveReplayRunner(referenceVersionId)
      liveCleanups = [ref.cleanup]
      const cand = await makeLiveReplayRunner(versionId)
      liveCleanups.push(cand.cleanup)
      runReference = ref.run
      runCandidate = cand.run
    }

    const record = await runReplayComparison({
      copilotId,
      referenceVersionId,
      candidateVersionId: versionId,
      inputs: corpus.inputs,
      runReference,
      runCandidate,
    })

    // Read-relate-write: refuse to persist if the candidate was archived while
    // the corpus ran — never let a stale PASS/EQUIVALENT/BETTER land after
    // the version stopped being a legitimate promotion candidate.
    const stageNow = await readVersionStage(versionId)
    if (stageNow === 'archived') {
      await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(comparisonId)}`, { status: 'diverged' })
      return NextResponse.json(
        { error: 'candidate version was archived mid-execution — replay evidence refused, not persisted as a stale verdict', comparisonId },
        { status: 409 }
      )
    }

    const finalId = await persistReplayComparison(record)
    // persistReplayComparison POSTs a fresh row (id=record.id) rather than
    // updating the reserved placeholder — reconcile: keep our reserved
    // `comparisonId` as the row of record for idempotence, but if the ids
    // differ we PATCH the placeholder with the persisted result's fields and
    // best-effort delete the extra insert.
    if (finalId !== comparisonId) {
      const [fresh] = await pgrest<Record<string, unknown>[]>('GET', `replay_comparisons?id=eq.${encodeURIComponent(finalId)}&select=status,case_count,candidates,verdict`)
      await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(comparisonId)}`, {
        status: fresh?.status ?? 'matched',
        case_count: fresh?.case_count ?? record.caseCount,
        candidates: fresh?.candidates ?? record.cases.map((c) => ({ comparison: c.comparison, note: c.note })),
        verdict: fresh?.verdict ?? record.verdict,
      })
      await pgrest('DELETE', `replay_comparisons?id=eq.${encodeURIComponent(finalId)}`).catch(() => {})
    }

    await emitReplayTelemetry({ eventType: 'replay_completed', copilotId, candidateVersionId: versionId, comparisonId, verdict: record.verdict })

    return NextResponse.json({
      ok: true,
      comparisonId,
      verdict: record.verdict,
      caseCount: record.caseCount,
    })
  } catch (err) {
    console.error('[replay route] replay execution failed', err)
    try {
      await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(comparisonId)}`, { status: 'diverged' })
    } catch {
      // best-effort cleanup only
    }
    return NextResponse.json({ error: 'replay execution failed', comparisonId }, { status: isPgrestTimeout(err) ? 504 : 502 })
  } finally {
    // Best-effort teardown of both ephemeral assistants (live path only).
    for (const cleanup of liveCleanups) await cleanup().catch(() => {})
  }
}

/**
 * GET /api/agent-ops/copilots/:copilotId/versions/:versionId/replay — read the
 * latest replay evidence for this exact candidate.
 *
 * RESPONSE CONTRACT (stable, documented for other consumers):
 *   200 { ok: true, comparison: null | {
 *     id: string, status: 'draft'|'queued'|'running'|'ready'|'diverged'|'matched'|'failed',
 *     verdict: 'BETTER'|'EQUIVALENT'|'WORSE'|'INCONCLUSIVE'|null,
 *     executionMode: 'live_langgraph'|'deterministic_fixture'|'legacy_unknown',
 *     caseCount: number, createdAt: string,
 *   }}
 *   `executionMode` (migration 0034/0037) reflects the LAST run's true source
 *   ('live_langgraph' via useFixture:false, 'deterministic_fixture' default, or
 *   'legacy_unknown' pre-migration). The Release UI MUST label a
 *   'deterministic_fixture' result as a simulation; the promotion gate accepts
 *   ONLY 'live_langgraph' for a REQUIRED check
 *   (promotion-gate.ts replayCheck).
 *   400/404/503/502/504 — same contract as the shadow GET.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ copilotId: string; versionId: string }> }
) {
  const { copilotId, versionId } = await params
  if (!isValidId(copilotId) || !isValidId(versionId)) {
    return NextResponse.json({ error: 'invalid copilotId or versionId' }, { status: 400 })
  }
  if (!liveBackendConfigured()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  const owned = await loadOwnedVersion(copilotId, versionId)
  if (!owned) {
    return NextResponse.json({ error: 'version not found' }, { status: 404 })
  }
  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `replay_comparisons?copilot_id=eq.${encodeURIComponent(copilotId)}&candidate_version_id=eq.${encodeURIComponent(versionId)}&select=id,status,verdict,case_count,created_at,execution_mode&order=created_at.desc&limit=1`
    )
    const row = rows[0] ?? null
    return NextResponse.json({
      ok: true,
      comparison: row
        ? {
            id: row.id,
            status: row.status,
            verdict: row.verdict ?? null,
            executionMode: row.execution_mode ?? 'legacy_unknown',
            caseCount: row.case_count ?? 0,
            createdAt: row.created_at,
          }
        : null,
    })
  } catch (err) {
    console.error('[replay route GET] failed to read replay evidence', err)
    return NextResponse.json({ error: 'failed to read replay evidence' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
