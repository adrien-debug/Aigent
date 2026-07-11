import { NextResponse } from 'next/server'

import { NotFoundError } from '@/lib/agent-mission-control/runner-errors'
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
 * found), 503 (backend/env not configured), 502 (runner/OpenAI/PostgREST).
 * Mirrors the run/promotion routes' fail-closed style.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

  let body: { suiteId?: string; versionId?: string }
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

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const testRun: TestRun = await runTestSuite({
      copilotId,
      suiteId: body.suiteId,
      versionId: body.versionId,
    })
    return NextResponse.json({ ok: true, testRun })
  } catch (err) {
    // Missing/mismatched copilot, suite or version → 404 (typed); everything
    // else (OpenAI / PostgREST / mid-run abort) → 502.
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'test run failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
