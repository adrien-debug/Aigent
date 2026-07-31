import { NextResponse } from 'next/server'
import { z } from 'zod'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import {
  listActiveToolBuildMissions,
  listToolBuildMissions,
  retryToolBuildMission,
  startToolBuildMission,
} from '@/lib/agent-mission-control/tool-build-missions-store'
import type { ToolBuildSpec } from '@/lib/agent-mission-control/tool-builder/mission'

function liveBackendMissing(): boolean {
  return (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

const specSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  kind: z.literal('local-deterministic'),
  mutates: z.literal(false),
  risk: z.enum(['low', 'medium', 'high']),
  requiresConfirmation: z.boolean(),
  secretRefs: z.array(z.string()),
})

/**
 * GET /api/agent-ops/tool-build-missions — list missions (active only by default).
 */
export async function GET(request: Request) {
  if (liveBackendMissing()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const all = url.searchParams.get('all') === '1'
  try {
    const missions = all ? await listToolBuildMissions() : await listActiveToolBuildMissions()
    return NextResponse.json({ missions })
  } catch (err) {
    console.error('[agent-ops/tool-build-missions] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'failed to list tool build missions' },
      { status: isPgrestTimeout(err) ? 504 : 502 },
    )
  }
}

/**
 * POST /api/agent-ops/tool-build-missions — start a tool build from a spec.
 */
export async function POST(request: Request) {
  if (liveBackendMissing()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

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

  const parsed = specSchema.safeParse(body.spec)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid spec', details: z.flattenError(parsed.error) }, { status: 400 })
  }

  try {
    const mission = await startToolBuildMission(parsed.data as ToolBuildSpec)
    return NextResponse.json({ mission })
  } catch (err) {
    console.error('[agent-ops/tool-build-missions] start failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'failed to start tool build mission' },
      { status: isPgrestTimeout(err) ? 504 : 502 },
    )
  }
}

/**
 * PATCH /api/agent-ops/tool-build-missions — retry/advance an existing mission.
 */
export async function PATCH(request: Request) {
  if (liveBackendMissing()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

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

  const missionId = body.missionId
  if (typeof missionId !== 'string' || missionId.length === 0) {
    return NextResponse.json({ error: 'missionId is required' }, { status: 400 })
  }

  try {
    const mission = await retryToolBuildMission(missionId)
    return NextResponse.json({ mission })
  } catch (err) {
    console.error('[agent-ops/tool-build-missions] retry failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to advance mission' },
      { status: isPgrestTimeout(err) ? 504 : 502 },
    )
  }
}
