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

/** Registry keys the app knows how to mount. A tool name not here is dropped. */
const KNOWN_TOOL_IDS: ReadonlySet<string> = new Set<BehaviorToolId>([
  'read_repo_file',
  'list_repo_tree',
  'search_repo',
  'http_get',
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
])

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
 * Map ONE tool row to a behavior entry. Returns null for a tool whose name is
 * not a known registry key (the graph can't mount it, so it must not appear in
 * the config). Repo tools get scope.repoFullName; http_get gets an allowlist.
 */
function toBehaviorTool(row: ToolRowForBehavior, repoFullName?: string | null): BehaviorTool | null {
  const id = row.name as BehaviorToolId
  if (!KNOWN_TOOL_IDS.has(id)) return null

  const riskLevel: ToolRiskLevel = row.risk_level ?? 'low'
  const requiresConfirmation = row.requires_confirmation === true

  const entry: BehaviorTool = { id, riskLevel, requiresConfirmation }

  if (REPO_TOOL_IDS.has(id)) {
    entry.scope = { repoFullName: repoFullName ?? undefined }
  } else if (id === 'http_get') {
    entry.scope = { allowedHosts: deriveAllowedHosts(repoFullName) }
  }
  return entry
}

/**
 * Build the copilot's tool list. Every declared, KNOWN tool of the copilot maps
 * to an entry; unknown tool names are dropped (the graph can't mount them). The
 * five generic read/draft tools are ALWAYS present (added if not already
 * declared) so the config is complete and self-portant even for a copilot with
 * no tools of its own. Order: declared tools first (author intent), then any
 * missing generics.
 */
function buildTools(tools: ToolRowForBehavior[], repoFullName?: string | null): BehaviorTool[] {
  const out: BehaviorTool[] = []
  const seen = new Set<BehaviorToolId>()

  for (const row of tools) {
    const entry = toBehaviorTool(row, repoFullName)
    if (entry && !seen.has(entry.id)) {
      out.push(entry)
      seen.add(entry.id)
    }
  }

  for (const g of GENERIC_TOOL_DEFAULTS) {
    if (!seen.has(g.id)) {
      out.push({ id: g.id, riskLevel: g.riskLevel, requiresConfirmation: g.requiresConfirmation })
      seen.add(g.id)
    }
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
