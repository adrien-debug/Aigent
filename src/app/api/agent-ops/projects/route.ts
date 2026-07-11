import { NextResponse } from 'next/server'

import { createProject } from '@/lib/agent-mission-control/authoring-writes'
import type { CreateProjectInput } from '@/lib/agent-mission-control/authoring-writes'

const PLATFORMS: ReadonlyArray<CreateProjectInput['platform']> = [
  'web',
  'desktop',
  'mobile',
  'api',
]

/**
 * POST /api/agent-ops/projects — LIVE creation of a project linked to a GitHub
 * repo: materializes a `CreateProjectInput` into a real `projects` row via
 * `createProject` (authoring-writes.ts). Mirror of copilots/route.ts.
 *
 * Live-only, fail-closed: without `AMC_DATA_SOURCE=gpu1` + Supabase env we
 * return 503 rather than fake a created project. Upstream write failure → 502.
 */
export async function POST(request: Request) {
  let body: CreateProjectInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!PLATFORMS.includes(body.platform)) {
    return NextResponse.json(
      { error: "platform must be one of 'web' | 'desktop' | 'mobile' | 'api'" },
      { status: 400 }
    )
  }

  // Fail-closed 503 when the live backend is not configured — never fake success.
  if (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const projectId = await createProject(body)
    return NextResponse.json({ ok: true, projectId }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'project creation failed' },
      { status: 502 }
    )
  }
}
