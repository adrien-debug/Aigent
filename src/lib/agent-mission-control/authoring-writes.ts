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
import { pgrest, requireBackend } from './postgrest'
import { makeId, slugify } from './slug'
import type { TestSuite } from './types'

type RawRow = Record<string, unknown>

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
  await pgrest<RawRow[]>('POST', 'copilots', copilotPayload)

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
  await pgrest<RawRow[]>('POST', 'manifests', manifestPayload)

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
    const toolRows = await pgrest<RawRow[]>('POST', 'tools', toolPayload)
    toolIds.push(toolRows[0].id as string)
  }
  if (toolIds.length > 0) {
    await pgrest<RawRow[]>('PATCH', `manifests?id=eq.${encodeURIComponent(manifestId)}`, {
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
  await pgrest<RawRow[]>('POST', 'copilot_versions', versionPayload)

  return copilotId
}

// ---------------------------------------------------------------------------
// createTestSuiteWithCases — materialize a test suite + its cases
// ---------------------------------------------------------------------------

/** Authoring-time shape of one test case (no ids — assigned server-side). */
export interface NewTestCaseInput {
  name: string
  input: string
  expectedBehavior: string
  /** Tool names the case expects the agent to (not) call. */
  expectedToolCalls: string[]
  tags: string[]
}

/** Identity + cases for a new `test_suites` (+ `test_cases`) row set. */
export interface CreateTestSuiteInput {
  copilotId: string
  name: string
  description: string
  kind: TestSuite['kind']
  cases: NewTestCaseInput[]
}

/**
 * Insert a `test_suites` row plus one `test_cases` row per case (FK-safe:
 * suite first, cases reference it). Deterministic ids
 * (makeId('ts'/'tc', …)) so a re-run against a clean perimeter produces the
 * same rows; the run keeps `last_run_id` null (nothing has run yet).
 *
 * Fail-closed (mirrors createCopilotFromManifest). Returns the suite id.
 * The suite is the runnable target for `runTestSuite` (test-runner.ts) —
 * no fabricated results are written here.
 */
export async function createTestSuiteWithCases(input: CreateTestSuiteInput): Promise<string> {
  requireBackend()

  const uniqueSuffix = crypto.randomUUID().slice(0, 8)
  const suiteId = makeId('ts', `${slugify(input.name)}-${uniqueSuffix}`)

  // 1. suite (no last_run_id — nothing has run yet)
  const suitePayload: RawRow = {
    id: suiteId,
    copilot_id: input.copilotId,
    name: input.name,
    description: input.description,
    kind: input.kind,
    last_run_id: null,
  }
  await pgrest<RawRow[]>('POST', 'test_suites', suitePayload)

  // 2. cases (each references the suite created above)
  for (let i = 0; i < input.cases.length; i += 1) {
    const c = input.cases[i]
    const casePayload: RawRow = {
      id: makeId('tc', `${slugify(input.name)}-${uniqueSuffix}-${i + 1}`),
      suite_id: suiteId,
      name: c.name,
      input: c.input,
      expected_behavior: c.expectedBehavior,
      expected_tool_calls: c.expectedToolCalls,
      tags: c.tags,
    }
    await pgrest<RawRow[]>('POST', 'test_cases', casePayload)
  }

  return suiteId
}

// ---------------------------------------------------------------------------
// createProject — materialize a new project row
// ---------------------------------------------------------------------------

/** Identity + platform for a new `projects` row created via the authoring surface. */
export interface CreateProjectInput {
  name: string
  slug?: string
  description?: string
  platform: 'web' | 'desktop' | 'mobile' | 'api'
  repoUrl?: string
  repoFullName?: string
}

/**
 * Insert a new `projects` row. Fail-closed (mirrors createCopilotFromManifest
 * and pgrest's requireBackend()); the id is deterministic (makeId('proj',
 * slug)) and created_at is stamped server-side the same way as the copilot
 * write (`new Date().toISOString()`). Returns the created project's id.
 */
export async function createProject(input: CreateProjectInput): Promise<string> {
  requireBackend()

  const now = new Date().toISOString()
  const slug = input.slug?.trim() || slugify(input.name)
  const id = makeId('proj', slug)

  const payload: RawRow = {
    id,
    name: input.name,
    slug,
    description: input.description ?? '',
    platform: input.platform,
    repo_url: input.repoUrl ?? null,
    repo_full_name: input.repoFullName ?? null,
    created_at: now,
  }
  await pgrest<RawRow[]>('POST', 'projects', payload)

  return id
}

// ---------------------------------------------------------------------------
// Deletes — the DB owns the cascade. Every child FK (copilot_versions,
// manifests, tools, test_*, agent_runs, benchmark_*, replay/shadow/promotion/
// warnings, and the copilots→versions self-reference) is ON DELETE CASCADE, so
// deleting the parent row removes everything atomically in one statement.
// Verified live: DELETE copilots?id=eq.X clears its manifests/versions/tools.
// Live-only, fail-closed. Returns false if the row didn't exist.
// ---------------------------------------------------------------------------

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/** Delete a copilot; the DB cascades every dependent row. */
export async function deleteCopilotCascade(copilotId: string): Promise<boolean> {
  requireBackend()
  const existing = await pgrest<{ id: string }[]>('GET', `copilots?select=id&${eq('id', copilotId)}`)
  if (existing.length === 0) return false
  await pgrest('DELETE', `copilots?${eq('id', copilotId)}`)
  return true
}

/**
 * Delete a project. Its assigned copilots are cascade-deleted first (so no
 * orphan copilot points at a dead project), then the project row.
 */
export async function deleteProjectCascade(projectId: string): Promise<boolean> {
  requireBackend()
  const existing = await pgrest<{ id: string }[]>('GET', `projects?select=id&${eq('id', projectId)}`)
  if (existing.length === 0) return false
  const copilots = await pgrest<{ id: string }[]>('GET', `copilots?select=id&${eq('project_id', projectId)}`)
  for (const copilot of copilots) {
    await pgrest('DELETE', `copilots?${eq('id', copilot.id)}`)
  }
  await pgrest('DELETE', `projects?${eq('id', projectId)}`)
  return true
}
