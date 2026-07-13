import { NextResponse } from 'next/server'

import { getProject } from '@/lib/agent-mission-control/data'
import { scanProjectRepo } from '@/lib/agent-mission-control/repo-scan'

/**
 * POST /api/agent-ops/projects/:id/repo/scan — read-only scan of a project's
 * linked GitHub repo.
 *
 * Returns a structured RepoScanSummary (stack, scripts, routes, apiRoutes,
 * components, tests, designSystemSignals, riskNotes). READ-ONLY: it only reads
 * the repo tree + a bounded set of key files via github.ts (which validates
 * paths and refuses secret/credential files). It NEVER writes to GitHub and
 * NEVER returns a secret value.
 *
 * Auth: enforced by src/proxy.ts. Fail-closed 503 without the gpu1 backend +
 * GITHUB_TOKEN. 404 if the project is unknown, 409 if it has no linked repo,
 * 502 on a GitHub/transport error (message not forwarded verbatim).
 */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured (GITHUB_TOKEN missing)' }, { status: 503 })
  }

  let project
  try {
    project = await getProject(id)
  } catch (err) {
    console.error('[agent-ops/projects/repo/scan] failed to load project', err)
    return NextResponse.json({ error: 'failed to load project' }, { status: 502 })
  }
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }
  if (!project.repoFullName) {
    return NextResponse.json({ error: 'project has no linked GitHub repo', noRepo: true }, { status: 409 })
  }

  try {
    const scan = await scanProjectRepo(project)
    return NextResponse.json({ ok: true, scan })
  } catch (err) {
    // GitHub errors can carry rate-limit / repo-detail text — log server-side,
    // return a generic message so no internal detail reaches the client.
    console.error('[agent-ops/projects/repo/scan] repo scan failed', err)
    return NextResponse.json({ error: 'repo scan failed (GitHub unreachable or repo inaccessible)' }, { status: 502 })
  }
}
