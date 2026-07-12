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
import type { ConfirmationPolicy, ToolRiskLevel } from './types'

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

/** One tool entry in the behavior config: registry key + per-copilot gating + scope. */
export interface BehaviorTool {
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
  maxSteps: number
  confirmationPolicy: ConfirmationPolicy
  tools: BehaviorTool[]
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
}

// ---------------------------------------------------------------------------
// Defaults — the same values the direct-run path assumed, so a copilot with a
// thin manifest still yields a complete, self-portant config.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_MAX_STEPS = 12
const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = 'risky-only'

/** Registry keys of the real repo tools — these need scope.repoFullName. */
const REPO_TOOL_IDS: ReadonlySet<string> = new Set(['read_repo_file', 'list_repo_tree', 'search_repo'])

/**
 * The REAL registry ids the graph can mount — the exact keys of REGISTRY in
 * src/langgraph/tool-registry.mjs (exported there as REGISTRY_IDS). Duplicated
 * here as a plain string list ON PURPOSE: this module is documented as pure and
 * isomorphic ("safe to import from anywhere"), and tool-registry.mjs pulls in
 * @langchain/core + a live PostgREST client — server-only side effects we must
 * NOT drag into an isomorphic module just to read a list of names. The list is
 * only strings and is guarded at build time by the `BehaviorToolId` union above
 * (any drift makes this array literal fail to typecheck).
 *
 * MUST STAY IN SYNC with tool-registry.mjs REGISTRY_IDS. If a tool id is added
 * to / removed from the registry, mirror it here AND in the BehaviorToolId
 * union. There is no runtime import to keep them honest — the type union is the
 * guard.
 */
const REGISTRY_IDS: ReadonlyArray<BehaviorToolId> = [
  'read_repo_file',
  'list_repo_tree',
  'search_repo',
  'http_get',
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
]

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
function resolveToolId(rawName: string, hasRepo: boolean): BehaviorToolId | null {
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
    summary && summary.length > 0
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
  if (alwaysConfirm.length > 0) {
    parts.push(
      ['Always ask a human to approve before taking any of these actions:', ...alwaysConfirm.map((a) => `- ${a}`)].join('\n')
    )
  }

  // 5. Fixed operating posture — the same for every copilot, non-negotiable.
  const policyLine =
    confirmationPolicy === 'always'
      ? 'Ask a human to confirm before EVERY tool call that changes state.'
      : confirmationPolicy === 'never'
        ? 'You may use read-only tools freely; you still have no authority to take irreversible actions without explicit user intent.'
        : 'Ask a human to confirm before any risky or state-changing tool call.'
  parts.push(
    [
      'Operating posture:',
      '- Least privilege: use the minimum tools needed; never invent tools you were not given.',
      `- Human-in-the-loop: ${policyLine}`,
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
 * Every produced id is a REAL registry id — the graph mounts exactly this list.
 */
function buildTools(tools: ToolRowForBehavior[], repoFullName?: string | null): BehaviorTool[] {
  const out: BehaviorTool[] = []
  const byId = new Map<BehaviorToolId, BehaviorTool>()

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
  if (repoFullName && repoFullName.includes('/')) {
    for (const t of REPO_INJECTED_TOOLS) {
      add({ id: t.id, riskLevel: t.riskLevel, requiresConfirmation: t.requiresConfirmation, scope: scopeFor(t.id, repoFullName) })
    }
  }

  // 3) Generic platform reads + draft — the base capability set, no scope.
  for (const g of GENERIC_TOOL_DEFAULTS) {
    add({ id: g.id, riskLevel: g.riskLevel, requiresConfirmation: g.requiresConfirmation })
  }

  return out
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

  return {
    copilotId: copilot.id,
    copilotName: copilot.name,
    systemPrompt: composeSystemPrompt({ copilotName: copilot.name, manifest, confirmationPolicy }),
    model: (copilot.model && copilot.model.trim().length > 0 ? copilot.model : DEFAULT_MODEL) as string,
    maxSteps: manifest?.max_steps_per_run ?? DEFAULT_MAX_STEPS,
    confirmationPolicy,
    tools: buildTools(tools, repoFullName),
  }
}
