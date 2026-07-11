import { NextResponse } from 'next/server'

import { runBenchmarkSuite } from '@/lib/agent-mission-control/benchmark-runner'
import { NotFoundError, ProviderUnavailableError } from '@/lib/agent-mission-control/runner-errors'
import type { AgentRuntime, BenchmarkRun, ModelProvider } from '@/lib/agent-mission-control/types'

const MODEL_PROVIDERS: ModelProvider[] = ['openai', 'google', 'mistral', 'local']
const RUNTIMES: AgentRuntime[] = ['langgraph', 'openai-assistants', 'gemini', 'custom']

/**
 * POST /api/agent-ops/copilots/:copilotId/benchmarks/run — run a REAL V1
 * benchmark suite. Delegates to `runBenchmarkSuite`, which executes + grades
 * every task and persists `benchmark_runs` + `benchmark_results` to gpu1.
 *
 * Body: { suiteId: string; versionId?: string; model?: string;
 *         modelProvider?: ModelProvider; runtime?: AgentRuntime }
 * Response: { ok: true; benchmarkRun: BenchmarkRun }
 *
 * Errors mirror the test-runner route: 400 / 404 / 503 / 502.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params

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
  if (typeof body.suiteId !== 'string' || body.suiteId.trim().length === 0) {
    return NextResponse.json({ error: 'suiteId is required' }, { status: 400 })
  }
  if (body.versionId !== undefined && typeof body.versionId !== 'string') {
    return NextResponse.json({ error: 'versionId must be a string' }, { status: 400 })
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

  try {
    const benchmarkRun: BenchmarkRun = await runBenchmarkSuite({
      copilotId,
      suiteId: body.suiteId,
      versionId: body.versionId,
      model: typeof body.model === 'string' ? body.model : undefined,
      modelProvider: body.modelProvider as ModelProvider | undefined,
      runtime: body.runtime as AgentRuntime | undefined,
      allowFallback: body.allowFallback,
    })
    return NextResponse.json({ ok: true, benchmarkRun })
  } catch (err) {
    // Typed mapping: missing/mismatched resource → 404; provider env not
    // configured → 503; everything else (model access / OpenAI / PostgREST /
    // no runnable tasks / abort) → 502.
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'benchmark run failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
