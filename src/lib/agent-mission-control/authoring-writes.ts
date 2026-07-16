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
import {
  assistantIdForCopilot,
  deleteCopilotAssistant,
  deleteProjectAssistant,
} from './langgraph-assistants'
import { pgrest, requireBackend } from './postgrest'
import { augmentProposedToolsWithRepoRead } from './repo-read-tools'
import { makeId, slugify } from './slug'
import type { TestSuite } from './types'

type RawRow = Record<string, unknown>

/** PostgREST equality filter: `col=eq.<url-encoded val>`. Shared by writes + deletes. */
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

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
    skills: input.manifest.skills ?? [],
    tool_ids: [],
    max_steps_per_run: input.manifest.maxStepsPerRun,
    max_cost_per_run_usd: input.manifest.maxCostPerRunUsd,
    updated_at: now,
  }
  await pgrest<RawRow[]>('POST', 'manifests', manifestPayload)

  // 3. tools (from proposedTools), collect their ids, backfill manifest.tool_ids
  const roleText = `${input.manifest.systemPromptSummary} ${input.description}`
  const proposedTools = augmentProposedToolsWithRepoRead(
    input.manifest.proposedTools,
    roleText,
    input.projectId !== null
  )
  const toolIds: string[] = []
  for (const proposed of proposedTools) {
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

/**
 * Persist the copilot's dedicated LangGraph assistant id onto its row. Split
 * from createCopilotFromManifest because the assistant is created on the Agent
 * Server AFTER the copilot + its manifest + tools exist (the assistant's
 * config.configurable is DERIVED from them) — the route calls
 * createCopilotFromManifest → ensureCopilotAssistant → setCopilotAssistantId in
 * order. Mirrors setProjectAssistantId. Fail-closed.
 */
export async function setCopilotAssistantId(copilotId: string, assistantId: string): Promise<void> {
  requireBackend()
  await pgrest<RawRow[]>('PATCH', `copilots?${eq('id', copilotId)}`, { assistant_id: assistantId })
}

/**
 * Persist the outcome of a REAL agent push (push-agent route) onto the copilot
 * row — the `last_push_*` columns exist since migration 0004 but were never
 * written until now. Called best-effort AFTER a successful non-dry-run push, so
 * the registry can surface when/where each copilot was last shipped. Mirrors
 * setCopilotAssistantId (requireBackend + a single parameterized PATCH via the
 * `eq` filter helper). Fail-closed; snake_case columns.
 */
export async function setCopilotPushStatus(
  copilotId: string,
  status: { lastPushStatus: string; lastPushedAt: string; lastPushCommitUrl: string | null }
): Promise<void> {
  requireBackend()
  await pgrest<RawRow[]>('PATCH', `copilots?${eq('id', copilotId)}`, {
    last_push_status: status.lastPushStatus,
    last_pushed_at: status.lastPushedAt,
    last_push_commit_url: status.lastPushCommitUrl,
  })
}

// ---------------------------------------------------------------------------
// Test-suite authoring shapes — consumed by agentBuilderTestSuite()
// (agent-builder-copilot.ts) and materialized by the provisioning script.
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
 * `owner/name` only — mirrors the regex enforced at the API boundary
 * (src/app/api/agent-ops/projects/route.ts). Re-checked HERE, in front of the
 * insert, as defense in depth: `repoFullName` is later interpolated verbatim
 * into GitHub API URLs by the Agent Server's tool registry
 * (src/langgraph/tool-registry.mjs) via copilot-behavior.ts's scope derivation,
 * so any future caller of `createProject` (script, another route) that skips
 * the HTTP-layer validation must not be able to persist a toxic value that
 * lets a run escape its repo scope.
 */
const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function assertValidRepoFullName(repoFullName: string | undefined): void {
  if (repoFullName === undefined) return
  const trimmed = repoFullName.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > 200 ||
    !REPO_FULL_NAME_RE.test(trimmed) ||
    trimmed.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(
      `invalid repoFullName: "${repoFullName}" (expected "owner/name", no "..", extra "/", "?", "#", "@", or spaces)`
    )
  }
}

/**
 * Insert a new `projects` row. Fail-closed (mirrors createCopilotFromManifest
 * and pgrest's requireBackend()); the id is deterministic (makeId('proj',
 * slug)) and created_at is stamped server-side the same way as the copilot
 * write (`new Date().toISOString()`). Returns the created project's id.
 */
export async function createProject(input: CreateProjectInput): Promise<string> {
  requireBackend()
  assertValidRepoFullName(input.repoFullName)

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
    repo_full_name: input.repoFullName?.trim() ?? null,
    created_at: now,
  }
  await pgrest<RawRow[]>('POST', 'projects', payload)

  return id
}

/**
 * Persist the project's dedicated LangGraph assistant id onto its row. Split
 * from createProject because the assistant is created on the Agent Server AFTER
 * the row exists (the assistant's metadata carries the projectId) — the route
 * calls createProject → ensureProjectAssistant → setProjectAssistantId in order.
 * Fail-closed (mirrors createProject).
 */
export async function setProjectAssistantId(projectId: string, assistantId: string): Promise<void> {
  requireBackend()
  await pgrest<RawRow[]>('PATCH', `projects?${eq('id', projectId)}`, { assistant_id: assistantId })
}

// ---------------------------------------------------------------------------
// Deletes — the DB owns the cascade. Every child FK (copilot_versions,
// manifests, tools, test_*, agent_runs, benchmark_*, replay/shadow/promotion/
// warnings, and the copilots→versions self-reference) is ON DELETE CASCADE, so
// deleting the parent row removes everything atomically in one statement.
// Verified live: DELETE copilots?id=eq.X clears its manifests/versions/tools.
// Live-only, fail-closed. Returns false if the row didn't exist.
// (The `eq` filter helper is defined at the top of this module.)
// ---------------------------------------------------------------------------

/**
 * Delete a copilot; the DB cascades every dependent row. Its dedicated LangGraph
 * assistant (0009) is torn down first (best-effort — a leftover assistant is
 * inert but would clutter Studio). The assistant id is deterministic (v5 of the
 * copilotId), so we can delete it even if the row's assistant_id column is null
 * (e.g. rollback of a copilot whose id was never persisted back).
 */
export async function deleteCopilotCascade(copilotId: string): Promise<boolean> {
  requireBackend()
  const existing = await pgrest<{ id: string; assistant_id: string | null }[]>(
    'GET',
    `copilots?select=id,assistant_id&${eq('id', copilotId)}`
  )
  if (existing.length === 0) return false

  // Tear down the copilot's assistant. Prefer the persisted id; fall back to the
  // deterministic v5 id so a rollback before the id was persisted still cleans up.
  const assistantId = existing[0].assistant_id ?? assistantIdForCopilot(copilotId)
  await deleteCopilotAssistant(assistantId)

  await pgrest('DELETE', `copilots?${eq('id', copilotId)}`)
  return true
}

/**
 * Delete a project. Its dedicated LangGraph assistant is removed first
 * (best-effort — a leftover assistant is inert but would clutter Studio), then
 * its assigned copilots are cascade-deleted (so no orphan copilot points at a
 * dead project), then the project row.
 */
export async function deleteProjectCascade(projectId: string): Promise<boolean> {
  requireBackend()
  const existing = await pgrest<{ id: string; assistant_id: string | null }[]>(
    'GET',
    `projects?select=id,assistant_id&${eq('id', projectId)}`
  )
  if (existing.length === 0) return false

  // Tear down the project's assistant on the Agent Server. Best-effort: a failed
  // assistant delete must not block deleting the project row (the assistant is
  // inert without a project pointing runs at it).
  const assistantId = existing[0].assistant_id
  if (assistantId) await deleteProjectAssistant(assistantId)

  // Route each copilot through deleteCopilotCascade so its dedicated assistant
  // (0009) is torn down too — a bare DELETE would leak the assistant.
  const copilots = await pgrest<{ id: string }[]>('GET', `copilots?select=id&${eq('project_id', projectId)}`)
  for (const copilot of copilots) {
    await deleteCopilotCascade(copilot.id)
  }
  await pgrest('DELETE', `projects?${eq('id', projectId)}`)
  return true
}
