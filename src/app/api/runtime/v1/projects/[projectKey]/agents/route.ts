import { NextResponse } from 'next/server'

import { isValidProjectKey, requireRuntimeApiAuth, type PublishedAgent } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/projects/:projectKey/agents — list the published
 * agents for one consumer project (e.g. `real-estate-agent`).
 *
 * Skeleton: no real agent has been materialized in the DB yet for any
 * consumer project, so this always returns an empty list (never a
 * fabricated/mock agent) once auth + shape checks pass. Wiring to the real
 * store lands with the materialization work.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectKey: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { projectKey } = await params
  if (!isValidProjectKey(projectKey)) {
    return NextResponse.json({ error: 'invalid projectKey' }, { status: 400 })
  }

  const agents: PublishedAgent[] = []
  return NextResponse.json({ ok: true, projectKey, agents })
}
