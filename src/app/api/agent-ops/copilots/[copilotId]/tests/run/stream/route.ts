import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'
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
 *   - `{ type: 'error', error }` if it throws. NotFoundError /
 *     ProviderUnavailableError messages are hand-authored and forwarded (the
 *     SSE analog of the JSON twin's 404/503 mapping — the 200 is already
 *     committed, so the frame carries the classification); anything else is
 *     the generic 'test run failed' (no raw error forwarded).
 *
 * Same fail-closed gates as the JSON route (env/live backend 503, double-submit
 * 409), plus every dynamic id (copilotId, suiteId, versionId) is bounded +
 * charset-checked (400) before reaching PostgREST/runTestSuite. Auth is
 * enforced upstream by `src/proxy.ts` — no auth added here, none removed.
 */
function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

// Copilot/suite/version ids are makeId() slugs (`cp-…`, `ts-…`, `ver-…`):
// lowercase alphanumeric + hyphens. Bound + charset-check every dynamic id
// before it flows into the PostgREST filter and runTestSuite (same guard
// shape as the sibling benchmarks/run and improve/decision routes).
const ID_RE = /^[a-z0-9-]{1,200}$/

export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: { suiteId?: string; versionId?: string; allowFallback?: boolean }
  try {
    body = await request.json()
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
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: isPgrestTimeout(err) ? 504 : 502 })
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
        // Frame-level analog of the JSON twin's typed mapping (the 200 + SSE
        // headers are already committed, so status can't change mid-stream):
        // NotFoundError (missing/mismatched copilot, suite, version) and
        // ProviderUnavailableError messages are hand-authored and safe to
        // forward. The generic fallback is NOT — runTestSuite's abort path can
        // embed raw PostgREST response text — so log it server-side and emit a
        // generic frame instead.
        if (err instanceof NotFoundError || err instanceof ProviderUnavailableError) {
          push({ type: 'error', error: err.message })
        } else {
          console.error('[agent-ops/copilots/tests/run/stream] test run failed', err)
          push({ type: 'error', error: 'test run failed' })
        }
      } finally {
        // If the client aborted mid-run, cancel() already released the
        // controller and close() throws — guard it like push() guards enqueue.
        const wasClosed = closed
        closed = true
        if (!wasClosed) {
          try {
            controller.close()
          } catch {
            // Controller already closed client-side — ignore.
          }
        }
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
