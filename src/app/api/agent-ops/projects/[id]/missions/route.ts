import { NextResponse } from 'next/server'
import { z } from 'zod'

import { runMission } from '@/lib/agent-mission-control/mission-orchestrator-server'

/**
 * POST /api/agent-ops/projects/:id/missions — run a multi-agent mission (evidence V1).
 * READ-ONLY: collects repo intelligence, scorecard, sandbox, delivery events.
 * Never writes to GitHub, never merges, never opens PRs.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/
const MAX_OBJECTIVE_LENGTH = 4_000
const MAX_BRANCH_LENGTH = 200

/**
 * Body is untrusted: `objective` and `branch` are persisted to DB
 * (mission_runs) and echoed in the report, so both are bounded; `mode` is a
 * closed enum (only evidence_v1 exists) so an unknown mode is a 400 rather
 * than silently running the default. Absent/empty body keeps the historical
 * defaults (the route is callable without a body via x-amc-key).
 */
const bodySchema = z
  .object({
    objective: z.string().max(MAX_OBJECTIVE_LENGTH).optional(),
    mode: z.literal('evidence_v1').optional(),
    branch: z.string().max(MAX_BRANCH_LENGTH).optional(),
  })
  .strip()

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let objective = 'Mission objective'
  const mode = 'evidence_v1' as const
  let branch: string | undefined
  const raw: unknown = await request.json().catch(() => null)
  if (raw !== null && raw !== undefined) {
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 })
    }
    const trimmedObjective = parsed.data.objective?.trim()
    if (trimmedObjective) objective = trimmedObjective
    const trimmedBranch = parsed.data.branch?.trim()
    if (trimmedBranch) branch = trimmedBranch
  }

  try {
    const result = await runMission({ projectId: id, objective, mode, branch })
    if (!result) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    return NextResponse.json({ ok: true, persisted: result.persisted, report: result.report })
  } catch (err) {
    console.error('[agent-ops/projects/missions] run failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'mission run failed' }, { status: 502 })
  }
}
