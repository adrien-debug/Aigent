import { NextResponse } from 'next/server'

import { getProject, getCopilot, getManifestForCopilot } from '@/lib/agent-mission-control/data'
import { pushAgentToRepo } from '@/lib/agent-mission-control/github'

/**
 * POST /api/agent-ops/projects/:id/push-agent — push a copilot's agent artifacts
 * to the project's linked GitHub repository.
 *
 * Body: { copilotId: string; confirm?: boolean }
 *
 * OUTBOUND SAFEGUARD — DRY-RUN BY DEFAULT.
 * A REAL push (writes to the remote GitHub repo) requires BOTH:
 *   1. body.confirm === true, AND
 *   2. process.env.GITHUB_PUSH_ENABLED === '1'.
 * If either is missing, the push is ALWAYS a dry-run (no remote mutation) — the
 * route never accidentally mutates a customer repo.
 *
 * Fail-closed 503 if the gpu1 backend or GITHUB_TOKEN is not configured (mirrors
 * the copilot run route). Data/secrets are server-only; this route never runs on
 * the client.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { copilotId?: string; confirm?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.copilotId !== 'string' || body.copilotId.trim().length === 0) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
  }
  const copilotId = body.copilotId

  // Fail-closed: live gpu1 backend must be configured.
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  // Load the project — must exist and have a linked GitHub repo.
  let project
  try {
    project = await getProject(id)
  } catch (err) {
    // Never forward the raw PostgREST error text to the client: it can carry
    // schema/query internals. Log server-side, generic message to the caller
    // (same convention as copilots/[copilotId]/run and projects/[id] DELETE).
    console.error('[agent-ops/push-agent] failed to load project', err)
    return NextResponse.json({ error: 'failed to load project' }, { status: 502 })
  }
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }
  if (!project.repoFullName) {
    return NextResponse.json(
      { error: 'project has no linked GitHub repo' },
      { status: 400 }
    )
  }

  // Load the copilot + its manifest.
  let copilot
  let manifest
  try {
    copilot = await getCopilot(copilotId)
    if (!copilot) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    manifest = await getManifestForCopilot(copilotId)
  } catch (err) {
    // Same rationale as above: don't leak raw PostgREST error text.
    console.error('[agent-ops/push-agent] failed to load copilot/manifest', err)
    return NextResponse.json({ error: 'failed to load copilot or manifest' }, { status: 502 })
  }
  if (!manifest) {
    return NextResponse.json({ error: 'copilot has no manifest' }, { status: 404 })
  }

  // Outbound safeguard: real push needs confirm:true AND GITHUB_PUSH_ENABLED=1.
  const dryRun = !(body.confirm === true && process.env.GITHUB_PUSH_ENABLED === '1')

  try {
    const result = await pushAgentToRepo({ project, copilot, manifest, dryRun })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'push failed'
    // Double-submit / concurrent-push race: two real pushes read the same
    // default-branch head commit, build two commits on top of it, then both
    // PATCH the ref with force:false. GitHub accepts the first and rejects
    // the second (422/409, non-fast-forward) — that's an expected outcome of
    // a race, not a backend failure, so surface it as 409 rather than 502
    // and tell the caller it's safe to retry (the branch has already moved).
    if (/GitHub (409|422) on PATCH .*\/git\/refs\/heads\//.test(message)) {
      return NextResponse.json(
        {
          error:
            'push conflict: the default branch advanced during this push (concurrent push?) — retry',
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
