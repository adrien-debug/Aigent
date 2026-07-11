/**
 * Agent Mission Control — authoring write layer (server only).
 *
 * PostgREST write helper backing the agent-authoring surface: the
 * multi-insert that materializes a ready draft into a real `copilots` row
 * (+ its `manifests`, `tools`, `copilot_versions` rows). Live-only,
 * fail-closed — mirrors data.ts's requireBackend() and the write pattern
 * already used by src/app/api/agent-ops/copilots/[copilotId]/route.ts.
 *
 * Never import this module from a client component: it reads the service
 * role key.
 */
import 'server-only'

import type { CreateCopilotInput } from './authoring-types'
import { makeId, slugify } from './slug'

// ---------------------------------------------------------------------------
// PostgREST minimal write client (fetch, service_role, zero deps) — fail-closed
// ---------------------------------------------------------------------------

function requireBackend(): { base: string; key: string } {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error(
      'Agent Mission Control is live-only: set AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY. No mock dataset is bundled.'
    )
  }
  return { base, key }
}

type RawRow = Record<string, unknown>

/**
 * POST/PATCH/GET against a PostgREST table, service_role, `Prefer:
 * return=representation` so inserts/updates hand back the persisted row(s).
 * Fail-closed: throws (never fabricates data) if the backend isn't live or
 * PostgREST returns a non-OK status.
 */
async function restWrite(
  method: 'POST' | 'PATCH' | 'GET',
  pathAndQuery: string,
  body?: unknown
): Promise<RawRow[]> {
  const { base, key } = requireBackend()
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${method} ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`)
  }
  if (method === 'GET' && res.status === 204) return []
  const text = await res.text()
  if (!text) return []
  return JSON.parse(text) as RawRow[]
}

/** snake_case → camelCase (top-level only; jsonb payloads are already camelCase). */
function camelRow<T>(row: RawRow): T {
  const out: RawRow = {}
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v
  }
  return out as T
}

/** camelCase → snake_case (top-level only; nested objects/arrays pass through untouched). */
function snakeRow(row: RawRow): RawRow {
  const out: RawRow = {}
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// createCopilotFromManifest — materialize a ready draft into a real copilot
// ---------------------------------------------------------------------------

/**
 * The multi-insert that turns a `CreateCopilotInput` (identity + a
 * `GeneratedManifest`) into a real, runnable copilot:
 *
 *   1. insert `manifests` (tool_ids starts empty — filled in step 3)
 *   2. insert `tools` rows from `manifest.proposedTools`, collect their ids
 *   3. PATCH the manifest's `tool_ids` with those ids
 *   4. insert `copilot_versions` (draft stage, pointing at the manifest)
 *   5. insert `copilots` (latestVersionId = the version from step 4)
 *
 * Returns the created copilot's id. Fail-closed and non-atomic (PostgREST
 * has no cross-table transaction here) — if a later step throws, earlier
 * rows remain persisted; callers should surface the error and let an
 * operator clean up rather than silently retry.
 */
export async function createCopilotFromManifest(input: CreateCopilotInput): Promise<string> {
  const now = new Date().toISOString()
  const uniqueSuffix = crypto.randomUUID().slice(0, 8)
  const slug = input.slug || slugify(input.name)

  // manifests.copilot_id, tools.copilot_id and copilot_versions.copilot_id are
  // all NOT NULL + FK → copilots(id), so the copilot row must exist FIRST. All
  // ids are deterministic (computed up front) so we can point rows at each other
  // before the referenced row is written, then create in FK-safe order.
  const copilotId = makeId('copilot', `${slug}-${uniqueSuffix}`)
  const manifestId = makeId('manifest', `${slug}-${uniqueSuffix}`)
  const versionId = makeId('version', `${slug}-${uniqueSuffix}`)

  // 1. copilots (created first so every child FK resolves). latest_version_id
  //    points at the version we create in step 4.
  const copilotPayload: RawRow = {
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
  }
  await restWrite('POST', 'copilots', copilotPayload)

  // 2. manifest (copilot_id now resolves)
  const manifestPayload: RawRow = {
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
  }
  await restWrite('POST', 'manifests', manifestPayload)

  // 3. tools (from proposedTools), collect their ids, backfill manifest.tool_ids
  const toolIds: string[] = []
  for (const proposed of input.manifest.proposedTools) {
    const toolPayload: RawRow = {
      id: makeId('tool', `${slugify(proposed.name)}-${crypto.randomUUID().slice(0, 8)}`),
      copilot_id: copilotId,
      name: proposed.name,
      description: proposed.description,
      provider: proposed.provider,
      risk_level: proposed.riskLevel,
      enabled: true,
      requires_confirmation: proposed.requiresConfirmation,
      scoped_routes: [],
    }
    const toolRows = await restWrite('POST', 'tools', toolPayload)
    toolIds.push(toolRows[0].id as string)
  }
  if (toolIds.length > 0) {
    await restWrite('PATCH', `manifests?id=eq.${encodeURIComponent(manifestId)}`, {
      tool_ids: toolIds,
    })
  }

  // 4. copilot_versions (draft stage, pointing at the manifest)
  const versionPayload: RawRow = {
    id: versionId,
    copilot_id: copilotId,
    label: 'v0.1.0-draft',
    stage: 'draft',
    manifest_id: manifestId,
    model: input.model,
    model_provider: input.modelProvider,
    changelog: 'Created via authoring assistant',
    created_at: now,
    created_by: input.owner,
    scores: {
      testPassRate: 0,
      benchmarkScore: 0,
      shadowAgreement: null,
      unsafeActionCount: 0,
    },
  }
  await restWrite('POST', 'copilot_versions', versionPayload)

  return copilotId
}
