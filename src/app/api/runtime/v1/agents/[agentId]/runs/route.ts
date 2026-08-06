import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrest } from '@/lib/agent-mission-control/postgrest'
import { executeCopilotRun } from '@/lib/agent-mission-control/runner'
import { getPublishedAgent } from '@/lib/agent-mission-control/runtime-catalogue'
import {
  RUNTIME_CONTRACT_VERSION,
  isValidAgentId,
  resolveRuntimeTenant,
  tenantCanSeeProject,
  toRuntimeRunStatus,
} from '@/lib/agent-mission-control/runtime-api-types'
import type { ModelProvider } from '@/lib/agent-mission-control/types'

/** Matches the admin route's budget when a manifest carries no usable value. */
const DEFAULT_MAX_STEPS_PER_RUN = 12

/** Same ceiling as the admin run route — an unbounded input is a cost surface. */
const MAX_INPUT_LENGTH = 32_000

function upstreamFailureStatus(err: unknown): 502 | 504 {
  return isPgrestTimeout(err) ? 504 : 502
}

/**
 * POST /api/runtime/v1/agents/:agentId/runs — run one published agent.
 *
 * FAIL-CLOSED, and the gate is re-read at execution time rather than trusted
 * from whatever the consumer last fetched. A consumer's catalogue can be
 * minutes old; the agent may have been deactivated since. The canonical
 * catalogue is therefore consulted here, immediately before executing:
 *
 *   unknown id            → 404  (the consumer must be able to detect deletion)
 *   known but not runnable→ 409  (with the concrete reasons, never a bare no)
 *   catalogue unreachable → 503  (unknown executability is never "probably fine")
 *   missing/bad token     → 401  (or 503 when the API is not configured at all)
 *
 * `executable` is what decides — not `status`. An agent can be `active` and
 * still declare a tool that resolves to no registered handler.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await resolveRuntimeTenant(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const tenant = auth.tenant

  const { agentId } = await params
  if (!isValidAgentId(agentId)) {
    return NextResponse.json({ error: 'invalid agentId' }, { status: 400 })
  }

  let body: { input?: unknown }
  try {
    body = (await request.json()) as { input?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  }
  const input = body.input
  if (typeof input !== 'string' || input.trim().length === 0) {
    return NextResponse.json({ error: 'input is required' }, { status: 400 })
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return NextResponse.json({ error: `input exceeds the ${MAX_INPUT_LENGTH}-character limit` }, { status: 400 })
  }

  // The live backend must be configured before anything is attempted.
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // Idempotency: a consumer may send `Idempotency-Key` (the contract's
  // RuntimeRun.idempotencyKey). If a run for this (agent, key) already exists,
  // return it WITHOUT executing a second billed run — this is what stops a
  // retried POST (whose response was lost) from double-charging the model. The
  // key is persisted on agent_runs.client_run_id (migration 0027) so a later
  // retry finds it. NOTE: this dedups sequential retries fully; a truly
  // simultaneous double-submit could still bill twice before either persists,
  // but the unique index prevents a duplicate row.
  const idempotencyKey = (request.headers.get('idempotency-key') ?? '').trim().slice(0, 200) || null
  if (idempotencyKey) {
    try {
      // Scoped by project_id when the tenant is an installation, so a replayed
      // idempotency key cannot surface another tenant's prior run — this select
      // is a read, and a read of a foreign tenant's run is exactly the leak
      // this mission closes.
      const scopeFilter =
        tenant.kind === 'installation' ? `&project_id=eq.${encodeURIComponent(tenant.projectId)}` : ''
      const existing = await pgrest<Record<string, unknown>[]>(
        'GET',
        `agent_runs?copilot_id=eq.${encodeURIComponent(agentId)}&client_run_id=eq.${encodeURIComponent(idempotencyKey)}${scopeFilter}&select=id,status,output_summary,latency_ms,cost_usd,resolved_model,resolved_provider&limit=1`
      )
      const prior = existing[0]
      if (prior) {
        return NextResponse.json({
          contractVersion: RUNTIME_CONTRACT_VERSION,
          runId: prior.id as string,
          agentId,
          status: toRuntimeRunStatus((prior.status as import('@/lib/agent-mission-control/types').AgentRunStatus) ?? 'completed'),
          output: (prior.output_summary as string | null) ?? null,
          latencyMs: (prior.latency_ms as number | null) ?? null,
          costUsd: (prior.cost_usd as number | null) ?? null,
          resolvedProvider: (prior.resolved_provider as string | null) ?? null,
          resolvedModel: (prior.resolved_model as string | null) ?? null,
          idempotent: true,
        })
      }
    } catch (err) {
      console.error('[runtime/v1/agents/:id/runs] idempotency lookup failed', err)
      return NextResponse.json({ error: 'idempotency check failed' }, { status: upstreamFailureStatus(err) })
    }
  }

  // --- The gate, re-read now ------------------------------------------------
  let agent: Awaited<ReturnType<typeof getPublishedAgent>>
  try {
    agent = await getPublishedAgent(agentId, tenant)
  } catch (err) {
    console.error('[runtime/v1/agents/:id/runs] catalogue unavailable', err)
    return NextResponse.json({ error: 'catalogue unavailable' }, { status: 503 })
  }
  if (agent === undefined) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }
  if (!agent.executable) {
    return NextResponse.json(
      {
        error: 'agent is not executable',
        agentId,
        status: agent.status,
        reasons: agent.nonExecutableReasons,
      },
      { status: 409 }
    )
  }

  // --- Resolve what the runner needs ---------------------------------------
  let copilotRow: Record<string, unknown>
  try {
    const rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilots?id=eq.${encodeURIComponent(agentId)}&select=name,model,model_provider,project_id,production_version_id,latest_version_id`
    )
    if (rows.length === 0) return NextResponse.json({ error: 'agent not found' }, { status: 404 })
    copilotRow = rows[0]
  } catch (err) {
    console.error('[runtime/v1/agents/:id/runs] failed to load agent', err)
    return NextResponse.json({ error: 'failed to load agent' }, { status: upstreamFailureStatus(err) })
  }

  const versionId =
    (copilotRow.production_version_id as string | null) ?? (copilotRow.latest_version_id as string | null)
  const projectId = copilotRow.project_id as string | null
  // Both are already implied by `executable`; re-checked so a future change to
  // the derivation cannot silently let a run through without them.
  if (!versionId || !projectId) {
    return NextResponse.json(
      { error: 'agent is not executable', agentId, status: agent.status, reasons: ['missing version or project'] },
      { status: 409 }
    )
  }
  // Belt-and-braces re-check: `getPublishedAgent` above already filtered by
  // tenant, but this row was fetched by a separate query keyed only on
  // `agentId` — re-verify here so a future refactor of either path cannot
  // silently let a cross-tenant execution through. Same 404 shape as "agent
  // not found": existence of another tenant's agent is not revealed.
  if (!tenantCanSeeProject(tenant, projectId)) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }

  let systemPromptSummary = `You are ${copilotRow.name as string}, an autonomous agent.`
  let maxSteps = DEFAULT_MAX_STEPS_PER_RUN
  try {
    const versionRows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
    )
    const manifestId = versionRows[0]?.manifest_id as string | null | undefined
    if (manifestId) {
      const manifestRows = await pgrest<Record<string, unknown>[]>(
        'GET',
        `manifests?id=eq.${encodeURIComponent(manifestId)}&select=system_prompt_summary,max_steps_per_run`
      )
      const manifestRow = manifestRows[0]
      if (manifestRow) {
        if (typeof manifestRow.system_prompt_summary === 'string' && manifestRow.system_prompt_summary.length > 0) {
          systemPromptSummary = manifestRow.system_prompt_summary
        }
        const raw = manifestRow.max_steps_per_run
        if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw >= 1) {
          maxSteps = raw
        }
      }
    }
  } catch (err) {
    console.error('[runtime/v1/agents/:id/runs] failed to load version/manifest', err)
    return NextResponse.json({ error: 'failed to load version or manifest' }, { status: upstreamFailureStatus(err) })
  }

  const modelProvider = copilotRow.model_provider as string | null
  if (!modelProvider) {
    return NextResponse.json(
      {
        error: 'agent is not executable',
        agentId,
        status: agent.status,
        reasons: ['model provider not resolved'],
      },
      { status: 409 }
    )
  }

  // --- Execute --------------------------------------------------------------
  try {
    const result = await executeCopilotRun({
      copilotId: agentId,
      versionId,
      projectId,
      model: (copilotRow.model as string | null) ?? '',
      modelProvider: modelProvider as ModelProvider,
      systemPromptSummary,
      userInput: input,
      maxSteps,
      clientRunId: idempotencyKey ?? undefined,
    })

    return NextResponse.json({
      contractVersion: RUNTIME_CONTRACT_VERSION,
      runId: result.runId,
      agentId,
      // Published contract status, NEVER the internal AgentRunStatus verbatim —
      // a consumer's typed SDK cannot map `needs-confirmation`/`blocked`.
      status: toRuntimeRunStatus(result.status),
      output: result.outputSummary,
      latencyMs: result.latencyMs,
      // Null when unmeasured — an unrecorded cost is not a free run.
      costUsd: result.costUsd,
      resolvedProvider: result.resolvedProvider,
      resolvedModel: result.resolvedModel,
      // True ⇒ resolvedModel/fallbackUsed are NOT verified facts.
      modelUnverified: result.modelUnverified,
      fallbackUsed: result.fallbackUsed,
      interrupted: result.interrupted,
    })
  } catch (err) {
    console.error('[runtime/v1/agents/:id/runs] run execution failed', err)
    return NextResponse.json({ error: 'run execution failed' }, { status: upstreamFailureStatus(err) })
  }
}
