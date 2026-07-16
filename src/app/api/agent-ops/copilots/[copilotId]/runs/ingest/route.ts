import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'

/**
 * POST /api/agent-ops/copilots/:copilotId/runs/ingest — production-run
 * telemetry ingestion from TARGET workspaces (TradeAgent & co).
 *
 * The delivered agents run inside the customer repo and, until this route,
 * reported NOTHING back: the dashboard's Volume/Cost/Runs KPIs stayed at zero
 * forever and the continuous-improve loop had no production signal to learn
 * from. A target workspace posts one row per completed run here; it lands in
 * `agent_runs` — the exact table the dashboard KPIs and the improve loop
 * already read — with `created_via: 'production'` so authoring rows and real
 * traffic never mix.
 *
 * Auth: enforced upstream by src/proxy.ts (session cookie or x-amc-key). The
 * target workspace uses x-amc-key server-to-server; the key never ships to a
 * browser.
 *
 * Body (Zod, strict on shape, bounded on size):
 *   { status, inputSummary?, outputSummary?, toolCallCount?,
 *     unsafeAttemptCount?, latencyMs?, costUsd?, userLabel?, versionId? }
 * The copilot must exist (404 otherwise) and its project_id is resolved
 * server-side — the caller can never attribute a run to someone else's
 * project.
 */

const ID_RE = /^[a-z0-9-]{1,200}$/

const bodySchema = z.object({
  // Mirrors the AgentRunStatus values the agent_runs CHECK actually accepts
  // (probed live: 'error' is rejected with 23514 — callers report failures as
  // 'failed'). 'running'/'needs-confirmation' are excluded on purpose: this
  // route ingests FINISHED runs only.
  status: z.enum(['completed', 'blocked', 'failed']),
  inputSummary: z.string().max(2000).optional(),
  outputSummary: z.string().max(2000).optional(),
  toolCallCount: z.number().int().min(0).max(10_000).optional(),
  unsafeAttemptCount: z.number().int().min(0).max(10_000).optional(),
  latencyMs: z.number().int().min(0).max(86_400_000).optional(),
  costUsd: z.number().min(0).max(1000).optional(),
  userLabel: z.string().max(200).optional(),
  versionId: z.string().regex(ID_RE).optional(),
})

function requireLiveBackend(): NextResponse | null {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  return null
}

export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  const blocked = requireLiveBackend()
  if (blocked) return blocked

  let parsed: z.infer<typeof bodySchema>
  try {
    const raw: unknown = await request.json()
    const result = bodySchema.safeParse(raw)
    if (!result.success) {
      return NextResponse.json(
        { error: `invalid body: ${result.error.issues[0]?.message ?? 'schema mismatch'}` },
        { status: 400 }
      )
    }
    parsed = result.data
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // The copilot must exist; resolve its project + production version server-side
  // so a caller can never attribute traffic across projects or invent versions.
  let projectId: string | null = null
  let productionVersionId: string | null = null
  try {
    const rows = await pgrest<{ id: string; project_id: string | null; production_version_id: string | null }[]>(
      'GET',
      `copilots?select=id,project_id,production_version_id&id=eq.${encodeURIComponent(copilotId)}&limit=1`
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    projectId = rows[0].project_id
    productionVersionId = rows[0].production_version_id
  } catch (err) {
    console.error('[agent-ops/runs/ingest] copilot lookup failed', err)
    return NextResponse.json({ error: 'failed to check copilot' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  // agent_runs.version_id is NOT NULL (probed live: 23502 on null). A copilot
  // with no promoted production version has no honest version to attribute
  // production traffic to — refuse instead of inventing one.
  if (!parsed.versionId && !productionVersionId) {
    return NextResponse.json(
      { error: 'copilot has no production version — promote one before ingesting production runs' },
      { status: 409 }
    )
  }

  const runId = randomUUID()
  const now = new Date().toISOString()
  const startedAt = parsed.latencyMs != null ? new Date(Date.now() - parsed.latencyMs).toISOString() : now
  try {
    await pgrest('POST', 'agent_runs', {
      id: runId,
      copilot_id: copilotId,
      // versionId from the caller only when it matches our ID shape; else the
      // copilot's own production version (the honest default for prod traffic).
      version_id: parsed.versionId ?? productionVersionId,
      project_id: projectId,
      user_label: parsed.userLabel ?? 'production',
      started_at: startedAt,
      finished_at: now,
      status: parsed.status,
      input_summary: parsed.inputSummary ?? null,
      output_summary: parsed.outputSummary ?? null,
      tool_call_count: parsed.toolCallCount ?? 0,
      unsafe_attempt_count: parsed.unsafeAttemptCount ?? 0,
      latency_ms: parsed.latencyMs ?? null,
      cost_usd: parsed.costUsd ?? null,
      trace_url: null,
      thread_id: null,
      created_via: 'production',
    })
  } catch (err) {
    console.error('[agent-ops/runs/ingest] insert failed', err)
    return NextResponse.json({ error: 'ingest failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  return NextResponse.json({ ok: true, runId })
}
