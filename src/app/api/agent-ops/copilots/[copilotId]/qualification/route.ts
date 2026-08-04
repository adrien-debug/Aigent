import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import {
  advanceQualification,
  computeReadiness,
  getLatestQualificationRun,
  QualificationError,
  runQualificationSweep,
  startQualification,
  type OrchestratorOptions,
} from '@/lib/agent-mission-control/qualification-orchestrator'
import type { PromotionPolicy } from '@/lib/agent-mission-control/promotion-gate'
import { createShadowReplayDriver } from '@/lib/agent-mission-control/shadow-replay-driver'

/**
 * POST/GET /api/agent-ops/copilots/:copilotId/qualification — the single product
 * surface for the qualification WORKFLOW of a candidate version (tests →
 * benchmark → shadow → replay → gate). It NEVER promotes: promotion stays the
 * explicit, privilege-separated `.../promotion` action. Auth is the shared
 * /api/agent-ops gate (src/proxy.ts); this route re-verifies that the version
 * belongs to the copilot (IDOR) inside the orchestrator.
 *
 * Live-only, fail-closed: 503 without a backend. Ids are shape-guarded before any
 * DB round-trip (same family as the sibling promotion/run routes).
 */
const ID_RE = /^[a-z0-9-]{1,200}$/
const isValidId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id)

function liveBackendMissing(): boolean {
  return (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/** Map orchestrator/pgrest failures to HTTP, matching the sibling routes. */
function errorResponse(err: unknown): NextResponse {
  if (err instanceof QualificationError) {
    const status = err.code === 'not_a_candidate' ? 409 : 404
    return NextResponse.json({ error: err.message }, { status })
  }
  console.error('[agent-ops/qualification] failed:', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'qualification failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
}

function parsePolicy(raw: unknown): PromotionPolicy | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const p = raw as Record<string, unknown>
  const requireShadow = p.requireShadow === true
  const requireReplay = p.requireReplay === true
  return { requireShadow, requireReplay }
}

/**
 * GET — observe the latest qualification run for a version + its synthesized
 * readiness. `?versionId=` is optional (defaults to the copilot's latest version,
 * resolved by the orchestrator). Never mutates.
 */
export async function GET(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!isValidId(copilotId)) return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })

  const url = new URL(request.url)
  const versionId = url.searchParams.get('versionId')
  if (versionId !== null && !isValidId(versionId)) {
    return NextResponse.json({ error: 'invalid versionId' }, { status: 400 })
  }
  if (liveBackendMissing()) return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })

  try {
    // Resolve the target version: explicit, or the copilot's latest.
    let target = versionId
    if (!target) {
      const { pgrest } = await import('@/lib/agent-mission-control/postgrest')
      const rows = await pgrest<Record<string, unknown>[]>(
        'GET',
        `copilots?id=eq.${encodeURIComponent(copilotId)}&select=latest_version_id`,
      )
      if (rows.length === 0) return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
      target = (rows[0].latest_version_id as string | null) ?? null
    }
    if (!target) return NextResponse.json({ error: 'copilot has no candidate version' }, { status: 404 })

    const run = await getLatestQualificationRun(copilotId, target)
    return NextResponse.json({ run, readiness: computeReadiness(run) })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST — start, advance, or sweep the qualification workflow.
 *
 * Body: {
 *   versionId: string,               // the candidate version to qualify
 *   action?: 'sweep' | 'start' | 'advance',  // default 'sweep'
 *   clientRunId?: string,            // idempotency key (double-submit safe)
 *   sourceRunId?: string,            // measured run that triggered qualification
 *   policy?: { requireShadow?: boolean, requireReplay?: boolean }
 * }
 * Returns { run, readiness }. Never promotes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!isValidId(copilotId)) return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const versionId = body.versionId
  if (!isValidId(versionId)) return NextResponse.json({ error: 'versionId is required' }, { status: 400 })

  const action = body.action ?? 'sweep'
  if (action !== 'sweep' && action !== 'start' && action !== 'advance') {
    return NextResponse.json({ error: "action must be 'sweep', 'start' or 'advance'" }, { status: 400 })
  }
  const clientRunId = typeof body.clientRunId === 'string' && isValidId(body.clientRunId) ? body.clientRunId : undefined
  if (body.sourceRunId !== undefined && !isValidId(body.sourceRunId)) {
    return NextResponse.json({ error: 'invalid sourceRunId' }, { status: 400 })
  }
  const sourceRunId = typeof body.sourceRunId === 'string' && isValidId(body.sourceRunId) ? body.sourceRunId : undefined
  const options: OrchestratorOptions & { clientRunId?: string } = {
    policy: parsePolicy(body.policy),
    clientRunId,
    sourceRunId,
    driver: createShadowReplayDriver(),
  }

  if (liveBackendMissing()) return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })

  try {
    if (action === 'sweep') {
      const run = await runQualificationSweep(copilotId, versionId, options)
      return NextResponse.json({ run, readiness: computeReadiness(run) })
    }
    if (action === 'start') {
      const run = await startQualification(copilotId, versionId, options)
      return NextResponse.json({ run, readiness: computeReadiness(run) })
    }
    // advance: operate on the current running run (resume after a failure).
    const current = await getLatestQualificationRun(copilotId, versionId)
    if (!current) return NextResponse.json({ error: 'no qualification run to advance — start one first' }, { status: 409 })
    const run = await advanceQualification(current, options)
    return NextResponse.json({ run, readiness: computeReadiness(run) })
  } catch (err) {
    return errorResponse(err)
  }
}
