import { NextResponse } from 'next/server'

import { ensureAgentSuites } from '@/lib/agent-mission-control/agent-suite-generator'

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
 * Response: { ok: true; testSuiteId; benchmarkSuiteId } when a suite was
 * created, or { ok: true; alreadyExists: true } when `ensureAgentSuites`
 * skipped (a suite already exists, or the manifest context was not found — the
 * UI refreshes and reads the real state either way).
 *
 * Errors: 503 (backend/env not configured), 502 (LLM / PostgREST failure).
 * Mirrors the sibling tests/run route's fail-closed style. Auth is enforced
 * upstream by src/proxy.ts (admin session OR x-amc-key) for all /api/agent-ops.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (typeof copilotId !== 'string' || copilotId.trim().length === 0) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    // Returns the created suite ids, or null when it skipped (a suite already
    // exists, or the manifest context was not found). Null is not an error —
    // the UI refreshes and renders whatever state actually persisted.
    const suites = await ensureAgentSuites(copilotId)
    if (!suites) {
      return NextResponse.json({ ok: true, alreadyExists: true })
    }
    return NextResponse.json({ ok: true, ...suites })
  } catch (err) {
    // ensureAgentSuites can throw on a hard PostgREST error whose detail is not
    // safe to forward; the LLM path already falls back internally. Log server
    // side, return a generic message.
    console.error('[tests/generate] failed', err)
    return NextResponse.json({ error: 'failed to generate test suite' }, { status: 502 })
  }
}
