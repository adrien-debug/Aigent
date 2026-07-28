import { NextResponse } from 'next/server'

import {
  handleAgentBuilderResume,
  isAgentBuilderLiveBackendConfigured,
  liveBackendNotConfiguredResponse,
  parseAgentBuilderResumeRequest,
  resolveAgentBuilderCopilot,
} from '@/lib/agent-mission-control/agent-builder-resume-route'
import { getProject } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
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

// NOT-WIRED au front (volontaire, à garder) : pendant HITL de `builder/run`
// (chemin granulaire). Le front passe par `builder/create-draft` (endpoint
// condensé qui gère run+resume). Conservé comme capacité de contrôle fin,
// doublon assumé de create-draft — pas du code mort.

const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/
const LOG_LABEL = 'agent-ops/projects/builder/resume'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (!isAgentBuilderLiveBackendConfigured()) {
    return liveBackendNotConfiguredResponse()
  }

  const parsed = await parseAgentBuilderResumeRequest(request)
  if (!parsed.ok) return parsed.response

  let projectExists = false
  try {
    const rows = await pgrest<{ id: string }[]>('GET', `projects?select=id&id=eq.${encodeURIComponent(id)}&limit=1`)
    projectExists = rows.length > 0
  } catch (err) {
    console.error(`[${LOG_LABEL}] failed to check project`, err)
    return NextResponse.json(
      { error: 'failed to check project' },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }
  if (!projectExists) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const resolved = await resolveAgentBuilderCopilot(LOG_LABEL)
  if (!resolved.ok) return resolved.response

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

  return handleAgentBuilderResume({
    logLabel: LOG_LABEL,
    copilotId: resolved.copilotId,
    runId: parsed.runId,
    approved: parsed.approved,
    projectId: id,
    repoScan,
    persistErrorIncludesTopLevelError: true,
  })
}
