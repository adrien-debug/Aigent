import 'server-only'

import { after } from 'next/server'
import { NextResponse } from 'next/server'

import { prepareAutoEval } from '@/lib/agent-mission-control/agent-autoeval'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'
import {
  draftToCreateInput,
  resumeAgentBuilderRun,
  type BuilderRunState,
} from '@/lib/agent-mission-control/agent-builder-run'
import { createCopilotFromManifest, setCopilotAssistantId } from '@/lib/agent-mission-control/authoring-writes'
import { ensureCopilotAssistant } from '@/lib/agent-mission-control/langgraph-assistants'
import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'

/** LangGraph thread_id — always a server-minted UUID before it hits the Agent Server. */
export const AGENT_BUILDER_RUN_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AgentBuilderRepoScan = {
  repo: string
  branch: string
  scripts: Record<string, string>
}

export function isAgentBuilderLiveBackendConfigured(): boolean {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(base) &&
    Boolean(key) &&
    Boolean(process.env.OPENAI_API_KEY)
  )
}

export function liveBackendNotConfiguredResponse(): NextResponse {
  return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
}

export async function parseAgentBuilderResumeRequest(
  request: Request
): Promise<{ ok: true; runId: string; approved: boolean } | { ok: false; response: NextResponse }> {
  let body: { runId?: unknown; approved?: unknown }
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) }
  }
  if (typeof body.runId !== 'string' || body.runId.trim().length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'runId is required' }, { status: 400 }) }
  }
  if (!AGENT_BUILDER_RUN_ID_RE.test(body.runId)) {
    return { ok: false, response: NextResponse.json({ error: 'invalid runId' }, { status: 400 }) }
  }
  if (typeof body.approved !== 'boolean') {
    return { ok: false, response: NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 }) }
  }
  return { ok: true, runId: body.runId, approved: body.approved }
}

export async function resolveAgentBuilderCopilot(
  logLabel: string
): Promise<{ ok: true; copilotId: string } | { ok: false; response: NextResponse }> {
  try {
    const rows = await pgrest<{ id: string }[]>(
      'GET',
      `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
    )
    if (!rows[0]) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Agent Builder is not provisioned', notProvisioned: true },
          { status: 409 }
        ),
      }
    }
    return { ok: true, copilotId: rows[0].id }
  } catch (err) {
    console.error(`[${logLabel}] failed to resolve Agent Builder`, err)
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'failed to resolve Agent Builder' },
        { status: isPgrestTimeout(err) ? 504 : 502 }
      ),
    }
  }
}

function isThreadLostError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : 'resume failed'
  return /\b404\b|not found/i.test(message)
}

/**
 * Shared HITL resume path for architect (bench) and project builder flows.
 * Persists an approved draft, provisions its assistant, and kicks off auto-eval.
 */
export async function handleAgentBuilderResume(args: {
  logLabel: string
  copilotId: string
  runId: string
  approved: boolean
  projectId: string | null
  repoScan?: AgentBuilderRepoScan | null
  /** Builder routes also surface a top-level `error` key on persist failure. */
  persistErrorIncludesTopLevelError?: boolean
}): Promise<NextResponse> {
  const {
    logLabel,
    copilotId,
    runId,
    approved,
    projectId,
    repoScan = null,
    persistErrorIncludesTopLevelError = false,
  } = args

  let state: BuilderRunState
  try {
    state = await resumeAgentBuilderRun({
      copilotId,
      runId,
      approved,
      ...(projectId ? { projectId } : {}),
      repoScan,
    })
  } catch (err) {
    if (isThreadLostError(err)) {
      return NextResponse.json(
        {
          error: 'the approval thread was lost (Agent Server restarted) — relaunch the run',
          threadLost: true,
        },
        { status: 409 }
      )
    }
    console.error(`[${logLabel}] resume failed`, err)
    return NextResponse.json(
      { error: 'Agent Builder resume failed' },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }

  if (!approved || !state.manifestDraft) {
    return NextResponse.json(state)
  }

  let createdCopilotId: string
  try {
    const createInput = draftToCreateInput(state.manifestDraft, state.selectedTools, projectId)
    createdCopilotId = await createCopilotFromManifest(createInput)
  } catch (err) {
    console.error(`[${logLabel}] draft persistence failed`, err)
    const persistError = 'the draft was approved but could not be saved — retry'
    return NextResponse.json(
      {
        ...state,
        createdCopilotId: null,
        persistError,
        ...(persistErrorIncludesTopLevelError ? { error: persistError } : {}),
      },
      { status: isPgrestTimeout(err) ? 504 : 502 }
    )
  }

  try {
    const assistantId = await ensureCopilotAssistant({ copilotId: createdCopilotId })
    await setCopilotAssistantId(createdCopilotId, assistantId)
    const runEval = await prepareAutoEval(createdCopilotId)
    after(runEval)
    return NextResponse.json({ ...state, createdCopilotId, assistantId })
  } catch (err) {
    console.error(`[${logLabel}] assistant provisioning failed`, err)
    return NextResponse.json({
      ...state,
      createdCopilotId,
      assistantId: null,
      assistantError:
        'the draft was created but its LangGraph assistant could not be provisioned — reprovision it from the agent page',
    })
  }
}
