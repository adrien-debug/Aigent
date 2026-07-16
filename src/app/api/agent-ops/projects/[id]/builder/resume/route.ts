import { after } from 'next/server'
import { NextResponse } from 'next/server'

import { prepareAutoEval } from '@/lib/agent-mission-control/agent-autoeval'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'

// NOT-WIRED au front (volontaire, à garder) : pendant HITL de `builder/run`
// (chemin granulaire). Le front passe par `builder/create-draft` (endpoint
// condensé qui gère run+resume). Conservé comme capacité de contrôle fin,
// doublon assumé de create-draft — pas du code mort.
import { resumeAgentBuilderRun, draftToCreateInput } from '@/lib/agent-mission-control/agent-builder-run'
import { createCopilotFromManifest, setCopilotAssistantId } from '@/lib/agent-mission-control/authoring-writes'
import { getProject } from '@/lib/agent-mission-control/data'
import { ensureCopilotAssistant } from '@/lib/agent-mission-control/langgraph-assistants'
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
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

// The runId is a LangGraph thread_id — always a randomUUID() minted server-side
// (startAgentBuilderRun returns result.threadId). It flows straight into the
// Agent Server URL path (`threads/{id}/state`, `threads/{id}/runs/wait`) via
// the SDK client which does NOT encode it, so constrain its shape to a UUID
// BEFORE it leaves for the upstream (same guard as architect/runs/[id]).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!UUID_RE.test(body.runId)) {
    return NextResponse.json({ error: 'invalid runId' }, { status: 400 })
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
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'failed to check project' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
  if (!projectExists) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Resolve the Agent Builder copilot (the assistant the run started on).
  let builderCopilotId: string
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) {
      // Same machine-readable discriminator as the sibling builder/run route,
      // which 409s with `notProvisioned: true` on this exact condition.
      return NextResponse.json({ error: 'Agent Builder is not provisioned', notProvisioned: true }, { status: 409 })
    }
    builderCopilotId = rows[0].id
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] failed to resolve Agent Builder', err)
    return NextResponse.json({ error: 'failed to resolve Agent Builder' }, { status: isPgrestTimeout(err) ? 504 : 502 })
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
    return NextResponse.json({ error: 'Agent Builder resume failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  // Reject or no draft → nothing created.
  if (!approved || !state.manifestDraft) {
    return NextResponse.json(state)
  }

  // APPROVED + draft → persist a real draft copilot ATTACHED to this project.
  let createdCopilotId: string
  try {
    const createInput = draftToCreateInput(state.manifestDraft, state.selectedTools, id)
    createdCopilotId = await createCopilotFromManifest(createInput)
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] draft persistence failed', err)
    // `error` = the canonical error key every non-2xx in agent-ops carries;
    // `persistError` is kept as the richer, state-scoped detail clients of the
    // builder family already read (data?.persistError ?? data?.error).
    return NextResponse.json(
      {
        ...state,
        createdCopilotId: null,
        error: 'the draft was approved but could not be saved — retry',
        persistError: 'the draft was approved but could not be saved — retry',
      },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }

  // Provision the draft's DEDICATED LangGraph assistant (config.configurable
  // derived from the manifest + tools just written) and persist its id onto the
  // copilot row — the SAME step the standalone copilot path runs (copilots/
  // route.ts, fix b540512). Without it the draft has a null assistant_id and its
  // runs fall back to the shared graph instead of its own behaviour config.
  //
  // Failure policy differs from the copilot path on purpose: there, a bare
  // copilot has no value so it's rolled back. Here the draft is a full,
  // project-attached agent that merely lacks its live assistant — deleting it
  // would throw away the operator's approved work. So on a provisioning failure
  // we KEEP the draft and return an honest warning; "Re-scan / reprovision"
  // (ensureCopilotAssistant is idempotent on the deterministic id) recovers it.
  try {
    const assistantId = await ensureCopilotAssistant({ copilotId: createdCopilotId })
    await setCopilotAssistantId(createdCopilotId, assistantId)
    // Auto-evaluate the new agent: generate its test + benchmark suites now
    // (synchronous, so the Quality tab is populated on this response), then run
    // them AFTER the response via after() so the agent's pass rate + score fill
    // in on their own — the operator never clicks "run".
    const runEval = await prepareAutoEval(createdCopilotId)
    after(runEval)
    return NextResponse.json({ ...state, createdCopilotId, assistantId })
  } catch (err) {
    console.error('[agent-ops/projects/builder/resume] assistant provisioning failed', err)
    return NextResponse.json({
      ...state,
      createdCopilotId,
      assistantId: null,
      assistantError: 'the draft was created but its LangGraph assistant could not be provisioned — reprovision it from the agent page',
    })
  }
}
