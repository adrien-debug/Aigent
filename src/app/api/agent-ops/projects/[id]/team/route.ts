import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getProjectTeamGraph, isProjectId } from '@/lib/agent-mission-control/project-team/data'
import { projectTeamGraphSchema } from '@/lib/agent-mission-control/project-team/schema'

/**
 * GET /api/agent-ops/projects/:id/team — the project's team graph (agents of
 * THIS project + the relations that can be honestly derived from live data).
 *
 * AUTH: enforced upstream by src/proxy.ts for every `/api/agent-ops/**` path —
 * a request without an admin session cookie and without a valid `x-amc-key`
 * never reaches this handler, it gets a 401 JSON from the gate. That gate is
 * fail-closed (a missing AMC_SESSION_SECRET denies everything), so there is no
 * "no session configured → open" hole to re-check here. This route adds no
 * second gate of its own on purpose: duplicating the check in each handler is
 * exactly how gates drift out of sync.
 *
 * READ-ONLY. No write path, no LLM call, no secret in the response. The payload
 * is re-validated against the zod contract before it ships, so a data-layer
 * regression (a system prompt, a token, an agent from another project leaking
 * into the graph) fails the request instead of reaching a browser.
 *
 * Status contract — the repo-wide convention, not a local invention:
 *   400 malformed id
 *   404 unknown project
 *   500 the payload failed OUR OWN contract (a data-layer bug, not the
 *       client's and not the backend's — misreporting it as a backend problem
 *       sends operators to check a healthy service)
 *   502 request-time upstream failure (see postgrest.ts, and the siblings
 *       [id]/route.ts and missions/route.ts, which both return 502)
 *   503 RESERVED for "live backend not configured" — a deployment state, not a
 *       runtime failure (repo/intelligence/route.ts states this explicitly)
 *   504 PostgREST timeout, classified by isPgrestTimeout()
 *
 * Bodies are always generic — PostgREST internals (table shape, query, raw
 * body) stay in the server log.
 */

function envReady(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!isProjectId(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (!envReady()) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let graph: unknown
  try {
    graph = await getProjectTeamGraph(id)
  } catch (err) {
    // Full error server-side only: the thrown message can carry PostgREST
    // internals. The client gets a generic string, always.
    console.error('[agent-ops/projects/team] graph load failed:', err)
    if (isPgrestTimeout(err)) {
      return NextResponse.json({ error: 'team graph timed out' }, { status: 504 })
    }
    // 502, not 503: the backend IS configured (envReady() passed above) and
    // failed at request time. 503 here would tell the operator "not deployed"
    // about a service that is deployed and broken.
    return NextResponse.json({ error: 'team graph unavailable' }, { status: 502 })
  }

  if (graph === null || graph === undefined) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }

  // Outgoing contract check. A payload that does not satisfy the schema is a
  // BUG in the data layer, not a client error — we refuse to ship it rather
  // than let an unvalidated shape (possibly carrying a field that was never
  // meant to be public) reach the browser.
  const parsed = projectTeamGraphSchema.safeParse(graph)
  if (!parsed.success) {
    console.error('[agent-ops/projects/team] payload failed its own contract:', parsed.error.issues)
    // 500: this is OUR bug. The client's request was valid and the backend
    // answered — we assembled a payload that violates our own schema. Blaming
    // the backend with a 5xx-unavailable code would send operators to check a
    // service that is working fine.
    return NextResponse.json({ error: 'team graph unavailable' }, { status: 500 })
  }

  return NextResponse.json(parsed.data)
}
