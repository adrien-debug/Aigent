import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getPublishedAgents } from '@/lib/agent-mission-control/runtime-catalogue'
import { isValidProjectKey, requireRuntimeApiAuth } from '@/lib/agent-mission-control/runtime-api-types'

/**
 * GET /api/runtime/v1/projects/:projectKey/agents — the DOCUMENTED per-project
 * discovery route (runtime-api §2/§11): the scoped list a consumer calls to
 * find its own agents. The cross-project /agents route is the escape hatch the
 * contract forbids a consumer from relying on.
 *
 * Served from the canonical `getPublishedAgents()` derivation, filtered by
 * `projectKey` — the same source of truth the admin catalogue and the run gate
 * see. Fail-closed: catalogue unreadable → 503, never a fabricated agent and
 * never a truthful-looking empty 200 (which a consumer cannot tell apart from
 * "you have no agents"). A project with genuinely zero agents returns `[]`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectKey: string }> }) {
  const auth = requireRuntimeApiAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { projectKey } = await params
  if (!isValidProjectKey(projectKey)) {
    return NextResponse.json({ error: 'invalid projectKey' }, { status: 400 })
  }

  try {
    const agents = (await getPublishedAgents()).filter((a) => a.projectKey === projectKey)
    return NextResponse.json({ ok: true, projectKey, count: agents.length, agents })
  } catch (err) {
    console.error('[runtime/v1/projects/:projectKey/agents] catalogue read failed', err)
    return NextResponse.json(
      { error: isPgrestTimeout(err) ? 'catalogue timed out' : 'catalogue unavailable' },
      { status: 503 }
    )
  }
}
