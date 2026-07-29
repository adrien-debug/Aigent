import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest, PgrestError } from '@/lib/agent-mission-control/postgrest'
import { runShadowExperiment } from '@/lib/agent-mission-control/shadow'
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
 * `useFixture` default true (or omitted) drives the REAL runShadowExperiment
 * engine through the deterministic, $0, zero-network `makeFixtureShadowAgent`
 * (the same one prove-factory-e2e.ts uses) — the ONLY evidence this route
 * produces today. `useFixture:false` is refused (501): see the
 * PRODUCT-READINESS NOTE below.
 *
 * PRODUCT-READINESS NOTE (2026-07-25): a real (billed, non-fixture) shadow run
 * needs shadow.ts's per-tool-call `ShadowToolGate` seam wired into the
 * candidate's OWN runtime — the direct/model-router runner
 * (`executeCopilotRun`) does not expose that seam, and substituting it in for
 * a langgraph candidate would institutionalize a runtime that never evaluates
 * the candidate's actual manifest. Real execution needs the LangGraph
 * ephemeral-assistant seam (`ensureCandidateAssistant`,
 * feat/deterministic-evidence-001) wired to a `ShadowRunAgent`-shaped
 * callback — not yet done. Until it lands, this route is fixture-only by
 * design; see docs/factory-shadow-replay-001.md.
 *
 * Idempotence: a partial UNIQUE index (migration 0034) on
 * shadow_experiments(copilot_id, candidate_version_id) WHERE status IN
 * ('queued','running') is the REAL concurrency control — this route does not
 * rely on a check-then-act guard. Two concurrent POSTs for the same candidate
 * race at the DATABASE; the loser's insert hits 23505 (PgrestError 409 here)
 * and gets a structured 409, never a second in-flight shadow.
 *
 * NOTE on persistence: this route does NOT call shadow.ts's
 * `persistShadowExperiment` (which POSTs a brand-new row) — it PATCHes the
 * row it already reserved above (the queued placeholder), because the insert
 * IS the concurrency guard. Reusing persistShadowExperiment here would insert
 * a second row and defeat the reservation.
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

  // Refuse BEFORE reserving a row — see the PRODUCT-READINESS NOTE above.
  // Checked here (not after the reservation below) so a refused request never
  // leaves an orphaned queued row occupying the one-inflight-per-candidate slot.
  if (body.useFixture === false) {
    return NextResponse.json(
      {
        error:
          'real (non-fixture) shadow execution is not wired yet — it requires the LangGraph ephemeral-assistant seam (ensureCandidateAssistant, feat/deterministic-evidence-001) wired to a per-tool-call ShadowToolGate callback. Omit useFixture (or pass true) for the deterministic $0 product proof.',
        code: 'REAL_EXECUTION_NOT_WIRED',
      },
      { status: 501 }
    )
  }

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
      sampled_run_count: 0,
      agreement_rate: 0,
      agreement_threshold: 0.95,
      unsafe_proposal_count: 0,
      would_mutate_count: 0,
      mismatches: [],
      triggered_by: 'agent-ops-api',
      // PR #22 rework: this route is fixture-only (useFixture:false is
      // refused above, before this reservation) — the row MUST say so,
      // never leave the DB default (legacy_unknown) to stand in for it, so
      // the promotion gate's provenance check reads the true source.
      execution_mode: 'deterministic_fixture',
    })
  } catch (err) {
    if (err instanceof PgrestError && err.status === 409) {
      return NextResponse.json({ error: 'shadow already in progress for this candidate', status: 409 }, { status: 409 })
    }
    console.error('[shadow route] failed to reserve shadow row', err)
    return NextResponse.json({ error: 'failed to launch shadow experiment' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  await emitShadowTelemetry({ eventType: 'shadow_started', copilotId, candidateVersionId: versionId, experimentId })

  try {
    // Fixture-only today (see the PRODUCT-READINESS NOTE atop this file) — the
    // useFixture:false request was already refused, before the row above was
    // reserved, so this is never conditional.
    const runAgent = makeFixtureShadowAgent()

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
 *     sampledRunCount: number, wouldMutateCount: number,
 *     startedAt: string, endsAt: string | null,
 *   }}
 *   `executionMode` (migration 0034, PR #22 rework) is ALWAYS
 *   'deterministic_fixture' today — this route has no live_langgraph path
 *   yet (see the PRODUCT-READINESS NOTE above). A caller (the Release UI)
 *   MUST label this evidence as a simulation, never as a production proof —
 *   the promotion gate itself refuses to accept anything but
 *   'live_langgraph' for a REQUIRED check (promotion-gate.ts shadowCheck).
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
            sampledRunCount: row.sampled_run_count ?? 0,
            wouldMutateCount: row.would_mutate_count ?? 0,
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
