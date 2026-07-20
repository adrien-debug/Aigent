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

import type { CreateCopilotInput, ProposedTool } from './authoring-types'
import {
  assistantIdForCopilot,
  deleteCopilotAssistant,
  deleteProjectAssistant,
} from './langgraph-assistants'
import { pgrest, requireBackend } from './postgrest'
import { augmentProposedToolsWithRepoRead, isWriteCapableToolName } from './repo-read-tools'
import { makeId, slugify } from './slug'
import type { TestSuite } from './types'

type RawRow = Record<string, unknown>

/** PostgREST equality filter: `col=eq.<url-encoded val>`. Shared by writes + deletes. */
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

// ---------------------------------------------------------------------------
// Tool confirmation invariant — a write-capable or high/critical-risk tool
// created with requiresConfirmation=false is a silent gap: the release-gate
// (release-gate.ts) only blocks a copilot's PROMOTION when it carries
// high/critical tools; nothing today stops such a tool (or a medium-risk
// write tool) from being CREATED with confirmation off, so it runs unconfirmed
// long before promotion is ever attempted. Enforced here (defense in depth,
// mirrors the Zod refinement in api/agent-ops/copilots/route.ts) so a caller
// that bypasses the HTTP layer (a script, another route) can't persist the gap.
//
// THE CONTRACT (deterministic):
//
//   mutates === true  ||  riskLevel in (high, critical)   ⇒  requiresConfirmation
//
// `mutates` (ProposedTool.mutates, column `tools.mutates` — migration 0022) is
// the structural fact: "this tool writes, sends, publishes or spends
// something". It is authored by the architect, not guessed.
//
// STATUS CHANGE — the keyword heuristic below is DEMOTED. It used to BE the
// verdict: a ~30-verb English regex over `name || description` decided whether
// a tool was write-capable, and refused creation with no escape hatch. That was
// an authoring heuristic dressed up as truth — it rejected `submit_report`,
// `send_reminder_email` and `execute_query` (a SELECT), while letting a real
// mutator named `sync_ledger` or `apporter_modification` straight through.
//
// It is now, and only ever, a SUGGESTION: `suggestMutates()` proposes a default
// value of `mutates` to an author/UI. It is used as a verdict in exactly one
// residual case — when `mutates` is `undefined` (a tool row predating the
// migration). Unknown must not read as "safe", so we fall back to the old
// behaviour there, which fails closed. Once every tool carries an explicit
// `mutates`, the heuristic stops gating anything at all.
// ---------------------------------------------------------------------------

/**
 * The verbs BEYOND repo-read-tools.ts's `WRITE_TOOL_HINT`. Kept as a delta, not
 * a second full vocabulary: the base list stays the single place where "this
 * name looks write-capable" is defined, so widening it there widens both
 * checks instead of letting the two drift apart.
 */
const EXTRA_WRITE_CAPABLE_HINT =
  /(update|patch|\bput\b|remove|execute|trigger|send|approve|cancel|reject|revoke|grant|reset|purge|archive|restore|rename|move|upload|submit|assign|charge|refund|pay|transfer)/i

/**
 * AUTHORING SUGGESTION ONLY — never a verdict. Guesses, from a tool's
 * name+description, whether its author probably means `mutates: true`. Intended
 * to pre-fill the field in the authoring UI so the author can correct it. A
 * wrong guess costs one checkbox click, not a rejected tool.
 */
export function suggestMutates(tool: Pick<ProposedTool, 'name' | 'description'>): boolean {
  const haystack = `${tool.name} ${tool.description}`
  return isWriteCapableToolName(haystack) || EXTRA_WRITE_CAPABLE_HINT.test(haystack)
}

/**
 * True when a tool must be created with requiresConfirmation=true:
 *
 *   mutates === true || riskLevel in (high, critical)
 *
 * When `mutates` is undefined (a tool authored before `tools.mutates` existed)
 * we fall back to the legacy name heuristic — unknown must fail closed, so an
 * absent field preserves exactly the previous behaviour.
 *
 * Shared by the Zod refinement at the API boundary and the defense-in-depth
 * check just before the multi-insert.
 */
export function isHighRiskOrWriteCapableTool(
  tool: Pick<ProposedTool, 'riskLevel' | 'name' | 'description'> & { mutates?: boolean }
): boolean {
  if (tool.riskLevel === 'high' || tool.riskLevel === 'critical') return true
  if (tool.mutates !== undefined) return tool.mutates
  return suggestMutates(tool)
}

/**
 * Throws if any proposed tool is high/critical risk or write-capable but was
 * NOT marked requiresConfirmation=true. We REFUSE — never silently flip the
 * flag to true on the caller's behalf — so a caller who genuinely meant
 * unconfirmed low-stakes access gets a clear signal instead of a silently
 * "fixed" tool.
 */
export function assertToolConfirmationInvariant(tools: readonly ProposedTool[]): void {
  for (const tool of tools) {
    if (isHighRiskOrWriteCapableTool(tool) && !tool.requiresConfirmation) {
      throw new Error(
        `tool "${tool.name}" mutates state or is high/critical risk ` +
          `(riskLevel=${tool.riskLevel}, mutates=${tool.mutates ?? 'unknown'}) ` +
          `and must be created with requiresConfirmation=true`
      )
    }
  }
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
  // Defense in depth (mirrors the Zod refinement in the API route): refuse
  // BEFORE any row is written, rather than mid-multi-insert, so a violation
  // never strands a half-created copilot. augmentProposedToolsWithRepoRead
  // (below) only ever ADDS safe, low-risk, unconfirmed-by-design repo-read
  // tools, so checking the input's own list here is sufficient.
  assertToolConfirmationInvariant(input.manifest.proposedTools)

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
  // Ids are generated client-side (makeId), so the whole set inserts as ONE
  // batch POST (PostgREST bulk insert: array payload) instead of a round-trip
  // per tool.
  const toolPayloads: RawRow[] = proposedTools.map((proposed) => ({
    id: makeId('tool', `${slugify(proposed.name)}-${crypto.randomUUID().slice(0, 8)}`),
    copilot_id: copilotId,
    name: proposed.name,
    description: proposed.description,
    provider: proposed.provider,
    risk_level: proposed.riskLevel,
    enabled: true,
    requires_confirmation: proposed.requiresConfirmation,
    scoped_routes: [],
    // Migration 0022 is applied, so the column exists. An author who never
    // answered the question falls back to `true` — the same fail-closed
    // default the column carries: unknown is presumed mutating, never safe.
    mutates: proposed.mutates ?? true,
  }))
  const toolIds = toolPayloads.map((payload) => payload.id as string)
  if (toolIds.length > 0) {
    await pgrest<RawRow[]>('POST', 'tools', toolPayloads)
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
      // Never benchmarked yet — `null`, not a `0` that would claim a run
      // looked and found nothing.
      unsafeActionCount: null,
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

/**
 * Id-safe slug shape — mirrors the POST /projects route's guard (SLUG_RE
 * /^[a-z0-9-]+$/ + NAME_MAX 195): the project id is `proj-<slug>` and every
 * child route gates it with /^[a-z0-9-]{1,200}$/ ("proj-" eats 5 chars).
 * Re-checked HERE, in front of the insert, as defense in depth: createProject
 * persists the slug verbatim, so any future caller (script, another route)
 * that skips the HTTP-layer validation must not be able to persist a slug that
 * yields an unreachable project id or an empty non-null unique value.
 */
const PROJECT_SLUG_RE = /^[a-z0-9-]{1,195}$/

function assertValidProjectSlug(slug: string): void {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error(
      `invalid slug: "${slug}" (expected 1-195 chars of lowercase letters, digits, and hyphens)`
    )
  }
}

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
  assertValidProjectSlug(slug)
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

  // Tear down each copilot's dedicated assistant (0009) directly — a bare
  // DELETE would leak them. Prefer the persisted id; fall back to the
  // deterministic v5 id (mirrors deleteCopilotCascade). Then batch the row
  // deletes: ONE DELETE by project_id (the DB cascades every child row)
  // instead of a GET + DELETE round-trip per copilot.
  const copilots = await pgrest<{ id: string; assistant_id: string | null }[]>(
    'GET',
    `copilots?select=id,assistant_id&${eq('project_id', projectId)}`
  )
  for (const copilot of copilots) {
    await deleteCopilotAssistant(copilot.assistant_id ?? assistantIdForCopilot(copilot.id))
  }
  await pgrest('DELETE', `copilots?${eq('project_id', projectId)}`)
  await pgrest('DELETE', `projects?${eq('id', projectId)}`)
  return true
}
