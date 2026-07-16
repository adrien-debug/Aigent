import { NextResponse } from 'next/server'

import { provisionAgentBuilderCopilot } from '@/lib/agent-mission-control/provision-agent-builder-live'

/**
 * POST /api/agent-ops/copilots/provision-agent-builder — materialize the Agent
 * Builder Copilot into the live perimeter, idempotently.
 *
 * The point of this route: the Agent Builder Copilot must NEVER depend on a
 * human remembering to run `scripts/provision-agent-builder.ts`. Any operator
 * (or the /admin/agents empty-state banner) can POST here to make it appear in
 * `/admin/agents`. Calling it again when it already exists is a safe no-op —
 * the existing row is returned untouched (`created: false`), never duplicated,
 * never wiped.
 *
 * Auth: enforced by the identity gate in src/proxy.ts (valid admin session OR
 * x-amc-key) — this route sits under /api/agent-ops/, so an unauthenticated
 * request is rejected with 401 before it ever reaches this handler.
 *
 * Fail-closed 503 without the gpu1 backend, mirroring the sibling write routes.
 * Never fabricates a copilot id.
 */
// Double-submission guard: concurrent POSTs (e.g. a double-clicked empty-state
// banner) are serialized in-process. Without this, both racers pass the
// existence check in provisionAgentBuilderCopilot(); the DB `copilots.slug`
// UNIQUE constraint blocks the duplicate, but the loser would surface as a 502
// instead of the promised idempotent no-op. Serialized, the second call runs
// after the first and correctly observes the existing row (created: false).
let chain: Promise<unknown> = Promise.resolve()

export async function POST() {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const run = chain.then(() => provisionAgentBuilderCopilot())
    // Keep the chain alive on failure so the next request retries cleanly.
    chain = run.then(
      () => undefined,
      () => undefined
    )
    const result = await run
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (err) {
    // Never forward raw PostgREST error text (schema/constraint internals).
    console.error('[agent-ops/provision-agent-builder] provisioning failed', err)
    return NextResponse.json({ error: 'failed to provision Agent Builder' }, { status: 502 })
  }
}
