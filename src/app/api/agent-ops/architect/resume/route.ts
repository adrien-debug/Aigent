import {
  handleAgentBuilderResume,
  isAgentBuilderLiveBackendConfigured,
  liveBackendNotConfiguredResponse,
  parseAgentBuilderResumeRequest,
  resolveAgentBuilderCopilot,
} from '@/lib/agent-mission-control/agent-builder-resume-route'

/**
 * POST /api/agent-ops/architect/resume — the human-in-the-loop decision for a
 * paused Agent Builder run.
 *
 * Body: { runId: string, approved: boolean }
 *
 * On APPROVE: the graph's gated `draft_copilot_spec` tool runs (producing the
 * proposal), and — because the human approved — this route PERSISTS that
 * proposal as a REAL draft copilot on the validation bench (status 'draft',
 * project_id null). That persisted copilot is the approved side-effect, written
 * through the same authoring write path any user-authored copilot uses. It is
 * NEVER promoted to production and never assigned to a project.
 *
 * On REJECT: the gated tool is blocked, nothing is created, and the run ends
 * `blocked`.
 *
 * Auth: enforced by src/proxy.ts. Fail-closed 503 without the gpu1 backend +
 * OPENAI_API_KEY. Never fabricates a resume, never creates on reject.
 */

const LOG_LABEL = 'agent-ops/architect/resume'

export async function POST(request: Request) {
  if (!isAgentBuilderLiveBackendConfigured()) {
    return liveBackendNotConfiguredResponse()
  }

  const parsed = await parseAgentBuilderResumeRequest(request)
  if (!parsed.ok) return parsed.response

  const resolved = await resolveAgentBuilderCopilot(LOG_LABEL)
  if (!resolved.ok) return resolved.response

  return handleAgentBuilderResume({
    logLabel: LOG_LABEL,
    copilotId: resolved.copilotId,
    runId: parsed.runId,
    approved: parsed.approved,
    projectId: null,
  })
}
