import { NextResponse } from 'next/server'

import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'
import { runTestSuite } from '@/lib/agent-mission-control/test-runner'
import type { TestRun } from '@/lib/agent-mission-control/types'

/**
 * POST /api/agent-ops/copilots/:copilotId/tests/run — run a REAL test suite
 * against a copilot. Delegates to `runTestSuite`, which executes a real OpenAI
 * completion + judge per case and persists `test_runs` + `test_results` to the
 * gpu1 PostgREST perimeter (service_role, server only).
 *
 * Body: { suiteId: string; versionId?: string }
 * Response: { ok: true; testRun: TestRun }
 *
 * Errors: 400 (missing suiteId / bad body), 404 (copilot/suite/version not
 * found), 409 (a test run is already in progress for this suite), 503
 * (backend/env not configured), 502 (in-flight check / runner / OpenAI /
 * PostgREST). Mirrors the sibling benchmarks/run route's fail-closed style.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  let body: { suiteId?: string; versionId?: string; allowFallback?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.suiteId !== 'string' || body.suiteId.trim().length === 0) {
    return NextResponse.json({ error: 'suiteId is required' }, { status: 400 })
  }
  if (body.versionId !== undefined && typeof body.versionId !== 'string') {
    return NextResponse.json({ error: 'versionId must be a string' }, { status: 400 })
  }
  if (body.allowFallback !== undefined && typeof body.allowFallback !== 'boolean') {
    return NextResponse.json({ error: 'allowFallback must be a boolean' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // Double-submit / concurrent-run guard (same read-then-branch shape as the
  // sibling benchmarks/run route): a test run for this suite persists as
  // `running` until runTestSuite finishes it `completed`/`aborted`. If one is
  // already in flight for this suite, reject the duplicate instead of
  // silently kicking off a second concurrent run against the same
  // copilot/suite (double cost, double writes, and two runs racing to PATCH
  // the same suite's last_run_id). This narrows — but, being check-then-act,
  // does not fully close — the race between two requests arriving at nearly
  // the same instant.
  try {
    const runningRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `test_runs?suite_id=eq.${encodeURIComponent(body.suiteId)}&copilot_id=eq.${encodeURIComponent(copilotId)}&status=eq.running&select=id&limit=1`
    )
    if (runningRows.length > 0) {
      return NextResponse.json(
        { error: 'a test run is already in progress for this suite', runId: runningRows[0].id },
        { status: 409 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/copilots/tests/run] failed to check for an in-flight run', err)
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: 502 })
  }

  try {
    const testRun: TestRun = await runTestSuite({
      copilotId,
      suiteId: body.suiteId,
      versionId: body.versionId,
      allowFallback: body.allowFallback,
    })
    return NextResponse.json({ ok: true, testRun })
  } catch (err) {
    // Typed mapping: missing/mismatched resource → 404; provider env not
    // configured → 503; everything else (model access / OpenAI / PostgREST /
    // mid-run abort) → 502. NotFoundError/ProviderUnavailableError messages
    // are hand-authored and safe to forward; the generic fallback is NOT —
    // runTestSuite's abort path can embed raw PostgREST response detail, so
    // log it server-side and return a generic message instead.
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[agent-ops/copilots/tests/run] test run failed', err)
    return NextResponse.json({ error: 'test run failed' }, { status: 502 })
  }
}
