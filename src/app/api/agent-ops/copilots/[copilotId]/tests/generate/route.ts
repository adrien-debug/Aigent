import { NextResponse } from 'next/server'

import { ensureAgentSuites } from '@/lib/agent-mission-control/agent-suite-generator'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/copilots/:copilotId/tests/generate — generate the test +
 * benchmark suite for a copilot that has none yet. This is the recovery path
 * for agents whose create-time auto-eval failed to seed suites (0 suites → no
 * way to create one from the UI). Delegates to `ensureAgentSuites`, which runs
 * a real OpenAI completion to synthesize the suite (a few seconds is normal)
 * and persists `test_suites`/`test_cases`/`benchmark_suites` to the gpu1
 * PostgREST perimeter (service_role, server only).
 *
 * This route ONLY generates the suite — it does NOT run the tests. Running is
 * the existing "Run tests" button, which activates once the suite exists.
 *
 * Response: { ok: true; testSuiteId; benchmarkSuiteId; suiteSource; repoFit }
 * when a suite was created, or { ok: true; alreadyExists: true } when
 * `ensureAgentSuites` skipped because a suite already exists (idempotent
 * success — the UI refreshes and reads the real state).
 *
 * Errors: 400 (malformed copilotId), 404 (copilot not found), 409 (a
 * generation is already in flight for this copilot), 503 (backend/env not
 * configured), 502 (LLM / PostgREST failure). Mirrors the sibling tests/run
 * route's fail-closed style. Auth is enforced upstream by src/proxy.ts (admin
 * session OR x-amc-key) for all /api/agent-ops.
 */

/**
 * Shape guard for `:copilotId` path params — same contract as the sibling
 * copilots/[copilotId] route: real ids are `makeId('copilot', slug)` (see
 * slug.ts), lowercase alphanumerics/hyphens only, bounded length. A value that
 * doesn't match can never be a real copilot id, so 400 here is strictly a
 * fast, safe rejection before any DB/LLM round-trip.
 */
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * Double-submission guard. `ensureAgentSuites`'s own "suite already exists"
 * check is check-then-act around a multi-second LLM completion, so two
 * near-simultaneous POSTs (double-click) would BOTH pass it and persist
 * duplicate test/benchmark suites at double LLM cost. Suite generation has no
 * persisted `running` status to check (unlike the sibling tests/run route), so
 * the in-flight set lives in module scope: synchronous check-and-add in a
 * single-threaded process closes the race for this instance, and the duplicate
 * gets the same 409 shape the sibling run routes use.
 */
const inFlight = new Set<string>()

export async function POST(_request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (typeof copilotId !== 'string' || !COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  if (inFlight.has(copilotId)) {
    return NextResponse.json(
      { error: 'suite generation is already in progress for this copilot' },
      { status: 409 }
    )
  }
  inFlight.add(copilotId)

  try {
    // Returns the created suite ids, or null when it skipped. Null conflates
    // two cases the HTTP contract must keep apart: "a suite already exists"
    // (idempotent success → 200 alreadyExists) and "the copilot does not
    // exist" (→ 404, like every sibling copilot route). Disambiguate with an
    // existence check — only on the rare null path, never on the happy path.
    const suites = await ensureAgentSuites(copilotId)
    if (!suites) {
      const rows = await pgrest<Record<string, unknown>[]>(
        'GET',
        `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id&limit=1`
      )
      if (rows.length === 0) {
        return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
      }
      return NextResponse.json({ ok: true, alreadyExists: true })
    }
    return NextResponse.json({ ok: true, ...suites })
  } catch (err) {
    // ensureAgentSuites can throw on a hard PostgREST error whose detail is not
    // safe to forward; the LLM path already falls back internally. Log server
    // side, return a generic message.
    console.error('[tests/generate] failed', err)
    return NextResponse.json({ error: 'failed to generate test suite' }, { status: 502 })
  } finally {
    inFlight.delete(copilotId)
  }
}
