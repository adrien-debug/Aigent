import { NextResponse } from 'next/server'

import { runMission } from '@/lib/agent-mission-control/mission-orchestrator-server'

/**
 * POST /api/agent-ops/projects/:id/missions — run a multi-agent mission (evidence V1).
 * READ-ONLY: collects repo intelligence, scorecard, sandbox, delivery events.
 * Never writes to GitHub, never merges, never opens PRs.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

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
  let mode = 'evidence_v1' as const
  let branch: string | undefined
  try {
    const body = (await request.json().catch(() => null)) as
      | { objective?: unknown; mode?: unknown; branch?: unknown }
      | null
    if (typeof body?.objective === 'string' && body.objective.trim()) {
      objective = body.objective.trim()
    }
    if (body?.mode === 'evidence_v1') mode = 'evidence_v1'
    if (typeof body?.branch === 'string' && body.branch.trim()) branch = body.branch.trim()
  } catch {
    // defaults
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
