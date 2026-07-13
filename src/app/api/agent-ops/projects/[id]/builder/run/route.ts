import { NextResponse } from 'next/server'

import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { startAgentBuilderRun } from '@/lib/agent-mission-control/agent-builder-run'
import { getProject } from '@/lib/agent-mission-control/data'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { repoScanToContext, scanProjectRepo } from '@/lib/agent-mission-control/repo-scan'

/**
 * POST /api/agent-ops/projects/:id/builder/run — start a REPO-AWARE Agent
 * Builder run scoped to a project.
 *
 * Scans the project's linked GitHub repo READ-ONLY, hands the summary to the
 * Agent Builder graph as context, and runs it to the human-approval interrupt.
 * The draft it proposes is repo-aware; on approval (via ./resume) it is
 * ATTACHED to this project. NOTHING is written to GitHub, nothing is created
 * before approval.
 *
 * Body: { userInput: string, scan?: RepoScanSummary }
 *   - If `scan` is provided (from POST …/repo/scan), it's reused (no re-scan).
 *   - Else the repo is scanned here.
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the gpu1 backend + OPENAI_API_KEY.
 */
const MAX_USER_INPUT_LENGTH = 32_000
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let body: { userInput?: unknown; scan?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.userInput !== 'string' || body.userInput.trim().length === 0) {
    return NextResponse.json({ error: 'userInput is required' }, { status: 400 })
  }
  if (body.userInput.length > MAX_USER_INPUT_LENGTH) {
    return NextResponse.json({ error: `userInput exceeds the ${MAX_USER_INPUT_LENGTH}-character limit` }, { status: 400 })
  }

  // Load the project (must exist + have a repo).
  let project
  try {
    project = await getProject(id)
  } catch (err) {
    console.error('[agent-ops/projects/builder/run] failed to load project', err)
    return NextResponse.json({ error: 'failed to load project' }, { status: 502 })
  }
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (!project.repoFullName) {
    return NextResponse.json({ error: 'project has no linked GitHub repo', noRepo: true }, { status: 409 })
  }

  // Resolve the Agent Builder copilot (the assistant that runs the graph).
  let builderCopilotId: string
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) {
      return NextResponse.json({ error: 'Agent Builder is not provisioned', notProvisioned: true }, { status: 409 })
    }
    builderCopilotId = rows[0].id
  } catch (err) {
    console.error('[agent-ops/projects/builder/run] failed to resolve Agent Builder', err)
    return NextResponse.json({ error: 'failed to resolve Agent Builder' }, { status: 502 })
  }

  // Reuse a provided scan, else scan the repo now (read-only).
  let scan
  if (process.env.GITHUB_TOKEN) {
    try {
      scan =
        body.scan && typeof body.scan === 'object'
          ? (body.scan as Awaited<ReturnType<typeof scanProjectRepo>>)
          : await scanProjectRepo(project)
    } catch (err) {
      console.error('[agent-ops/projects/builder/run] repo scan failed', err)
      // Non-fatal: the builder can still draft without repo context, just less
      // repo-aware. Surface the degradation rather than failing the whole run.
      scan = undefined
    }
  }

  const repoContext = scan ? repoScanToContext(scan) : undefined

  try {
    const state = await startAgentBuilderRun({
      copilotId: builderCopilotId,
      userInput: body.userInput,
      projectId: id,
      repoContext,
      repoScan: scan ? { repo: scan.repo, branch: scan.branch, scripts: scan.scripts } : null,
    })
    return NextResponse.json({ ...state, scan: scan ?? null })
  } catch (err) {
    console.error('[agent-ops/projects/builder/run] run failed', err)
    return NextResponse.json({ error: 'Agent Builder run failed' }, { status: 502 })
  }
}
