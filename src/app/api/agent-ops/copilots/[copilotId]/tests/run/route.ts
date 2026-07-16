import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'
import { runTestSuite } from '@/lib/agent-mission-control/test-runner'
import type { TestRun } from '@/lib/agent-mission-control/types'

/**
 * Shape guard for ids used by this route (`:copilotId` path param and the
 * `suiteId` / `versionId` body fields). Real ids are `makeId(prefix, slug)`
 * (see slug.ts): lowercase alphanumerics/hyphens only, bounded length — the
 * same guard the sibling promotion and benchmarks/run routes apply. Rejecting
 * anything else up front gives a fast 400 on garbage/oversized input before
 * it flows into PostgREST filter URLs (here and inside runTestSuite), and no
 * valid id is ever refused.
 */
const ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * POST /api/agent-ops/copilots/:copilotId/tests/run — run a REAL test suite
 * against a copilot. Delegates to `runTestSuite`, which executes a real OpenAI
 * completion + judge per case and persists `test_runs` + `test_results` to the
 * gpu1 PostgREST perimeter (service_role, server only).
 *
 * Body: { suiteId: string; versionId?: string }
 * Response: { ok: true; testRun: TestRun }
 *
 * Errors: 400 (bad body / malformed copilotId, suiteId or versionId), 404 (copilot/suite/version not
 * found), 409 (a test run is already in progress for this suite), 503
 * (backend/env not configured), 502 (in-flight check / runner / OpenAI /
 * PostgREST). Mirrors the sibling benchmarks/run route's fail-closed style.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { suiteId?: string; versionId?: string; allowFallback?: boolean }
  try {
    const parsed: unknown = await request.json()
    // `request.json()` accepts any valid JSON value (null, a number, a string,
    // an array, a boolean) — only a plain object is a valid body here. Without
    // this guard a literal `null` body crashes the `body.suiteId` access below
    // into a 500 for what is a client fault — mirrors the tools/[toolId] and
    // projects/[id]/push-agent body-shape guard.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as { suiteId?: string; versionId?: string; allowFallback?: boolean }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.suiteId !== 'string' || body.suiteId.trim().length === 0) {
    return NextResponse.json({ error: 'suiteId is required' }, { status: 400 })
  }
  if (!ID_RE.test(body.suiteId)) {
    return NextResponse.json({ error: 'invalid suiteId' }, { status: 400 })
  }
  if (body.versionId !== undefined && (typeof body.versionId !== 'string' || !ID_RE.test(body.versionId))) {
    return NextResponse.json({ error: 'versionId must be a valid id' }, { status: 400 })
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
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: isPgrestTimeout(err) ? 504 : 502 })
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
    return NextResponse.json({ error: 'test run failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
