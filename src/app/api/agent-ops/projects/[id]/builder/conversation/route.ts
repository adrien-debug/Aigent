import { NextResponse } from 'next/server'

import { getProject } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-conversation'

/**
 * GET /api/agent-ops/projects/:id/builder/conversation
 * Returns (or creates) the current project builder thread, recent messages, preview, repo summary.
 * Does not create any agent.
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

function requireLiveBackend(): NextResponse | null {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  return null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const blocked = requireLiveBackend()
  if (blocked) return blocked

  // The bundle helper CREATES a conversation row when none exists, so an
  // unknown project id must 404 here — otherwise this GET answers 200 and
  // persists a ghost conversation for a project that does not exist (same
  // guard as builder/run and builder/resume).
  let project
  try {
    project = await getProject(id)
  } catch (err) {
    console.error('[agent-ops/projects/builder/conversation] failed to load project', err)
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'failed to load project' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  try {
    const bundle = await getProjectBuilderConversationBundle(id)
    return NextResponse.json(bundle)
  } catch (err) {
    console.error('[agent-ops/projects/builder/conversation] GET failed', err)
    return NextResponse.json({ error: 'failed to load conversation' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
