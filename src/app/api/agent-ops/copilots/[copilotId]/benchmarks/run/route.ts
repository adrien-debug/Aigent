import { NextResponse } from 'next/server'

import { NoRunnableTasksError, runBenchmarkSuite } from '@/lib/agent-mission-control/benchmark-runner'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'
import type { AgentRuntime, BenchmarkRun, ModelProvider } from '@/lib/agent-mission-control/types'

const MODEL_PROVIDERS: ModelProvider[] = ['openai', 'google', 'local']
const RUNTIMES: AgentRuntime[] = ['langgraph', 'openai-assistants', 'gemini', 'custom']

// Copilot ids are `<prefix>-<slug>-<hex>` (see slug.makeId): lowercase
// alphanumeric + hyphens. Bound + charset-check the dynamic param before it
// flows into the PostgREST filter and runBenchmarkSuite (same guard shape as
// the langgraph/threads/[threadId] route).
const COPILOT_ID_RE = /^[a-zA-Z0-9-]{1,100}$/

// Upper bound on body string fields that flow into PostgREST filter URLs and
// are persisted on `benchmark_runs` (suite_id / version_id / model). Same
// 200-char cap as the copilots create route and the promotion route's ID_RE —
// an unbounded string here means an arbitrarily large upstream URL + DB row.
const MAX_ID_LENGTH = 200

/**
 * POST /api/agent-ops/copilots/:copilotId/benchmarks/run — run a REAL V1
 * benchmark suite. Delegates to `runBenchmarkSuite`, which executes + grades
 * every task and persists `benchmark_runs` + `benchmark_results` to gpu1.
 *
 * Body: { suiteId: string; versionId?: string; model?: string;
 *         modelProvider?: ModelProvider; runtime?: AgentRuntime }
 * Response: { ok: true; benchmarkRun: BenchmarkRun }
 *
 * Errors mirror the test-runner route (400 / 404 / 503 / 502), plus a 409 when
 * a benchmark run is already in progress for this suite/copilot or when the
 * suite has no runnable tasks (empty corpus — a data state, not an upstream
 * failure).
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: {
    suiteId?: string
    versionId?: string
    model?: string
    modelProvider?: string
    runtime?: string
    allowFallback?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (
    typeof body.suiteId !== 'string' ||
    body.suiteId.trim().length === 0 ||
    body.suiteId.length > MAX_ID_LENGTH
  ) {
    return NextResponse.json({ error: 'suiteId is required' }, { status: 400 })
  }
  if (
    body.versionId !== undefined &&
    (typeof body.versionId !== 'string' || body.versionId.length > MAX_ID_LENGTH)
  ) {
    return NextResponse.json({ error: 'versionId must be a string' }, { status: 400 })
  }
  if (
    body.model !== undefined &&
    (typeof body.model !== 'string' || body.model.length > MAX_ID_LENGTH)
  ) {
    return NextResponse.json({ error: 'model must be a string' }, { status: 400 })
  }
  if (body.modelProvider !== undefined && !MODEL_PROVIDERS.includes(body.modelProvider as ModelProvider)) {
    return NextResponse.json({ error: 'invalid modelProvider' }, { status: 400 })
  }
  if (body.runtime !== undefined && !RUNTIMES.includes(body.runtime as AgentRuntime)) {
    return NextResponse.json({ error: 'invalid runtime' }, { status: 400 })
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
  // resume route's `needs-confirmation` gate): a benchmark run for this
  // suite persists as `running` until it finishes (runBenchmarkSuite marks
  // it `completed`/`aborted`). If one is already in flight for this suite,
  // reject the duplicate instead of silently kicking off a second concurrent
  // run against the same copilot/suite (double cost, double writes, and two
  // runs racing to PATCH the same suite's last state). This narrows — but,
  // being check-then-act, does not fully close — the race between two
  // requests arriving at nearly the same instant.
  try {
    const runningRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `benchmark_runs?suite_id=eq.${encodeURIComponent(body.suiteId)}&copilot_id=eq.${encodeURIComponent(copilotId)}&status=eq.running&select=id&limit=1`
    )
    if (runningRows.length > 0) {
      return NextResponse.json(
        { error: 'a benchmark run is already in progress for this suite', runId: runningRows[0].id },
        { status: 409 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/copilots/benchmarks/run] failed to check for an in-flight run', err)
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  try {
    const benchmarkRun: BenchmarkRun = await runBenchmarkSuite({
      copilotId,
      suiteId: body.suiteId,
      versionId: body.versionId,
      model: body.model,
      modelProvider: body.modelProvider as ModelProvider | undefined,
      runtime: body.runtime as AgentRuntime | undefined,
      allowFallback: body.allowFallback,
    })
    return NextResponse.json({ ok: true, benchmarkRun })
  } catch (err) {
    // Typed mapping: missing/mismatched resource → 404; empty corpus (no
    // runnable tasks — a client/data state, same 409 family as the in-flight
    // guard above and the improve routes' state conflicts) → 409; provider env
    // not configured → 503; everything else (model access / OpenAI / PostgREST
    // / abort) → 502. NotFoundError/NoRunnableTasksError/
    // ProviderUnavailableError messages are hand-authored and safe to forward;
    // the generic fallback is NOT — runBenchmarkSuite's abort path can embed
    // raw PostgREST response detail, so log it server-side and return a
    // generic message instead.
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof NoRunnableTasksError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[agent-ops/copilots/benchmarks/run] benchmark run failed', err)
    return NextResponse.json({ error: 'benchmark run failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
