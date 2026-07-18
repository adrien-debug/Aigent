import { NextResponse } from 'next/server'

import { getProject } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { isProjectId } from '@/lib/agent-mission-control/project-team/data'
import {
  createRelationBodySchema,
  insertProjectAgentRelation,
  isForeignKeyViolation,
  isUniqueViolation,
  verifyRelationEndpoints,
  type CreateRelationBody,
} from '@/lib/agent-mission-control/project-team/relations-write'

/**
 * POST /api/agent-ops/projects/:id/relations — create one explicit
 * agent-to-agent relation on the project's "My Team" canvas
 * (`project_agent_relations`, migration 0019).
 *
 * AUTH: enforced upstream by src/proxy.ts for every `/api/agent-ops/**`
 * path — a request without an admin session cookie and without a valid
 * `x-amc-key` never reaches this handler. No second gate here on purpose
 * (see team/route.ts's note: duplicating the check is how gates drift).
 *
 * Body (Zod, `.strict()`, bounded — see relations-write.ts):
 *   { sourceCopilotId, targetCopilotId, relationType, label? }
 * `relationType` is one of the 5 STORABLE kinds (`EXPLICIT_RELATION_TYPES`
 * in relations.ts) — `project-membership`, `team-membership` and
 * `shares-tool` are derived edge kinds with no backing row and are rejected
 * by the schema before this handler ever sees them.
 *
 * THE CRITICAL INVARIANT (stated by migration 0019 itself): the DB will
 * accept a row whose endpoints belong to a DIFFERENT project than
 * `project_id` — nothing at the schema level ties the three together.
 * `relations.ts` only rejects such rows at READ time (silently dropped).
 * This handler therefore re-verifies BOTH `sourceCopilotId` and
 * `targetCopilotId` belong to THIS project (`verifyRelationEndpoints`,
 * one batched query) before ever inserting — otherwise a caller could
 * create a relation that can never render and that nobody could explain.
 *
 * `project_id` on the inserted row is ALWAYS the PATH parameter, never
 * anything from the body — `createRelationBodySchema` is `.strict()`, so a
 * caller-supplied `projectId` fails validation rather than being silently
 * accepted and ignored.
 *
 * Status ladder (the repo-wide convention, not a local invention):
 *   201 relation created
 *   400 malformed project id / invalid body / self-edge
 *   404 unknown project
 *   409 duplicate relation (unique violation, Postgres 23505)
 *   422 an endpoint is not a copilot of THIS project (or does not exist),
 *       OR — a narrower race than `verifyRelationEndpoints` above catches —
 *       one of the two copilots was deleted between that check and the
 *       insert itself (foreign-key violation, Postgres 23503)
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params

  if (!isProjectId(projectId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: CreateRelationBody
  try {
    const raw: unknown = await request.json()
    const result = createRelationBodySchema.safeParse(raw)
    if (!result.success) {
      return NextResponse.json(
        { error: `invalid body: ${result.error.issues[0]?.message ?? 'schema mismatch'}` },
        { status: 400 }
      )
    }
    body = result.data
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(projectId)
  } catch (err) {
    console.error('[agent-ops/projects/relations] project lookup failed:', err)
    return NextResponse.json(
      { error: 'failed to check project' },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }

  // THE cross-project write guard — see the module doc above and
  // relations-write.ts for why this cannot be skipped.
  try {
    const verdict = await verifyRelationEndpoints(projectId, body.sourceCopilotId, body.targetCopilotId)
    if (!verdict.ok) {
      return NextResponse.json(
        {
          error: `not a copilot of this project: ${verdict.invalidIds.join(', ')}`,
        },
        { status: 422 }
      )
    }
  } catch (err) {
    console.error('[agent-ops/projects/relations] endpoint verification failed:', err)
    return NextResponse.json(
      { error: 'failed to verify relation endpoints' },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }

  let relationId: string
  try {
    relationId = await insertProjectAgentRelation({
      projectId,
      sourceCopilotId: body.sourceCopilotId,
      targetCopilotId: body.targetCopilotId,
      relationType: body.relationType,
      label: body.label,
    })
  } catch (err) {
    console.error('[agent-ops/projects/relations] insert failed:', err)
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'this relation already exists' }, { status: 409 })
    }
    if (isForeignKeyViolation(err)) {
      // A genuine race, not a client mistake: verifyRelationEndpoints (above)
      // confirmed both copilots existed in THIS project moments ago, but one
      // was deleted before this insert landed. 422 (client-actionable), never
      // the generic 502 a server-fault code would wrongly imply.
      return NextResponse.json(
        { error: 'one of the agents in this relation no longer exists' },
        { status: 422 }
      )
    }
    return NextResponse.json(
      { error: 'relation creation failed' },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }

  return NextResponse.json({ ok: true, relationId }, { status: 201 })
}
