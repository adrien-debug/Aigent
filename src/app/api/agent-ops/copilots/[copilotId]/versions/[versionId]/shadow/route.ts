import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest, PgrestError } from '@/lib/agent-mission-control/postgrest'
import { runShadowExperiment } from '@/lib/agent-mission-control/shadow'
import { makeLiveShadowAgent } from '@/lib/agent-mission-control/shadow-live'
import { makeFixtureShadowAgent } from '@/lib/agent-mission-control/promotion-fixtures'
import { emitShadowTelemetry } from '@/lib/agent-mission-control/runtime-telemetry-store'
import {
  isValidId,
  liveBackendConfigured,
  loadOwnedVersion,
  readVersionStage,
  resolveCorpus,
} from '@/lib/agent-mission-control/shadow-replay-routes-shared'

/**
 * POST /api/agent-ops/copilots/:copilotId/versions/:versionId/shadow — launch
 * a shadow experiment proving `versionId` as a CANDIDATE, with zero external
 * effect (every mutating tool call is gated, see shadow.ts). Body:
 *   { inputs?: unknown[], useFixture?: boolean }
 *
 * Two execution modes (AIGENT-FACTORY-READY-001):
 *   - `useFixture` omitted/true → the deterministic, $0, zero-network
 *     `makeFixtureShadowAgent` drives the REAL runShadowExperiment engine.
 *     Evidence is stamped `execution_mode: 'deterministic_fixture'`.
 *   - `useFixture:false` → the REAL LangGraph run of the candidate via its
 *     ephemeral assistant (shadow-live.ts `makeLiveShadowAgent`). Evidence is
 *     stamped `execution_mode: 'live_langgraph'` — the ONLY mode a REQUIRED
 *     promotion-gate shadow check accepts (a fixture never gates production).
 *     Write-safety on the live path: mutating tools require confirmation and the
 *     run never confirms → they interrupt (never execute); the ShadowToolGate
 *     records them as would-mutate.
 *
 * Idempotence: a partial UNIQUE index (migration 0034) on
 * shadow_experiments(copilot_id, candidate_version_id) WHERE status IN
 * ('queued','running') is the REAL concurrency control — this route does not
 * rely on a check-then-act guard. Two concurrent POSTs for the same candidate
 * race at the DATABASE; the loser's insert hits 23505 (PgrestError 409 here)
 * and gets a structured 409, never a second in-flight shadow.
 *
 * NOTE on persistence: this route PATCHes the row it already reserved above
 * (the queued placeholder), because the insert IS the concurrency guard.
 * Inserting a second row here would defeat the reservation.
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
    return NextResponse.json({ error: 'candidate version is archived — cannot shadow an archived version', stage: owned.stage }, { status: 409 })
  }

  const corpus = resolveCorpus(body)
  if (!corpus.ok) {
    return NextResponse.json(
      { error: 'INSUFFICIENT_EVIDENCE: corpus (inputs/cases) was explicitly empty — refusing rather than silently substituting a default', code: 'INSUFFICIENT_EVIDENCE' },
      { status: 422 }
    )
  }

  // AIGENT-FACTORY-READY-001: real (non-fixture) shadow execution IS now wired.
  //   useFixture omitted/true → deterministic $0 fixture proof (deterministic_fixture)
  //   useFixture:false        → REAL LangGraph run of the candidate through its
  //                             ephemeral assistant (live_langgraph) — the ONLY
  //                             mode a REQUIRED promotion-gate shadow check accepts.
  // Write-safety on the live path: mutating tools require confirmation and the run
  // never confirms → they interrupt (never execute); the ShadowToolGate records
  // them as would-mutate. See shadow-live.ts.
  const useFixture = body.useFixture !== false
  const executionMode = useFixture ? 'deterministic_fixture' : 'live_langgraph'

  // Reserve the in-progress row FIRST — this insert IS the concurrency
  // control (migration 0034's partial unique index). A concurrent duplicate
  // POST for the same candidate fails here with 23505.
  const experimentId = `shadow-${randomUUID()}`
  const startedAt = new Date().toISOString()
  try {
    await pgrest('POST', 'shadow_experiments', {
      id: experimentId,
      copilot_id: copilotId,
      name: `shadow ${versionId}`,
      production_version_id: owned.productionVersionId ?? versionId,
      candidate_version_id: versionId,
      started_at: startedAt,
      ends_at: null,
      status: 'queued',
      sampled_run_count: null,
      agreement_rate: null,
      agreement_threshold: 0.95,
      unsafe_proposal_count: null,
      would_mutate_count: null,
      mismatches: [],
      triggered_by: 'agent-ops-api',
      // The row records its TRUE provenance (never the DB default legacy_unknown):
      // 'live_langgraph' for a real candidate run, 'deterministic_fixture' for the
      // $0 proof. The promotion gate's provenance check reads exactly this.
      execution_mode: executionMode,
    })
  } catch (err) {
    if (err instanceof PgrestError && err.status === 409) {
      return NextResponse.json({ error: 'shadow already in progress for this candidate', status: 409 }, { status: 409 })
    }
    console.error('[shadow route] failed to reserve shadow row', err)
    return NextResponse.json({ error: 'failed to launch shadow experiment' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  await emitShadowTelemetry({ eventType: 'shadow_started', copilotId, candidateVersionId: versionId, experimentId })

  // On the live path, provision the ephemeral candidate assistant; tear it down in
  // `finally` no matter how the run ends.
  let liveCleanup: (() => Promise<void>) | null = null
  try {
    // Fixture ($0, deterministic) OR a REAL LangGraph run of the candidate.
    let runAgent
    if (useFixture) {
      runAgent = makeFixtureShadowAgent()
    } else {
      const live = await makeLiveShadowAgent(versionId)
      runAgent = live.runAgent
      liveCleanup = live.cleanup
    }

    // Read-relate-write: re-check the candidate hasn't become archived WHILE
    // the corpus ran, before persisting evidence — a version that got
    // archived mid-flight must never have a stale PASS written for it.
    const record = await runShadowExperiment({
      copilotId,
      productionVersionId: owned.productionVersionId ?? versionId,
      candidateVersionId: versionId,
      inputs: corpus.inputs,
      runAgent,
    })

    const stageNow = await readVersionStage(versionId)
    if (stageNow === 'archived') {
      await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(experimentId)}`, {
        status: 'stopped',
        ends_at: new Date().toISOString(),
      })
      return NextResponse.json(
        { error: 'candidate version was archived mid-execution — shadow evidence refused, not persisted as a stale PASS', experimentId },
        { status: 409 }
      )
    }

    await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(experimentId)}`, {
      status: 'completed',
      ends_at: record.endsAt,
      sampled_run_count: record.sampledRunCount,
      would_mutate_count: record.wouldMutateCount,
      candidate_verdict: record.verdict,
      mismatches: record.results.map((r) => ({ input: r.input, ok: r.ok, wouldMutate: r.wouldMutateCount, error: r.error })),
    })

    await emitShadowTelemetry({
      eventType: 'shadow_completed',
      copilotId,
      candidateVersionId: versionId,
      experimentId,
      verdict: record.verdict,
      wouldMutateCount: record.wouldMutateCount,
    })

    return NextResponse.json({
      ok: true,
      experimentId,
      verdict: record.verdict,
      sampledRunCount: record.sampledRunCount,
      wouldMutateCount: record.wouldMutateCount,
    })
  } catch (err) {
    console.error('[shadow route] shadow execution failed', err)
    try {
      await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(experimentId)}`, {
        status: 'stopped',
        ends_at: new Date().toISOString(),
      })
    } catch {
      // best-effort cleanup only — never mask the original failure
    }
    return NextResponse.json({ error: 'shadow execution failed', experimentId }, { status: isPgrestTimeout(err) ? 504 : 502 })
  } finally {
    // Best-effort teardown of the ephemeral candidate assistant (live path only).
    if (liveCleanup) await liveCleanup().catch(() => {})
  }
}

/**
 * GET /api/agent-ops/copilots/:copilotId/versions/:versionId/shadow — read the
 * latest shadow evidence for this exact candidate (does not launch anything).
 *
 * RESPONSE CONTRACT (stable, documented so another agent can consume it
 * without reading this file):
 *   200 { ok: true, experiment: null | {
 *     id: string, status: 'queued'|'running'|'completed'|'stopped'|'failed',
 *     verdict: 'PASS'|'FAIL'|'INSUFFICIENT_EVIDENCE'|null,
 *     executionMode: 'live_langgraph'|'deterministic_fixture'|'legacy_unknown',
 *     sampledRunCount: number | null, wouldMutateCount: number | null,
 *     startedAt: string, endsAt: string | null,
 *   }}
 *   `executionMode` (migration 0034/0037) reflects the LAST run's true source:
 *   'live_langgraph' (a real candidate run via useFixture:false),
 *   'deterministic_fixture' (the $0 default), or 'legacy_unknown' (pre-migration
 *   rows). The Release UI MUST label a 'deterministic_fixture' result as a
 *   simulation; the promotion gate accepts ONLY 'live_langgraph' for a REQUIRED
 *   check (promotion-gate.ts shadowCheck).
 *   400 { error } invalid ids · 404 { error } version not found/IDOR ·
 *   503 { error } backend not configured · 502/504 on upstream failure.
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
      `shadow_experiments?copilot_id=eq.${encodeURIComponent(copilotId)}&candidate_version_id=eq.${encodeURIComponent(versionId)}&select=id,status,candidate_verdict,sampled_run_count,would_mutate_count,started_at,ends_at,execution_mode&order=started_at.desc&limit=1`
    )
    const row = rows[0] ?? null
    return NextResponse.json({
      ok: true,
      experiment: row
        ? {
            id: row.id,
            status: row.status,
            verdict: row.candidate_verdict ?? null,
            executionMode: row.execution_mode ?? 'legacy_unknown',
            sampledRunCount: (row.sampled_run_count as number | null | undefined) ?? null,
            wouldMutateCount: (row.would_mutate_count as number | null | undefined) ?? null,
            startedAt: row.started_at,
            endsAt: row.ends_at ?? null,
          }
        : null,
    })
  } catch (err) {
    console.error('[shadow route GET] failed to read shadow evidence', err)
    return NextResponse.json({ error: 'failed to read shadow evidence' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
