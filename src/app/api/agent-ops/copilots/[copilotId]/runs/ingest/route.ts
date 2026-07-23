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
  // Caller-supplied idempotency key. A retried/duplicated delivery reusing the
  // same key never creates a second billed run row (dedup on
  // agent_runs(copilot_id, client_run_id), migration 0027) — it gets the
  // original run's id back. Absent → every POST is a distinct run (unchanged).
  clientRunId: z.string().min(1).max(200).optional(),
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

  // A caller-supplied versionId must belong to THIS copilot — otherwise an
  // authenticated caller could attribute traffic to another copilot's version
  // (the FK would accept it; the attribution would be a lie). 422, not 404:
  // the copilot exists, the version claim is what's wrong.
  if (parsed.versionId && parsed.versionId !== productionVersionId) {
    let owned = false
    try {
      const vrows = await pgrest<{ id: string }[]>(
        'GET',
        `copilot_versions?select=id&id=eq.${encodeURIComponent(parsed.versionId)}&copilot_id=eq.${encodeURIComponent(copilotId)}&limit=1`
      )
      owned = vrows.length > 0
    } catch (err) {
      console.error('[agent-ops/runs/ingest] version lookup failed', err)
      return NextResponse.json({ error: 'failed to check version' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }
    if (!owned) {
      return NextResponse.json({ error: 'versionId does not belong to this copilot' }, { status: 422 })
    }
  }

  // Idempotency: if the caller supplied a client_run_id and a row for this
  // (copilot, key) already exists, return it instead of inserting a duplicate
  // billed run. This closes the proven double-count (a retried delivery whose
  // response timed out re-POSTing the same run).
  if (parsed.clientRunId) {
    try {
      const existing = await pgrest<{ id: string }[]>(
        'GET',
        `agent_runs?select=id&copilot_id=eq.${encodeURIComponent(copilotId)}&client_run_id=eq.${encodeURIComponent(parsed.clientRunId)}&limit=1`
      )
      if (existing.length > 0) {
        return NextResponse.json({ ok: true, runId: existing[0].id, idempotent: true })
      }
    } catch (err) {
      console.error('[agent-ops/runs/ingest] idempotency lookup failed', err)
      return NextResponse.json({ error: 'failed to check idempotency' }, { status: isPgrestTimeout(err) ? 504 : 502 })
    }
  }

  const runId = randomUUID()
  const now = new Date().toISOString()
  const startedAt = parsed.latencyMs != null ? new Date(Date.now() - parsed.latencyMs).toISOString() : now
  try {
    await pgrest('POST', 'agent_runs', {
      id: runId,
      copilot_id: copilotId,
      client_run_id: parsed.clientRunId ?? null,
      // Caller versionId only after the ownership check above passed; else the
      // copilot's own production version (the honest default for prod traffic).
      version_id: parsed.versionId ?? productionVersionId,
      project_id: projectId,
      user_label: parsed.userLabel ?? 'production',
      started_at: startedAt,
      finished_at: now,
      status: parsed.status,
      // input/output_summary and latency_ms are NOT NULL in agent_runs (probed
      // live: 23502 on null) — absent values land as the empty string / 0,
      // matching the runner's own rows.
      input_summary: parsed.inputSummary ?? '',
      output_summary: parsed.outputSummary ?? '',
      tool_call_count: parsed.toolCallCount ?? 0,
      unsafe_attempt_count: parsed.unsafeAttemptCount ?? 0,
      latency_ms: parsed.latencyMs ?? 0,
      // cost_usd is NULLABLE since migration 0025 (coût inconnu ≠ zéro): a run
      // whose cost the caller never measured persists NULL (unavailable), NOT a
      // fabricated 0. `?? 0` here would re-manufacture the exact false zero that
      // migration erased — SUM ignores NULL natively, so absence stays absence.
      cost_usd: parsed.costUsd ?? null,
      trace_url: null,
      thread_id: null,
      created_via: 'production',
    })
  } catch (err) {
    // Concurrent insert of the same client_run_id: both requests passed the
    // pre-check, the unique index (0027) rejected the loser (409/23505). Resolve
    // idempotently — return the winner's row instead of a 5xx.
    const status = (err as { status?: number })?.status
    if (parsed.clientRunId && (status === 409 || /23505|duplicate key/i.test(String((err as Error)?.message)))) {
      try {
        const existing = await pgrest<{ id: string }[]>(
          'GET',
          `agent_runs?select=id&copilot_id=eq.${encodeURIComponent(copilotId)}&client_run_id=eq.${encodeURIComponent(parsed.clientRunId)}&limit=1`
        )
        if (existing.length > 0) {
          return NextResponse.json({ ok: true, runId: existing[0].id, idempotent: true })
        }
      } catch {
        /* fall through to the generic error below */
      }
    }
    console.error('[agent-ops/runs/ingest] insert failed', err)
    return NextResponse.json({ error: 'ingest failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  return NextResponse.json({ ok: true, runId })
}
