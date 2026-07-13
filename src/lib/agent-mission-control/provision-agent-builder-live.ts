/**
 * Agent Mission Control — live provisioning of the Agent Builder Copilot (server only).
 *
 * ONE idempotent, non-destructive function that materializes the
 * `AGENT_BUILDER_COPILOT` spec (agent-builder-copilot.ts) into the live gpu1
 * perimeter — the SAME write shape scripts/provision-agent-builder.ts uses, but
 * routed through the app's `pgrest` client so it inherits the `server-only`
 * guard and the shared PostgREST auth.
 *
 * IDEMPOTENT: resolves the copilot by its stable slug. If an instance already
 * exists it is LEFT IN PLACE and returned as-is (created: false) — the UI must
 * never depend on a manual `provision-agent-builder.ts` run, and re-calling this
 * must not churn/duplicate the row or wipe an operator's edits. Only when the
 * slug is absent does it create the full lot (copilot → manifest → tools →
 * version → test suite + cases), in FK-safe order.
 *
 * Fail-closed: callers gate on AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY before invoking this (pgrest reads them itself and
 * throws otherwise). Never returns a fabricated id.
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { AGENT_BUILDER_COPILOT, AGENT_BUILDER_SLUG, agentBuilderTestSuite } from './agent-builder-copilot'
import { pgrest } from './postgrest'
import { makeId, slugify } from './slug'

type Row = Record<string, unknown>

export interface ProvisionAgentBuilderResult {
  ok: true
  /** The live copilot row id (`copilot-<slug>-<rand>`). Stable across re-runs once created. */
  copilotId: string
  /** Stable human-facing slug — the identity the UI/routes resolve by. */
  slug: string
  /** True when THIS call created the copilot; false when it already existed (idempotent no-op). */
  created: boolean
}

/**
 * Ensure the Agent Builder Copilot exists in the live perimeter. Returns the
 * existing row when present (idempotent), creates the full lot when absent.
 *
 * Non-destructive by design: unlike scripts/provision-agent-builder.ts (which
 * cascade-deletes + recreates to converge a dev bench), this NEVER deletes — an
 * operator hitting the provision action from the UI must not silently lose any
 * edits made to the copilot. Re-provisioning from scratch stays a deliberate
 * script-only operation.
 */
export async function provisionAgentBuilderCopilot(): Promise<ProvisionAgentBuilderResult> {
  const input = AGENT_BUILDER_COPILOT

  // Idempotency — if it already exists, return it untouched.
  const existing = await pgrest<{ id: string }[]>(
    'GET',
    `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}&limit=1`
  )
  if (existing[0]) {
    return { ok: true, copilotId: existing[0].id, slug: AGENT_BUILDER_SLUG, created: false }
  }

  const now = new Date().toISOString()
  // IDs carry a random suffix so a future re-create never collides, while the
  // slug stays the stable identity (mirrors authoring-writes.ts / the script).
  const rand = randHex()
  const slug = input.slug || slugify(input.name)
  const copilotId = makeId('copilot', `${slug}-${rand}`)
  const manifestId = makeId('manifest', `${slug}-${rand}`)
  const versionId = makeId('version', `${slug}-${rand}`)

  // 1. copilots (parent first — every child FK resolves).
  await pgrest('POST', 'copilots', {
    id: copilotId,
    project_id: input.projectId,
    target_project_ids: input.targetProjectIds,
    name: input.name,
    slug,
    description: input.description,
    runtime: input.runtime,
    status: 'draft',
    production_version_id: null,
    latest_version_id: versionId,
    model: input.model,
    model_provider: input.modelProvider,
    owner: input.owner,
    tags: input.tags,
    created_at: now,
    updated_at: now,
    health: {
      testPassRate: 0,
      benchmarkScore: 0,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
      openWarnings: 0,
    },
    created_via: 'authoring',
  })

  // 2. manifest (tool_ids backfilled after tools are created).
  await pgrest('POST', 'manifests', {
    id: manifestId,
    copilot_id: copilotId,
    version: 'v0.1.0-draft',
    system_prompt_summary: input.manifest.systemPromptSummary,
    allowed_routes: input.manifest.allowedRoutes,
    forbidden_actions: input.manifest.forbiddenActions,
    confirmation_policy: input.manifest.confirmationPolicy,
    always_confirm_actions: input.manifest.alwaysConfirmActions,
    memory_sources: [],
    output_contract: input.manifest.outputContract,
    tool_ids: [],
    max_steps_per_run: input.manifest.maxStepsPerRun,
    max_cost_per_run_usd: input.manifest.maxCostPerRunUsd,
    updated_at: now,
  })

  // 3. tools (read-only first + one gated write tool), collect ids.
  const toolIds: string[] = []
  for (const t of input.manifest.proposedTools) {
    const rows = await pgrest<Row[]>('POST', 'tools', {
      id: makeId('tool', `${slugify(t.name)}-${randHex()}`),
      copilot_id: copilotId,
      name: t.name,
      description: t.description,
      provider: t.provider,
      risk_level: t.riskLevel,
      enabled: true,
      requires_confirmation: t.requiresConfirmation,
      scoped_routes: [],
    })
    toolIds.push(rows[0].id as string)
  }
  await pgrest('PATCH', `manifests?id=eq.${encodeURIComponent(manifestId)}`, { tool_ids: toolIds })

  // 4. draft version (points at the manifest).
  await pgrest('POST', 'copilot_versions', {
    id: versionId,
    copilot_id: copilotId,
    label: 'v0.1.0-draft',
    stage: 'draft',
    manifest_id: manifestId,
    model: input.model,
    model_provider: input.modelProvider,
    changelog: 'Agent Builder Copilot — initial controlled draft',
    created_at: now,
    created_by: input.owner,
    scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: 0 },
  })

  // 5. initial safety+behaviour test suite (+ cases).
  const suite = agentBuilderTestSuite(copilotId)
  const suiteId = makeId('ts', `${slugify(suite.name)}-${rand}`)
  await pgrest('POST', 'test_suites', {
    id: suiteId,
    copilot_id: copilotId,
    name: suite.name,
    description: suite.description,
    kind: suite.kind,
    last_run_id: null,
  })
  for (let i = 0; i < suite.cases.length; i += 1) {
    const c = suite.cases[i]
    await pgrest('POST', 'test_cases', {
      id: makeId('tc', `${slugify(suite.name)}-${rand}-${i + 1}`),
      suite_id: suiteId,
      name: c.name,
      input: c.input,
      expected_behavior: c.expectedBehavior,
      expected_tool_calls: c.expectedToolCalls,
      tags: c.tags,
    })
  }

  return { ok: true, copilotId, slug, created: true }
}

/** 8 hex chars of non-predictable id suffix (crypto, never Math.random). */
function randHex(): string {
  // node:crypto is available server-side; this module is server-only.
  return randomUUID().replace(/-/g, '').slice(0, 8)
}
