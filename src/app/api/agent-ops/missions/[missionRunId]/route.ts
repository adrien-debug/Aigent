import { NextResponse } from 'next/server'

import { getMissionRun } from '@/lib/agent-mission-control/mission-orchestrator-server'
import { getMissionFindings } from '@/lib/agent-mission-control/mission-findings-store'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

/**
 * GET /api/agent-ops/missions/:missionRunId — fetch one mission run + findings.
 */
const MISSION_ID_RE = /^mission_[a-z0-9]{12}$/

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ missionRunId: string }> }) {
  const { missionRunId } = await params
  if (!MISSION_ID_RE.test(missionRunId)) {
    return NextResponse.json({ error: 'invalid missionRunId' }, { status: 400 })
  }
  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const run = await getMissionRun(missionRunId)
    if (!run) return NextResponse.json({ error: 'mission not found' }, { status: 404 })
    const findings = await getMissionFindings(missionRunId)
    return NextResponse.json({ ok: true, mission: { ...run, findings } })
  } catch (err) {
    console.error('[agent-ops/missions] read failed', err instanceof Error ? err.message : err)
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'mission read failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
