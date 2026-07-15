import { NextResponse } from 'next/server'

import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { runTestSuite, type TestRunEvent } from '@/lib/agent-mission-control/test-runner'
import type { TestRun } from '@/lib/agent-mission-control/types'

/**
 * POST /api/agent-ops/copilots/:copilotId/tests/run/stream — the streaming twin
 * of `tests/run/route.ts`. Same real execution (LangGraph graph per case +
 * OpenAI judge, persisted to `test_runs`/`test_results`) but delivered as a
 * `text/event-stream`: each `TestRunEvent` `runTestSuite` emits is pushed as it
 * happens so the operator watches the run advance case-by-case instead of
 * blocking ~68s on the final JSON.
 *
 * Body: { suiteId: string; versionId?: string }
 * SSE frames (`data: {...}\n\n`):
 *   - the `TestRunEvent` union (run-started / case-started / case-completed /
 *     run-finished) as each is emitted, then
 *   - a terminal `{ type: 'done', testRun }` once the run resolves, OR
 *   - `{ type: 'error' }` if it throws (generic — no raw error forwarded).
 *
 * Same fail-closed gates as the JSON route (id-implicit via PostgREST, env/live
 * backend 503, double-submit 409). Auth is enforced upstream by `src/proxy.ts`
 * — no auth added here, none removed.
 */
function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

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
  const suiteId = body.suiteId
  const versionId = body.versionId
  const allowFallback = body.allowFallback

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // Double-submit / concurrent-run guard — identical to the JSON route. A test
  // run for this suite persists as `running` until runTestSuite finishes it, so
  // reject a duplicate rather than kick off a second concurrent run (double
  // cost/writes, two runs racing to PATCH last_run_id). Check-then-act narrows
  // but does not fully close the near-simultaneous race.
  try {
    const runningRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `test_runs?suite_id=eq.${encodeURIComponent(suiteId)}&copilot_id=eq.${encodeURIComponent(copilotId)}&status=eq.running&select=id&limit=1`
    )
    if (runningRows.length > 0) {
      return NextResponse.json(
        { error: 'a test run is already in progress for this suite', runId: runningRows[0].id },
        { status: 409 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/copilots/tests/run/stream] failed to check for an in-flight run', err)
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: 502 })
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseEvent(payload)))
        } catch {
          // Controller already closed client-side (e.g. aborted) — ignore.
        }
      }

      try {
        const testRun: TestRun = await runTestSuite({
          copilotId,
          suiteId,
          versionId,
          allowFallback,
          // Stream each per-case milestone as it happens. `TestRunEvent` is a
          // discriminated union; forwarded verbatim as its own SSE frame.
          onEvent: (ev: TestRunEvent) => push(ev),
        })
        // Terminal frame — the persisted run, so the client can reconcile
        // (badge + router.refresh to re-read the run tables) without a second
        // round-trip.
        push({ type: 'done', testRun })
      } catch (err) {
        // Never forward raw error detail (runTestSuite's abort path can embed
        // raw PostgREST response text) — log server-side, emit a generic frame.
        console.error('[agent-ops/copilots/tests/run/stream] test run failed', err)
        push({ type: 'error', error: 'test run failed' })
      } finally {
        closed = true
        controller.close()
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
