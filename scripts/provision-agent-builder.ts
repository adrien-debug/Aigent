/**
 * Provision "Agent Builder Copilot" into the live gpu1 perimeter (base `aigent`).
 *
 * IDEMPOTENT and NON-DESTRUCTIVE: it never truncates. It resolves the copilot
 * by its stable slug; if a previous instance exists it is cascade-deleted (the
 * DB owns the cascade — versions/manifests/tools/test_* all ON DELETE CASCADE)
 * and re-created, so a re-run converges to exactly one clean instance without
 * touching any other row in the database.
 *
 * The write shape mirrors authoring-writes.ts exactly (same FK-safe order, same
 * columns) — but this script talks to PostgREST directly with `fetch` so it
 * stays free of the `server-only` guard that protects the app's data modules.
 * It is the ONLY consumer of that duplication, and it is a provisioning script,
 * not app code.
 *
 * Requires the live env (loaded via `node --env-file=.env.local`):
 *   AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run (same runner as scripts/seed-amc.ts — tsx resolves extensionless TS imports):
 *   node --env-file=.env.local "$(command -v npx)" -y tsx scripts/provision-agent-builder.ts
 */
import { randomBytes } from 'node:crypto'

import { AGENT_BUILDER_COPILOT, AGENT_BUILDER_SLUG, agentBuilderTestSuite } from '../src/lib/agent-mission-control/agent-builder-copilot'
import { makeId, slugify } from '../src/lib/agent-mission-control/slug'

function randomHex(bytes = 4): string {
  return randomBytes(bytes).toString('hex')
}

type Row = Record<string, unknown>

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
  console.error('live backend not configured (need AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(1)
}

async function pgrest<T = Row[]>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key as string,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`PostgREST ${res.status} on ${method} ${pathAndQuery}: ${(await res.text()).slice(0, 300)}`)
  if (res.status === 204) return [] as unknown as T
  const text = await res.text()
  return (text ? JSON.parse(text) : []) as T
}

async function main() {
  const input = AGENT_BUILDER_COPILOT

  // 1. Idempotency — cascade-delete any prior instance (DB owns the cascade).
  const prior = await pgrest<{ id: string }[]>('GET', `copilots?select=id&slug=eq.${encodeURIComponent(AGENT_BUILDER_SLUG)}`)
  if (prior[0]) {
    await pgrest('DELETE', `copilots?id=eq.${encodeURIComponent(prior[0].id)}`)
    console.log(`removed prior instance: ${prior[0].id}`)
  }

  const now = new Date().toISOString()
  const rand = randomHex()
  const slug = input.slug || slugify(input.name)
  const copilotId = makeId('copilot', `${slug}-${rand}`)
  const manifestId = makeId('manifest', `${slug}-${rand}`)
  const versionId = makeId('version', `${slug}-${rand}`)

  // 2. copilots (parent first — every child FK resolves)
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
    health: { testPassRate: 0, benchmarkScore: 0, runsLast24h: 0, errorRateLast24h: 0, avgLatencyMs: 0, costLast24hUsd: 0 },
    created_via: 'authoring',
  })

  // 3. manifest (tool_ids backfilled after tools are created)
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

  // 4. tools (read-only first + one gated write tool), collect ids
  const toolIds: string[] = []
  for (const t of input.manifest.proposedTools) {
    const rows = await pgrest<Row[]>('POST', 'tools', {
      id: makeId('tool', `${slugify(t.name)}-${randomHex()}`),
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

  // 5. draft version (points at the manifest)
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
  console.log(`created copilot: ${copilotId} (${toolIds.length} tools)`)

  // 6. initial safety+behaviour test suite (+ cases)
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
  console.log(`created test suite: ${suiteId} (${suite.cases.length} cases)`)
  console.log('OK — Agent Builder Copilot provisioned on the validation bench.')
}

main().catch((err) => {
  console.error('provisioning failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
