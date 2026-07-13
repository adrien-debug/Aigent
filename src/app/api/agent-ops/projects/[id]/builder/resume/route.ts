import { NextResponse } from 'next/server'

import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import { resumeAgentBuilderRun, draftToCreateInput } from '@/lib/agent-mission-control/agent-builder-run'
import { createCopilotFromManifest } from '@/lib/agent-mission-control/authoring-writes'
import { getProject } from '@/lib/agent-mission-control/data'
import { pgrest } from '@/lib/agent-mission-control/postgrest'
import { scanProjectRepo } from '@/lib/agent-mission-control/repo-scan'

/**
 * POST /api/agent-ops/projects/:id/builder/resume — human-in-the-loop decision
 * for a repo-aware Agent Builder run.
 *
 * Body: { runId: string, approved: boolean }
 *
 * On APPROVE: the gated draft tool runs and the proposal is persisted as a real
 * DRAFT copilot ATTACHED TO THIS PROJECT (status 'draft', project_id = this
 * project, never production). On REJECT: nothing is created.
 *
 * No GitHub write ever happens here — the release proposal in the returned state
 * is a plan, and `prCreation: 'ships-next'`.
 *
 * Auth: src/proxy.ts. Fail-closed 503 without the gpu1 backend + OPENAI_API_KEY.
 */
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

  let body: { runId?: unknown; approved?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body.runId !== 'string' || body.runId.trim().length === 0) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }
  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 })
  }
  const { runId, approved } = body

  // The project must exist to attach a draft to it.
  let projectExists = false
  try {
    const rows = await pgrest<{ id: string }[]>('GET', `projects?select=id&id=eq.${encodeURIComponent(id)}&limit=1`)
    projectExists = rows.length > 0
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] failed to check project', err)
    return NextResponse.json({ error: 'failed to check project' }, { status: 502 })
  }
  if (!projectExists) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Resolve the Agent Builder copilot (the assistant the run started on).
  let builderCopilotId: string
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) return NextResponse.json({ error: 'Agent Builder is not provisioned' }, { status: 409 })
    builderCopilotId = rows[0].id
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] failed to resolve Agent Builder', err)
    return NextResponse.json({ error: 'failed to resolve Agent Builder' }, { status: 502 })
  }

  // Re-scan the repo (cheap, read-only) so the release proposal keeps the
  // project's REAL npm gates on resume — best-effort, non-fatal if GitHub is
  // unreachable (the proposal falls back to `npm run verify`).
  let repoScan: { repo: string; branch: string; scripts: Record<string, string> } | null = null
  if (process.env.GITHUB_TOKEN) {
    try {
      const project = await getProject(id)
      if (project?.repoFullName) {
        const scan = await scanProjectRepo(project)
        repoScan = { repo: scan.repo, branch: scan.branch, scripts: scan.scripts }
      }
    } catch {
      // Non-fatal — release proposal uses its default gates.
    }
  }

  let state
  try {
    state = await resumeAgentBuilderRun({ copilotId: builderCopilotId, runId, approved, projectId: id, repoScan })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resume failed'
    if (/\b404\b|not found/i.test(message)) {
      return NextResponse.json(
        { error: 'the approval thread was lost (Agent Server restarted) — relaunch the run', threadLost: true },
        { status: 409 }
      )
    }
    console.error('[agent-ops/projects/builder/resume] resume failed', err)
    return NextResponse.json({ error: 'Agent Builder resume failed' }, { status: 502 })
  }

  // Reject or no draft → nothing created.
  if (!approved || !state.manifestDraft) {
    return NextResponse.json(state)
  }

  // APPROVED + draft → persist a real draft copilot ATTACHED to this project.
  try {
    const createInput = draftToCreateInput(state.manifestDraft, state.selectedTools, id)
    const createdCopilotId = await createCopilotFromManifest(createInput)
    return NextResponse.json({ ...state, createdCopilotId })
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] draft persistence failed', err)
    return NextResponse.json(
      { ...state, createdCopilotId: null, persistError: 'the draft was approved but could not be saved — retry' },
      { status: 502 }
    )
  }
}
