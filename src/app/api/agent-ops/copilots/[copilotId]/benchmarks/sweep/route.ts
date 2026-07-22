import { NextResponse } from 'next/server'

import { runBenchmarkSweep } from '@/lib/agent-mission-control/benchmark-sweep'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import type { AgentRuntime, ModelProvider } from '@/lib/agent-mission-control/types'

const MODEL_PROVIDERS: ModelProvider[] = ['openai', 'google', 'local']

// Same guard shape as the sibling benchmarks/run route: copilot ids are
// `<prefix>-<slug>-<hex>` (see slug.makeId).
const COPILOT_ID_RE = /^[a-zA-Z0-9-]{1,100}$/

// Same 200-char cap as benchmarks/run — these strings flow into PostgREST
// filter URLs and get persisted on benchmark_runs rows.
const MAX_ID_LENGTH = 200

// Upper bound on the model list. A sweep is SEQUENTIAL (benchmark-sweep.ts,
// design rule 2) — each entry is a full benchmark suite run, so an unbounded
// list here is an unbounded serverless request duration, not just an
// unbounded PostgREST payload.
const MAX_MODELS = 8

interface SweepBody {
  suiteId?: string
  versionId?: string
  models?: unknown
  allowJudgeOnlySweep?: boolean
}

interface RawModelSpec {
  modelProvider?: unknown
  model?: unknown
}

/**
 * POST /api/agent-ops/copilots/:copilotId/benchmarks/sweep — run the SAME
 * benchmark suite across several models, one after the other, and report a
 * verdict per model (never a fabricated score for a model that could not run).
 *
 * Body: { suiteId: string; versionId?: string;
 *         models: { modelProvider: 'openai'|'google'|'local'; model: string }[];
 *         allowJudgeOnlySweep?: boolean }
 * Response: { ok: true; sweep: BenchmarkSweepResult }
 *
 * DURATION WARNING: a sweep is N sequential full benchmark-suite runs
 * (benchmark-sweep.ts design rule 2 — legs never run concurrently, to avoid
 * queuing on the single-tenant local vLLM endpoints). This route offers NO
 * background/job mechanism — like benchmarks/run, it blocks for the full
 * duration of the request. With `MAX_MODELS = 8` legs and suites that can
 * already run long individually (see benchmarks/run), a full sweep CAN
 * exceed common platform request-timeout budgets (e.g. a serverless
 * function's max duration). This is a known, undischarged limit: callers
 * sweeping many models against a large suite should expect a possible 504
 * from the platform in front of this route, not from this route itself. A
 * future fix would move sweeps to a background job with a pollable status
 * row, mirroring how long project-builder work is queued elsewhere in this
 * repo — out of scope here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  let body: SweepBody
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
  if (body.allowJudgeOnlySweep !== undefined && typeof body.allowJudgeOnlySweep !== 'boolean') {
    return NextResponse.json({ error: 'allowJudgeOnlySweep must be a boolean' }, { status: 400 })
  }
  if (!Array.isArray(body.models) || body.models.length === 0) {
    return NextResponse.json({ error: 'models must be a non-empty array' }, { status: 400 })
  }
  if (body.models.length > MAX_MODELS) {
    return NextResponse.json({ error: `models must have at most ${MAX_MODELS} entries` }, { status: 400 })
  }

  const models: { modelProvider: ModelProvider; model: string }[] = []
  for (const raw of body.models as RawModelSpec[]) {
    if (typeof raw !== 'object' || raw === null) {
      return NextResponse.json({ error: 'each model entry must be an object' }, { status: 400 })
    }
    const { modelProvider, model } = raw
    if (typeof modelProvider !== 'string' || !MODEL_PROVIDERS.includes(modelProvider as ModelProvider)) {
      return NextResponse.json({ error: 'invalid modelProvider in models[]' }, { status: 400 })
    }
    if (typeof model !== 'string' || model.trim().length === 0 || model.length > MAX_ID_LENGTH) {
      return NextResponse.json({ error: 'invalid model in models[]' }, { status: 400 })
    }
    models.push({ modelProvider: modelProvider as ModelProvider, model })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // The sweep needs the copilot's REAL runtime up front (it decides the
  // langgraph judge-only refusal in benchmark-sweep.ts) — read it the same
  // way the promotion route reads the copilot pointer row.
  let runtime: AgentRuntime
  try {
    const rows = await pgrest<Array<{ runtime: AgentRuntime | null }>>(
      'GET',
      `copilots?id=eq.${encodeURIComponent(copilotId)}&select=runtime&limit=1`
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    runtime = rows[0].runtime ?? 'custom'
  } catch (err) {
    console.error('[agent-ops/copilots/benchmarks/sweep] failed to read copilot runtime', err)
    return NextResponse.json({ error: 'failed to read copilot' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  // In-flight guard (same check-then-act shape as the sibling benchmarks/run
  // route): a sweep is N sequential full suite runs, so two concurrent sweeps of
  // the same suite would double the LLM spend (and queue on the single-tenant
  // local vLLM endpoints). If a benchmark run/leg for this suite is already
  // running, reject the duplicate 409 instead of admitting a second one.
  try {
    const running = await pgrest<Array<{ id: string }>>(
      'GET',
      `benchmark_runs?copilot_id=eq.${encodeURIComponent(copilotId)}&suite_id=eq.${encodeURIComponent(body.suiteId)}&status=eq.running&select=id&limit=1`
    )
    if (running.length > 0) {
      return NextResponse.json(
        { error: 'a benchmark run or sweep is already in progress for this suite', runId: running[0].id },
        { status: 409 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/copilots/benchmarks/sweep] in-flight check failed', err)
    return NextResponse.json({ error: 'failed to check for an in-flight run' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  try {
    const sweep = await runBenchmarkSweep({
      copilotId,
      suiteId: body.suiteId,
      versionId: body.versionId,
      models,
      runtime,
      allowJudgeOnlySweep: body.allowJudgeOnlySweep,
    })
    return NextResponse.json({ ok: true, sweep })
  } catch (err) {
    // runBenchmarkSweep never throws for a single leg's failure (it records a
    // `failed` leg instead, per benchmark-sweep.ts) — a throw here means the
    // sweep itself could not run at all (e.g. the suite lookup shared across
    // legs). Same generic-message-to-client discipline as benchmarks/run:
    // log the real error, never forward it raw.
    console.error('[agent-ops/copilots/benchmarks/sweep] sweep failed', err)
    return NextResponse.json({ error: 'benchmark sweep failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
