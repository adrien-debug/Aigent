import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { getProjectTeamGraph } from '@/lib/agent-mission-control/project-team/data'
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
 * Status contract:
 *   400 malformed id · 404 unknown project · 503 backend unavailable /
 *   contract violation · 504 PostgREST timeout. Bodies are always generic —
 *   PostgREST internals (table shape, query, raw body) stay in the server log.
 */

/** Same shape guard as the sibling project routes (`makeId('proj', slug)`). */
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
    return NextResponse.json({ error: 'team graph unavailable' }, { status: 503 })
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
    return NextResponse.json({ error: 'team graph unavailable' }, { status: 503 })
  }

  return NextResponse.json(parsed.data)
}
