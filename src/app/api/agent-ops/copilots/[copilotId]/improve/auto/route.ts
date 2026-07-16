import { NextResponse } from 'next/server'

import {
  runAutoImprovementCycle,
  type AutoImproveEvent,
  type AutoImprovementResult,
} from '@/lib/agent-mission-control/improvement-loop'
import { pgrest } from '@/lib/agent-mission-control/postgrest'

/** The SSE frames this route emits: the per-step events + a terminal done/error. */
type AutoFrame =
  | AutoImproveEvent
  | ({ type: 'done' } & AutoImprovementResult)
  | { type: 'error'; error: string }

/**
 * POST /api/agent-ops/copilots/:copilotId/improve/auto — the streaming driver
 * for the AUTO improvement loop. It runs `runAutoImprovementCycle`, which loops
 * analyze → create-V2 → re-run → compare until convergence / plateau / limit /
 * budget, STOPPING BEFORE the human approval step (never approves, never
 * promotes). The whole cycle can take SEVERAL MINUTES (N iterations × real
 * LangGraph runs + OpenAI completions), so it is delivered as a
 * `text/event-stream`: each `AutoImproveEvent` is pushed the instant the loop
 * emits it (via the `onEvent` sink), never batched — the operator watches
 * iteration-start / analyzed / v2-created / reran / converged / plateau /
 * exhausted advance live instead of blocking on the final JSON.
 *
 * Body (optional): { maxIterations?: number; maxCostUsd?: number }
 *   maxIterations bounded 1..10, maxCostUsd bounded 0.1..10; absent → the
 *   function's own defaults (5 iterations, $2.0).
 *
 * SSE frames (`data: {...}\n\n`):
 *   - the `AutoImproveEvent` union as each is emitted, then
 *   - a terminal `{ type: 'done', ...result }` (result = iterations /
 *     finalPassRate / stoppedBy / lastProposalId / lastV2VersionId), OR
 *   - `{ type: 'error' }` if the loop throws (generic — no raw error forwarded).
 *
 * Same fail-closed gate as the sibling improve/analyze + tests/run/stream
 * routes (env + live gpu1 backend + OpenAI). Auth is enforced upstream by
 * `src/proxy.ts` — no auth added here, none removed. Pre-stream errors are
 * HTTP statuses: 400 (bad id/body), 503 (backend/OpenAI env missing),
 * 404 (copilot not found), 502 (existence check failed upstream), 409 (a
 * cycle already running for the same copilot — double-submission) — all
 * before anything mutates; only mid-stream failures are SSE frames.
 */

// Same id shape family as the sibling improve/promotion routes — fast 400 on
// garbage, and it closes the PostgREST filter-syntax hazard.
const ID_RE = /^[a-z0-9-]{1,200}$/

// In-flight guard: ONE auto cycle per copilot per process. The cycle mutates
// `latest_version_id` + proposal rows for several minutes — two concurrent
// loops on the same copilot would race each other's V2 chain and double the
// LLM spend. Double-submission → 409 (same family as the sibling analyze
// route's open-cycle 409); released when the loop settles. A client abort
// (`request.signal`) is forwarded to the loop, which stops at the next step
// boundary instead of burning the remaining OpenAI/LangGraph budget.
const inFlight = new Set<string>()

function sseEvent(payload: AutoFrame): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** Parse + bound an optional numeric body field; returns the clamped value, or
 *  `undefined` when absent (defer to the function default), or an error string
 *  when present-but-invalid. */
function parseBoundedNumber(
  raw: unknown,
  name: string,
  min: number,
  max: number
): { value: number | undefined } | { error: string } {
  if (raw === undefined) return { value: undefined }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { error: `${name} must be a finite number` }
  }
  if (raw < min || raw > max) {
    return { error: `${name} must be between ${min} and ${max}` }
  }
  return { value: raw }
}

export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  // Body is optional — a POST with no/empty body means "use the defaults".
  let body: { maxIterations?: unknown; maxCostUsd?: unknown } = {}
  try {
    const text = await request.text()
    if (text.trim().length > 0) {
      // JSON.parse can legally return null / a primitive / an array — reading
      // `.maxIterations` off `null` would crash into an unhandled 500, so
      // non-object bodies are rejected as a plain 400 instead.
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
      }
      body = parsed as { maxIterations?: unknown; maxCostUsd?: unknown }
    }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const iters = parseBoundedNumber(body.maxIterations, 'maxIterations', 1, 10)
  if ('error' in iters) {
    return NextResponse.json({ error: iters.error }, { status: 400 })
  }
  const cost = parseBoundedNumber(body.maxCostUsd, 'maxCostUsd', 0.1, 10)
  if ('error' in cost) {
    return NextResponse.json({ error: cost.error }, { status: 400 })
  }
  const maxIterations = iters.value
  const maxCostUsd = cost.value

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // Existence check BEFORE the stream opens: an unknown copilot must be an
  // HTTP 404 (family contract — run/promotion/delivery-loop/analyze), never a
  // 200 stream. Without this, the loop's first analyzeAndPropose throws
  // NotFoundError('copilot not found'), which the cycle treats as a CLEAN
  // "nothing to improve" stop — i.e. a fake converged/done success frame for
  // a copilot that does not exist. Pre-stream errors are HTTP statuses; only
  // mid-stream failures belong in frames.
  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id&limit=1`
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
  } catch (err) {
    // Never forward raw PostgREST detail — log server-side, generic 502
    // (same shape as the sibling stream route's pre-stream pgrest check).
    console.error('[agent-ops/improve/auto] failed to load copilot', err)
    return NextResponse.json({ error: 'failed to load copilot' }, { status: 502 })
  }

  if (inFlight.has(copilotId)) {
    return NextResponse.json(
      { error: 'an auto-improvement cycle is already running for this copilot' },
      { status: 409 }
    )
  }
  inFlight.add(copilotId)

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (payload: AutoFrame) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseEvent(payload)))
        } catch {
          // Controller already closed client-side (e.g. aborted) — ignore.
        }
      }

      try {
        const result = await runAutoImprovementCycle(copilotId, {
          maxIterations,
          maxCostUsd,
          // A client abort stops the loop at the next step boundary (checked
          // between analyze / create-v2 / each re-run / compare) instead of
          // letting it run — and spend — to completion server-side.
          signal: request.signal,
          // Push each milestone as it happens. `AutoImproveEvent` is forwarded
          // verbatim as its own SSE frame — no batching, so a multi-minute run
          // streams live iteration-by-iteration.
          onEvent: (ev: AutoImproveEvent) => push(ev),
        })
        // Terminal frame — the loop's summary so the client can reconcile
        // (stopped reason + head V2 to decide) without a second round-trip.
        push({ type: 'done', ...result })
      } catch (err) {
        if (request.signal.aborted) {
          // The CLIENT stopped the cycle — nobody is listening and nothing
          // failed, so no error frame and no failure log.
        } else {
          // Never forward raw error detail — log server-side, emit a generic frame.
          console.error('[agent-ops/improve/auto] auto-improvement cycle failed', err)
          push({ type: 'error', error: 'auto-improvement cycle failed' })
        }
      } finally {
        closed = true
        inFlight.delete(copilotId)
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
