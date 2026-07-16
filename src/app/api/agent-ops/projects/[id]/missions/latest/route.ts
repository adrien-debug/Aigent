import { NextResponse } from 'next/server'

import { getLatestMissionRun } from '@/lib/agent-mission-control/mission-orchestrator-server'
import { getMissionFindings } from '@/lib/agent-mission-control/mission-findings-store'

/**
 * GET /api/agent-ops/projects/:id/missions/latest — newest mission run for a project.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const run = await getLatestMissionRun(id)
    if (!run) return NextResponse.json({ ok: true, mission: null })
    const findings = await getMissionFindings(run.id)
    return NextResponse.json({ ok: true, mission: { ...run, findings } })
  } catch (err) {
    console.error('[agent-ops/projects/missions/latest] read failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'mission read failed' }, { status: 502 })
  }
}
