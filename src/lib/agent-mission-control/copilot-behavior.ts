/**
 * Agent Mission Control — copilot behavior config builder (pure, isomorphic).
 *
 * ONE copilot ↔ ONE LangGraph assistant whose `config.configurable` carries the
 * copilot's ENTIRE behaviour (system prompt, model, step budget, confirmation
 * policy, and the real tools it may call with their scope). The graph
 * `agent_builder` READS this config and behaves accordingly — no behaviour is
 * hardcoded in the graph anymore (see the frozen contract:
 * scratchpad/ASSISTANT_CONFIG_CONTRACT.md, mirrored below).
 *
 * This module is PURE: it takes already-loaded DB rows (copilot + manifest +
 * tools + the project's repo full name) and returns the `CopilotBehaviorConfig`
 * object. It performs no IO, so it is trivially unit-testable and safe to import
 * from anywhere (the IO — loading rows, creating the assistant — lives in
 * langgraph-assistants.ensureCopilotAssistant).
 *
 * The Architect IA produces the manifest (systemPromptSummary, forbiddenActions,
 * outputContract, confirmationPolicy, proposedTools…). buildCopilotBehaviorConfig
 * is where that manifest becomes the assistant's operational identity: the
 * summary is COMPOSED into a real, complete system prompt (not passed raw).
 */
import { TOOL_IDS } from './registry/tools'
import type { ConfirmationPolicy, ModelProvider, ToolRiskLevel } from './types'

// ---------------------------------------------------------------------------
// The frozen contract shape (CopilotBehaviorConfig). C1 (the graph) reads this
// from config.configurable; C2 (this app) writes it. Kept in sync by hand with
// ASSISTANT_CONFIG_CONTRACT.md — the single source of truth.
// ---------------------------------------------------------------------------

/** Registry key of a REAL tool the graph can mount (see the contract's registry). */
export type BehaviorToolId =
  | 'read_repo_file'
  | 'list_repo_tree'
  | 'search_repo'
  | 'http_get'
  | 'read_project_summary'
  | 'read_copilot_summary'
  | 'read_recent_runs'
  | 'read_tool_permissions'
  | 'draft_copilot_spec'
  | 'count_words'
  | 'read_market_snapshot'
  | 'read_volatility_state'
  | 'read_market_structure'
  | 'read_multi_timeframe_candles'
  | 'read_liquidity_snapshot'
  | 'read_derivatives_snapshot'
  | 'read_macro_context'
  | 'read_funding_open_interest'
  | 'read_account_risk_snapshot'
  | 'resolve_address_to_section'
  | 'read_dvf_comparables'
  | 'read_market_listings'

/** One tool entry in the behavior config: registry key + per-copilot gating + scope. */
interface BehaviorTool {
  id: BehaviorToolId
  requiresConfirmation: boolean
  riskLevel: ToolRiskLevel
  scope?: {
    /** owner/name of the copilot's repo — required by the repo tools. */
    repoFullName?: string
    /** host allowlist for http_get; a GET to any other host is refused. */
    allowedHosts?: string[]
  }
}

/** Everything the graph needs to BE this copilot, carried in config.configurable. */
export interface CopilotBehaviorConfig {
  copilotId: string
  copilotName: string
  systemPrompt: string
  model: string
  /** Provider for the LangGraph path — mirrors copilots.model_provider. */
  modelProvider: ModelProvider
  maxSteps: number
  /**
   * Per-run USD ceiling, mirroring `manifests.max_cost_per_run_usd` — the cost
   * twin of `maxSteps`, carried down the SAME channel so the LangGraph path is
   * bounded by the number the UI already shows (it used to bind the direct
   * model-router path only). `null` = no ceiling configured, budget is steps-only.
   */
  maxCostPerRunUsd: number | null
  /**
   * Price of `model` under `modelProvider`, in USD per 1M tokens, resolved HERE
   * from the shared pricing table. It is transported because the graph runs in
   * a SEPARATE Node process that cannot import `model-pricing.ts` (server-only).
   * The graph must never invent a rate: no rates → no ceiling enforcement.
   * Same caveat as the table itself: conservative ESTIMATES, not billing truth.
   */
  modelPricing: { inputUsdPer1M: number; outputUsdPer1M: number } | null
  /**
   * Manifest `forbidden_actions`, transported so the LangGraph path can REFUSE
   * a targeted tool instead of merely describing the ban in the prompt. A
   * forbidden tool is a terminal refusal, never a confirmation prompt — an
   * interdiction is not something a human can approve away.
   */
  forbiddenActions: string[]
  confirmationPolicy: ConfirmationPolicy
  tools: BehaviorTool[]
  /**
   * Architect-proposed tool NAMES that resolved to NO registry id (see
   * resolveToolId) and were therefore dropped from `tools` above. Non-empty
   * means the copilot is running with FEWER tools than its manifest declares
   * — the system prompt may assume a capability that was never mounted. The
   * graph itself does not read this (inert extra field in config.configurable
   * — see the frozen contract in ASSISTANT_CONFIG_CONTRACT.md); it exists so
   * callers (runner.ts) can surface the loss to the operator instead of it
   * only living in a server console.warn. Empty array when nothing was lost.
   */
  unmappedToolNames: string[]
}

// ---------------------------------------------------------------------------
// Input rows (already loaded by the caller). Snake_case, straight from PostgREST.
// ---------------------------------------------------------------------------

/** The `copilots` row fields this builder reads. */
export interface CopilotRowForBehavior {
  id: string
  name: string
  /** May be null on legacy rows; we default it. */
  model?: string | null
  /** May be null on legacy rows; defaults to openai. */
  model_provider?: ModelProvider | string | null
}

/** The latest/production `manifests` row fields this builder reads. */
export interface ManifestRowForBehavior {
  system_prompt_summary?: string | null
  forbidden_actions?: string[] | null
  confirmation_policy?: ConfirmationPolicy | null
  always_confirm_actions?: string[] | null
  output_contract?: {
    format?: string | null
    schemaName?: string | null
    invariants?: string[] | null
  } | null
  max_steps_per_run?: number | null
  max_cost_per_run_usd?: number | null
}

/** One `tools` row fed to the builder (a tool that belongs to the copilot). */
export interface ToolRowForBehavior {
  name: string
  risk_level?: ToolRiskLevel | null
  requires_confirmation?: boolean | null
}

export interface BuildCopilotBehaviorInput {
  copilot: CopilotRowForBehavior
  /** May be undefined for a copilot with no manifest yet — we fall back to defaults. */
  manifest?: ManifestRowForBehavior | null
  tools: ToolRowForBehavior[]
  /** The copilot's project repo, owner/name, used to scope the repo tools. */
  repoFullName?: string | null
  /**
   * USD-per-1M-token rates for the copilot's model, supplied by the CALLER.
   * This module stays pure/isomorphic, so it must not import `model-pricing.ts`
   * (`server-only`); the caller that already runs server-side resolves the rates
   * (`computeCostUsd(provider, model, 1e6, 0)` / `(…, 0, 1e6)`) and passes them
   * here so they can be transported to the separate LangGraph process.
   * Omitted → `modelPricing: null` → the graph enforces NO cost ceiling rather
   * than enforcing one against a fabricated rate.
   */
  modelPricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null
}

// ---------------------------------------------------------------------------
// Defaults — the same values the direct-run path assumed, so a copilot with a
// thin manifest still yields a complete, self-portant config.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_MODEL_PROVIDER: ModelProvider = 'openai'

/**
 * `mistral` was removed from the union (declared but never wired). Legacy rows
 * may still carry it until the CHECK-constraint migration lands, so an unknown
 * string falls back to the default provider rather than crashing a read.
 */
function normalizeModelProvider(raw?: ModelProvider | string | null): ModelProvider {
  if (raw === 'openai' || raw === 'google' || raw === 'local') return raw
  return DEFAULT_MODEL_PROVIDER
}
const DEFAULT_MAX_STEPS = 12
const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = 'risky-only'

/** Registry keys of the real repo tools — these need scope.repoFullName. */
const REPO_TOOL_IDS: ReadonlySet<string> = new Set(['read_repo_file', 'list_repo_tree', 'search_repo'])
/** Market agents run least-privilege: only their explicitly enabled DB tools. */
const MARKET_TOOL_IDS: ReadonlySet<string> = new Set([
  'read_market_snapshot',
  'read_volatility_state',
  'read_market_structure',
  'read_multi_timeframe_candles',
  'read_liquidity_snapshot',
  'read_derivatives_snapshot',
  'read_funding_open_interest',
  'read_macro_context',
  'read_account_risk_snapshot',
])

/**
 * The REAL registry ids the graph can mount — now DERIVED from the canonical
 * Tool Registry (registry/tools.ts), not hand-copied. That registry is pure +
 * isomorphic (no @langchain, no PostgREST), so importing it here keeps this
 * module isomorphic while collapsing what used to be a hand-maintained parallel
 * list into a single authority.
 *
 * The `BehaviorToolId` union above stays as the TYPE guard, and the integrity
 * gate (check-registry-integrity.mjs) asserts the canonical `TOOL_IDS` equal
 * both this union AND the executable REGISTRY keys in tool-registry.mjs — so a
 * tool id can never exist in one place and be missing from another.
 *
 * The `as` cast is sound precisely because that gate proves the two id sets are
 * identical; it is not a convenience cast masking a mismatch.
 */
const REGISTRY_IDS: ReadonlyArray<BehaviorToolId> = TOOL_IDS as ReadonlyArray<BehaviorToolId>

/** Registry keys the app knows how to mount. A tool name not here is dropped. */
const KNOWN_TOOL_IDS: ReadonlySet<string> = new Set<BehaviorToolId>(REGISTRY_IDS)

// ---------------------------------------------------------------------------
// Semantic mapping — WHY: the Architect IA invents FREE tool names on the
// manifest (e.g. 'github_file_reader', 'github_code_search',
// 'github_pull_request_drafter'). Those names are NOT registry ids, so the graph
// (which only knows REGISTRY_IDS) would IGNORE them and the copilot would end up
// with none of the tools its prompt assumes (observed in prod: a "review repo"
// copilot got only the 5 generic reads, zero repo tool). We therefore translate
// each architect name to the REAL registry id whose executable tool realises
// that intent. A name whose intent we can't recognise is DROPPED (the registry
// would ignore it anyway) — we NEVER fabricate an id the registry doesn't know.
// ---------------------------------------------------------------------------

/**
 * Resolve a free-form architect tool name to a REAL registry id, or null when no
 * known intent matches. Case-insensitive and separator-tolerant (snake / kebab /
 * space) so 'github_file_reader', 'GitHub File Reader' and 'read-file' all land
 * on the same id. Order matters: more specific intents are tested before broader
 * ones (platform reads and tree/list before a bare "read repo", generic http_get
 * last). Deterministic: same input → same id, no IO.
 */
export function resolveToolId(rawName: string, hasRepo: boolean): BehaviorToolId | null {
  const lower = (rawName ?? '').toLowerCase()
  // Collapse every non-alphanumeric run to a single space → uniform matching.
  const n = lower.replace(/[^a-z0-9]+/g, ' ').trim()
  if (n.length === 0) return null

  // Exact registry id (the architect already used a real id) — accept as-is.
  if ((KNOWN_TOOL_IDS as ReadonlySet<string>).has(lower)) return lower as BehaviorToolId

  const has = (...words: string[]) => words.every((w) => n.includes(w))
  const any = (...words: string[]) => words.some((w) => n.includes(w))

  // --- Repo-file/tree/search intent signal — tested FIRST, before the platform
  //     reads below, but ONLY when the copilot actually HAS a repo. WHY: an
  //     architect name like 'read_project_file' / 'list_project_files' uses the
  //     word "project" but its intent is to read FROM THE REPO (file/tree/source).
  //     With a repo, we route it to the repo tool. WITHOUT a repo, the repo tool
  //     would be dropped downstream (toBehaviorTool) and the copilot would lose a
  //     tool it could otherwise have as a platform read — so when there's no repo
  //     we deliberately do NOT skip the platform reads, letting the name degrade
  //     gracefully to read_project_summary / read_copilot_summary instead of
  //     being dropped. Genuinely repo-only names (no project/copilot/run noun,
  //     e.g. 'read_source_file') still fall through to the repo rules and are
  //     dropped when no repo — there is no platform equivalent for them.
  const signalsRepoFile = any('file', 'files', 'repo', 'tree', 'folder', 'folders', 'directory', 'directories', 'source', 'code')
  const signalsReadIntent = any('read', 'reader', 'list', 'get', 'fetch', 'cat', 'open', 'view', 'search', 'find', 'query', 'grep', 'ls')
  const preferRepoIntent = hasRepo && signalsRepoFile && signalsReadIntent

  if (!preferRepoIntent) {
    // --- Platform reads (only when the name does NOT also signal a repo-file intent) ---
    if (has('project') && any('summary', 'summaries', 'list', 'read', 'info', 'get')) return 'read_project_summary'
    if (has('copilot') && any('summary', 'summaries', 'list', 'read', 'info', 'get')) return 'read_copilot_summary'
    if (any('run', 'runs', 'execution', 'executions') && any('recent', 'run', 'runs', 'history', 'read', 'list')) {
      return 'read_recent_runs'
    }
    if ((has('tool') && any('permission', 'permissions')) || has('permission', 'matrix')) {
      return 'read_tool_permissions'
    }
  }

  // --- Draft / propose-a-change intent → the only real, gated write tool.
  //     'github_pull_request_drafter' & co are an INTENTION to propose a change;
  //     we map to draft_copilot_spec (we never push a real PR / write).
  if (any('draft', 'drafter', 'propose', 'proposal', 'spec')) return 'draft_copilot_spec'
  if (has('pull', 'request')) return 'draft_copilot_spec'

  // --- Repo tree / directory listing (before "file", before bare "read repo") ---
  if (any('tree', 'directory', 'directories', 'folder', 'folders') || (has('list') && any('file', 'files', 'repo', 'dir', 'tree'))) {
    return 'list_repo_tree'
  }

  // --- Code search / grep inside the repo ---
  if (any('grep', 'codesearch')) return 'search_repo'
  if (has('code', 'search') || (any('search', 'find', 'query') && any('code', 'repo', 'file', 'files', 'source'))) {
    return 'search_repo'
  }

  // --- Read a single repo file (file reader / read file / get file) ---
  if (any('file', 'blob', 'content', 'contents', 'source') && any('read', 'reader', 'get', 'fetch', 'cat', 'open', 'view')) {
    return 'read_repo_file'
  }
  if (n.includes('repo') && any('read', 'reader', 'get') && !any('search', 'tree', 'list')) return 'read_repo_file'

  // --- Generic HTTP GET / URL fetch (last: broadest fetch intent) ---
  if (any('http', 'https', 'url', 'endpoint', 'webhook') && any('get', 'fetch', 'call', 'request')) return 'http_get'
  if (n === 'fetch' || n === 'http') return 'http_get'

  return null
}

/**
 * The generic read tools every copilot gets even if its manifest declares no
 * tools — so the config is ALWAYS complete and auto-portant (the graph mounts
 * exactly what the config lists, nothing implicit). draft_copilot_spec is the
 * gated write tool; it is confirmation-required by default.
 */
const GENERIC_TOOL_DEFAULTS: ReadonlyArray<{
  id: BehaviorToolId
  riskLevel: ToolRiskLevel
  requiresConfirmation: boolean
}> = [
  { id: 'read_project_summary', riskLevel: 'low', requiresConfirmation: false },
  { id: 'read_copilot_summary', riskLevel: 'low', requiresConfirmation: false },
  { id: 'read_recent_runs', riskLevel: 'low', requiresConfirmation: false },
  { id: 'read_tool_permissions', riskLevel: 'low', requiresConfirmation: false },
  { id: 'draft_copilot_spec', riskLevel: 'medium', requiresConfirmation: true },
]

// ---------------------------------------------------------------------------
// System prompt composition — the manifest summary is the SEED; we compose a
// real operational prompt around it (never ship the raw summary alone).
// ---------------------------------------------------------------------------

/**
 * Compose the copilot's full operational system prompt from its manifest. The
 * result is what the graph feeds the model — it must stand on its own:
 *  - the role/summary (from the Architect),
 *  - an explicit "You must never:" block listing the forbidden actions,
 *  - the output contract (format + schema + invariants) so replies are shaped,
 *  - the always-confirm actions the operator must approve,
 *  - a fixed operating posture (least-privilege, human-in-the-loop, honesty).
 * Empty/omitted manifest sections are skipped, never rendered as empty headers.
 */
export function composeSystemPrompt(args: {
  copilotName: string
  manifest?: ManifestRowForBehavior | null
  confirmationPolicy: ConfirmationPolicy
}): string {
  const { copilotName, manifest, confirmationPolicy } = args
  const summary = manifest?.system_prompt_summary?.trim()
  const forbidden = (manifest?.forbidden_actions ?? []).filter((s) => s && s.trim().length > 0)
  const alwaysConfirm = (manifest?.always_confirm_actions ?? []).filter((s) => s && s.trim().length > 0)
  const contract = manifest?.output_contract ?? null
  const invariants = (contract?.invariants ?? []).filter((s) => s && s.trim().length > 0)

  const parts: string[] = []

  // 1. Role / mission (Architect-authored summary, or an honest default).
  parts.push(
    summary?.length && summary.length > 0
      ? summary
      : `You are ${copilotName}, an autonomous copilot operating inside the Aigent platform. Assist the user by reasoning carefully and using ONLY the tools provided to you.`
  )

  // 2. Hard prohibitions — the runtime also gates these, but stating them makes
  //    the model refuse up front instead of attempting and being blocked.
  if (forbidden.length > 0) {
    parts.push(['You must never:', ...forbidden.map((a) => `- ${a}`)].join('\n'))
  }

  // 3. Output contract — how replies must be shaped.
  if (contract && (contract.format || contract.schemaName || invariants.length > 0)) {
    const lines: string[] = ['Output contract:']
    if (contract.format) lines.push(`- Respond in ${contract.format} format.`)
    if (contract.schemaName) lines.push(`- Conform to the "${contract.schemaName}" schema.`)
    for (const inv of invariants) lines.push(`- ${inv}`)
    parts.push(lines.join('\n'))
  }

  // 4. Actions that always require a human's approval regardless of policy.
  //    NOTE the wording: the model must still CALL the tool. The platform pauses
  //    it (see §5) — telling the model to "ask before taking these actions" made
  //    it write a chat question instead of emitting the tool call, so approval
  //    never triggered at all.
  if (alwaysConfirm.length > 0) {
    parts.push(
      [
        'These actions require a human approval. Call the tool as usual — the platform will pause it for approval before it runs:',
        ...alwaysConfirm.map((a) => `- ${a}`),
      ].join('\n')
    )
  }

  // 5. Fixed operating posture — the same for every copilot, non-negotiable.
  //
  // CRITICAL — how approval ACTUALLY works here (this wording is load-bearing):
  // the runtime gates tool calls. `approvalNode` (src/langgraph/agent-builder-graph.mjs)
  // intercepts a confirmation-required call BEFORE it executes and raises an
  // `interrupt()`, so the human approves or declines out-of-band; NO side effect
  // happens before the pause.
  // The old prompt said "Ask a human to confirm before any risky tool call". The
  // model obeyed LITERALLY: it wrote "confirm and I'll invoke it" in prose and
  // never emitted the tool call — so approvalNode saw nothing, interrupt() never
  // fired, and the human-in-the-loop gate silently never engaged. Asking the model
  // to self-police in chat DEFEATS the runtime gate. It must CALL the tool; the
  // platform does the pausing.
  const policyLine =
    confirmationPolicy === 'always'
      ? 'EVERY state-changing tool call is gated: call the tool normally — the platform pauses it and a human approves or declines before it runs. Do NOT ask for confirmation in your reply.'
      : confirmationPolicy === 'never'
        ? 'You may use read-only tools freely; you still have no authority to take irreversible actions without explicit user intent.'
        : 'Risky and state-changing tool calls are gated: call the tool normally — the platform pauses it and a human approves or declines before it runs. Do NOT ask for confirmation in your reply.'
  parts.push(
    [
      'Operating posture:',
      '- Least privilege: use the minimum tools needed; never invent tools you were not given.',
      `- Human-in-the-loop: ${policyLine}`,
      '- Never substitute a question for a tool call. If a tool is the right way to answer, CALL it — asking the user to confirm in prose does not run it, and the approval gate only engages on a real tool call.',
      '- Honesty: never fabricate tool results, data, or success. If a tool is unavailable or a request is out of scope, say so plainly.',
      '- Stay within your allowed scope; if asked to act outside it, explain why you cannot and stop.',
    ].join('\n')
  )

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Tool mapping — copilot's tools rows → behavior tool entries (id + scope).
// ---------------------------------------------------------------------------

/**
 * Derive a sensible http_get host allowlist from the repo. GitHub API + raw +
 * the repo host cover the common "read my repo / call GitHub" cases. Returns []
 * when there is no repo — an empty allowlist means the graph refuses every host
 * (fail-closed), which is the safe default for a tool that can reach the network.
 */
function deriveAllowedHosts(repoFullName?: string | null): string[] {
  if (!repoFullName || !repoFullName.includes('/')) return []
  return ['api.github.com', 'raw.githubusercontent.com', 'github.com']
}

/**
 * Attach the right scope to a behavior entry given its id. Repo tools get
 * scope.repoFullName (WITHOUT it read_repo_file/list_repo_tree/search_repo fail
 * at runtime — the registry returns "no repoFullName in scope"); http_get gets
 * a host allowlist; the platform reads and draft_copilot_spec need no scope.
 */
function scopeFor(id: BehaviorToolId, repoFullName?: string | null): BehaviorTool['scope'] | undefined {
  if (REPO_TOOL_IDS.has(id)) return { repoFullName: repoFullName ?? undefined }
  if (id === 'http_get') return { allowedHosts: deriveAllowedHosts(repoFullName) }
  return undefined
}

/**
 * Map ONE architect tool row to a behavior entry. The row's `name` is a FREE
 * architect name; we resolve it to a REAL registry id via resolveToolId. Returns
 * null when no intent matches (the graph can't mount it, so it must not appear in
 * the config — dropping it here matches what the registry would do anyway). The
 * resolved id — never the raw name — carries the scope.
 *
 * A resolved REPO tool id (read_repo_file / list_repo_tree / search_repo) is also
 * dropped when the copilot has no repo: mounting it with scope.repoFullName ===
 * undefined would fail at runtime ("no repoFullName in scope") — better to not
 * mount it at all than to mount a tool that is guaranteed to error. http_get is
 * NOT a repo tool: it is left as-is (an empty allowlist fails closed at runtime,
 * which is the intended safe default for a network-reaching tool).
 */
function toBehaviorTool(row: ToolRowForBehavior, repoFullName?: string | null): BehaviorTool | null {
  const id = resolveToolId(row.name, Boolean(repoFullName))
  if (!id) return null
  if (REPO_TOOL_IDS.has(id) && !repoFullName) return null

  const riskLevel: ToolRiskLevel = row.risk_level ?? 'low'
  const requiresConfirmation = row.requires_confirmation === true

  const entry: BehaviorTool = { id, riskLevel, requiresConfirmation }
  const scope = scopeFor(id, repoFullName)
  if (scope) entry.scope = scope
  return entry
}

/** The scoped repo tools a repo-linked copilot must ALWAYS be able to call. */
const REPO_INJECTED_TOOLS: ReadonlyArray<{
  id: BehaviorToolId
  riskLevel: ToolRiskLevel
  requiresConfirmation: boolean
}> = [
  { id: 'read_repo_file', riskLevel: 'low', requiresConfirmation: false },
  { id: 'list_repo_tree', riskLevel: 'low', requiresConfirmation: false },
  { id: 'search_repo', riskLevel: 'low', requiresConfirmation: false },
  { id: 'http_get', riskLevel: 'low', requiresConfirmation: false },
]

/**
 * Build the copilot's tool list. Three layers, de-duplicated by registry id
 * (first occurrence wins; a later layer only fills gaps / merges a missing
 * scope):
 *
 *  1. The architect's declared tools, each resolved from its FREE name to a REAL
 *     registry id (unresolvable names are dropped — the graph would ignore them).
 *  2. If the copilot is linked to a repo (repoFullName present), the scoped repo
 *     tools (read_repo_file / list_repo_tree / search_repo + http_get on the
 *     GitHub host) are GUARANTEED present — a copilot attached to a repo must be
 *     able to read it, whatever the architect happened to name. Scope is
 *     back-filled onto any already-present repo tool that lacks it.
 *  3. The generic platform reads + draft_copilot_spec are ALWAYS present as the
 *     base capability set, so the config is complete and self-portant.
 *
 * Market agents are the deliberate exception: when an enabled market tool is
 * declared, only layer 1 is mounted. This preserves their explicit
 * least-privilege mapping instead of reintroducing unrelated repo/generic tools.
 *
 * Every produced id is a REAL registry id — the graph mounts exactly this list.
 *
 * Returns the built tool list ALONGSIDE the architect-declared names that
 * mapped to no registry id (`unmappedToolNames`) — the caller (the config
 * builder) carries that list into CopilotBehaviorConfig so the loss is
 * visible to operators, not just a server console.warn.
 */
function buildTools(
  tools: ToolRowForBehavior[],
  repoFullName?: string | null
): { tools: BehaviorTool[]; unmappedToolNames: string[] } {
  const out: BehaviorTool[] = []
  const byId = new Map<BehaviorToolId, BehaviorTool>()
  const strictMarketConfig = tools.some((row) => MARKET_TOOL_IDS.has(row.name))

  const add = (entry: BehaviorTool) => {
    const existing = byId.get(entry.id)
    if (!existing) {
      out.push(entry)
      byId.set(entry.id, entry)
      return
    }
    // Already present: keep the first occurrence but back-fill a missing scope
    // (a repo tool with no repoFullName would fail at runtime — merge one in).
    if (!existing.scope && entry.scope) existing.scope = entry.scope
    else if (existing.scope && entry.scope) {
      if (existing.scope.repoFullName == null && entry.scope.repoFullName != null) {
        existing.scope.repoFullName = entry.scope.repoFullName
      }
      if ((existing.scope.allowedHosts == null || existing.scope.allowedHosts.length === 0) && entry.scope.allowedHosts) {
        existing.scope.allowedHosts = entry.scope.allowedHosts
      }
    }
  }

  // 1) Architect's declared tools (free names → real ids, scoped). A row is
  //    dropped when resolveToolId finds no matching registry intent, or when it
  //    resolves to a repo tool but the copilot has no repo (see toBehaviorTool).
  //    Collect the dropped names so an operator can see why a copilot's tool
  //    list is thinner than its manifest declares — silently losing intents
  //    here previously left no trace.
  //
  //    NOTE: a name that resolved to a repo-tool id but was dropped for lack
  //    of a repo is counted here too (toBehaviorTool returns null in that
  //    case as well). This is intentional: layer 2 below never fires without
  //    a repo either, so that name really did lose its tool for this build —
  //    worth surfacing, not a false positive.
  const droppedNames: string[] = []
  for (const row of tools) {
    const entry = toBehaviorTool(row, repoFullName)
    if (entry) add(entry)
    else droppedNames.push(row.name)
  }
  if (droppedNames.length > 0) {
    console.warn('[copilot-behavior] architect tools with no registry mapping, dropped:', droppedNames)
  }

  // 2) Repo-linked copilot → guarantee the scoped repo tools exist.
  if (!strictMarketConfig && repoFullName?.includes('/')) {
    for (const t of REPO_INJECTED_TOOLS) {
      add({ id: t.id, riskLevel: t.riskLevel, requiresConfirmation: t.requiresConfirmation, scope: scopeFor(t.id, repoFullName) })
    }
  }

  // 3) Generic platform reads + draft — the base capability set, no scope.
  if (!strictMarketConfig) {
    for (const g of GENERIC_TOOL_DEFAULTS) {
      add({ id: g.id, riskLevel: g.riskLevel, requiresConfirmation: g.requiresConfirmation })
    }
  }

  return { tools: out, unmappedToolNames: droppedNames }
}

// ---------------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------------

/**
 * Translate {copilot, manifest, tools, repoFullName} → CopilotBehaviorConfig,
 * the exact shape the frozen contract puts in the assistant's
 * config.configurable. Pure: no IO. Defaults fill every gap so the result is
 * always a complete, runnable behaviour (a thin/absent manifest never yields a
 * half-config).
 */
export function buildCopilotBehaviorConfig(input: BuildCopilotBehaviorInput): CopilotBehaviorConfig {
  const { copilot, manifest, tools, repoFullName } = input

  const confirmationPolicy: ConfirmationPolicy =
    manifest?.confirmation_policy ?? DEFAULT_CONFIRMATION_POLICY
  const built = buildTools(tools, repoFullName)
  const modelId = copilot.model?.trim() && copilot.model.trim().length > 0 ? copilot.model : DEFAULT_MODEL

  return {
    copilotId: copilot.id,
    copilotName: copilot.name,
    systemPrompt: composeSystemPrompt({ copilotName: copilot.name, manifest, confirmationPolicy }),
    model: modelId as string,
    modelProvider: normalizeModelProvider(copilot.model_provider),
    maxSteps: manifest?.max_steps_per_run ?? DEFAULT_MAX_STEPS,
    maxCostPerRunUsd:
      typeof manifest?.max_cost_per_run_usd === 'number' &&
      Number.isFinite(manifest.max_cost_per_run_usd) &&
      manifest.max_cost_per_run_usd > 0
        ? manifest.max_cost_per_run_usd
        : null,
    modelPricing: input.modelPricing ?? null,
    forbiddenActions: (manifest?.forbidden_actions ?? []).filter(
      (a): a is string => typeof a === 'string' && a.trim().length > 0
    ),
    confirmationPolicy,
    tools: built.tools,
    unmappedToolNames: built.unmappedToolNames,
  }
}
