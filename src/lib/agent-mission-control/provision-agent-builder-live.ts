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
import { assertToolConfirmationInvariant } from './authoring-writes'
import { pgrest } from './postgrest'
import { makeId, slugify } from './slug'

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
 * cascade-deletes + recreates to converge a dev bench), this NEVER deletes an
 * existing copilot — an operator hitting the provision action from the UI must
 * not silently lose any edits made to the copilot. Re-provisioning from scratch
 * stays a deliberate script-only operation. The single exception is the
 * rollback of a copilot THIS call just created when a later step fails: without
 * it a half-provisioned row would remain and every retry would collide on the
 * unique slug.
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

  // Steps 2-5 run under a rollback guard: if any of them fails, the copilot row
  // created above would remain half-provisioned in DB (no manifest/version/tools)
  // and — because `copilots.slug` is UNIQUE — every retry would hit the
  // idempotency check and return the broken row forever. Best-effort cleanup:
  // DELETE the copilot we just created (the DB cascades every child row, see
  // authoring-writes.ts), log server-side, rethrow the ORIGINAL error so the
  // caller's error contract is unchanged.
  try {
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

    // 3. tools (read-only first + one gated write tool) — ids are generated
    // client-side, so ONE batch POST (PostgREST array body) replaces the
    // previous per-row inserts.
    //
    // Same confirmation invariant the other creation paths enforce: this is a
    // third writer into `tools`, and an invariant only one writer honours is
    // not an invariant. Throws before any insert, so nothing half-lands.
    assertToolConfirmationInvariant(input.manifest.proposedTools)
    const toolRows = input.manifest.proposedTools.map((t) => ({
      id: makeId('tool', `${slugify(t.name)}-${randHex()}`),
      copilot_id: copilotId,
      name: t.name,
      description: t.description,
      provider: t.provider,
      risk_level: t.riskLevel,
      enabled: true,
      requires_confirmation: t.requiresConfirmation,
      scoped_routes: [],
    }))
    if (toolRows.length > 0) await pgrest('POST', 'tools', toolRows)
    const toolIds = toolRows.map((t) => t.id)
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
      // Freshly provisioned, never benchmarked: unknown (null), not clean (0).
      scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: null },
    })

    // 5. initial safety+behaviour test suite (+ cases, one batch POST).
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
    const caseRows = suite.cases.map((c, i) => ({
      id: makeId('tc', `${slugify(suite.name)}-${rand}-${i + 1}`),
      suite_id: suiteId,
      name: c.name,
      input: c.input,
      expected_behavior: c.expectedBehavior,
      expected_tool_calls: c.expectedToolCalls,
      tags: c.tags,
    }))
    if (caseRows.length > 0) await pgrest('POST', 'test_cases', caseRows)
  } catch (err) {
    console.error(
      `[provision-agent-builder-live] provisioning failed after copilot insert — rolling back ${copilotId}`,
      err
    )
    try {
      // ON DELETE CASCADE on every child FK: one DELETE clears the partial lot.
      await pgrest('DELETE', `copilots?id=eq.${encodeURIComponent(copilotId)}`)
    } catch (cleanupErr) {
      console.error(
        `[provision-agent-builder-live] rollback DELETE failed for ${copilotId} — half-provisioned row may remain`,
        cleanupErr
      )
    }
    throw err
  }

  return { ok: true, copilotId, slug, created: true }
}

/** 8 hex chars of non-predictable id suffix (crypto, never Math.random). */
function randHex(): string {
  // node:crypto is available server-side; this module is server-only.
  return randomUUID().replace(/-/g, '').slice(0, 8)
}
