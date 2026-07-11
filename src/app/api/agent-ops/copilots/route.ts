import { NextResponse } from 'next/server'

import { createCopilotFromManifest } from '@/lib/agent-mission-control/authoring-writes'
import type { CreateCopilotInput } from '@/lib/agent-mission-control/authoring-types'

/**
 * POST /api/agent-ops/copilots — materialize a `CreateCopilotInput` (an
 * authoring draft's identity + generated manifest) into a REAL copilot:
 * a `copilots` row plus its `manifests`, `tools` and `copilot_versions`
 * rows. The multi-insert lives in one place — `createCopilotFromManifest`
 * (authoring-writes.ts) — which creates rows in FK-safe order (copilot first,
 * every child referencing it) and stamps required NOT NULL timestamps.
 *
 * Live-only, fail-closed: without `AMC_DATA_SOURCE=gpu1` + Supabase env,
 * `createCopilotFromManifest` throws; we surface 503 rather than fake a
 * created copilot. Body validation mirrors ./[copilotId]/route.ts.
 */
export async function POST(request: Request) {
  let body: CreateCopilotInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (!body.manifest || typeof body.manifest !== 'object') {
    return NextResponse.json({ error: 'manifest is required' }, { status: 400 })
  }

  // Fail-closed 503 when the live backend is not configured — never fake success.
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const copilotId = await createCopilotFromManifest(body)
    return NextResponse.json({ ok: true, copilotId }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'copilot creation failed' },
      { status: 502 }
    )
  }
}
