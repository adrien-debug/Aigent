import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { isProjectId } from '@/lib/agent-mission-control/project-team/data'
import {
  deleteProjectAgentRelation,
  isValidRelationId,
} from '@/lib/agent-mission-control/project-team/relations-write'

/**
 * DELETE /api/agent-ops/projects/:id/relations/:relationId — remove one
 * explicit agent-to-agent relation from the project's "My Team" canvas
 * (`project_agent_relations`, migration 0019).
 *
 * AUTH: enforced upstream by src/proxy.ts for every `/api/agent-ops/**`
 * path — no second local gate here on purpose (see team/route.ts).
 *
 * THE CROSS-PROJECT DELETE GUARD: the delete is scoped by BOTH
 * `id=eq.<relationId>` AND `project_id=eq.<projectId>` in the same
 * PostgREST filter (`deleteProjectAgentRelation`, relations-write.ts).
 * Scoping by id alone would let an authenticated caller delete another
 * project's relation simply by guessing or enumerating a UUID — the same
 * class of bug as the cross-project WRITE the POST handler guards against.
 * A `relationId` that is real but belongs to another project therefore
 * 404s exactly like an unknown id would: the filter never matches, and
 * there is no oracle that distinguishes the two cases to the caller.
 *
 * `pgrest()` returns an EMPTY ARRAY (not a 404) when a DELETE matches no
 * row — this handler synthesizes the 404 itself.
 *
 * Status ladder (the repo-wide convention):
 *   400 malformed project id or relation id
 *   404 unknown project+relation pair (also covers a relation that belongs
 *       to a different project — see above)
 *   502 request-time upstream failure
 *   503 RESERVED for "live backend not configured"
 *   504 PostgREST timeout via isPgrestTimeout
 * Error bodies are always generic; the full error is logged server-side only.
 */

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; relationId: string }> }
) {
  const { id: projectId, relationId } = await params

  if (!isProjectId(projectId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  if (!isValidRelationId(relationId)) {
    return NextResponse.json({ error: 'invalid relationId' }, { status: 400 })
  }

  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const deleted = await deleteProjectAgentRelation(projectId, relationId)
    if (!deleted) {
      return NextResponse.json({ error: 'relation not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[agent-ops/projects/relations] delete failed:', err)
    return NextResponse.json({ error: 'delete failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
