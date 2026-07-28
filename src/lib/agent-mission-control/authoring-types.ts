/**
 * Agent Mission Control — authoring domain types.
 *
 * Shared contract for the agent-authoring surface (the "architect" assistant
 * that converses with a user, proposes a manifest, and — once ready — creates
 * a real `Copilot` row). Backed live by the `agent_drafts` table on gpu1
 * (`generated_manifest`, `conversation`, `created_copilot_id`). Pure types —
 * reuse the enum unions already established by the DB CHECK constraints and
 * by `./types.ts`.
 */

import type { AgentRuntime, AgentSkill, ConfirmationPolicy, ModelProvider, ToolRiskLevel } from './types'

// ---------------------------------------------------------------------------
// Architect conversation
// ---------------------------------------------------------------------------

export interface ArchitectMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Proposed tools (authoring-time shape; not yet persisted `ToolDefinition` rows)
// ---------------------------------------------------------------------------

export interface ProposedTool {
  name: string
  description: string
  provider: 'internal' | 'composio' | 'mcp' | 'http'
  riskLevel: ToolRiskLevel
  requiresConfirmation: boolean
  /**
   * Whether the tool mutates state: writes, sends, publishes or spends
   * anything. This is the STRUCTURAL truth the confirmation invariant reads
   * (see authoring-writes.ts) — it replaces guessing from the tool's name.
   *
   * OPTIONAL on purpose: tool rows authored before `tools.mutates` (migration
   * 0022) carry no value for it. `undefined` therefore means "unknown", and the
   * invariant falls back FAIL-CLOSED onto the legacy name/description heuristic
   * rather than assuming the tool is read-only.
   */
  mutates?: boolean
}

// ---------------------------------------------------------------------------
// Generated manifest (authoring-time shape; maps onto `AgentManifest` +
// `toolIds` resolution once tools are actually created)
// ---------------------------------------------------------------------------

export interface GeneratedManifest {
  systemPromptSummary: string
  /** Route/domain allowlist the agent may operate on. */
  allowedRoutes: string[]
  /** Hard-forbidden behaviours, enforced by the runtime gate. */
  forbiddenActions: string[]
  confirmationPolicy: ConfirmationPolicy
  /** Which actions always require human confirmation regardless of policy. */
  alwaysConfirmActions: string[]
  outputContract: {
    format: 'json' | 'markdown' | 'text' | 'ui-actions'
    schemaName: string | null
    /** Human-readable invariants, e.g. "never returns raw SQL". */
    invariants: string[]
  }
  proposedTools: ProposedTool[]
  /** Mission-level capabilities the architect derived from the copilot's job. */
  skills?: AgentSkill[]
  maxStepsPerRun: number
  maxCostPerRunUsd: number
}

// ---------------------------------------------------------------------------
// Create-copilot input (payload for the write API that materializes a draft
// into a real `copilots` + `copilot_versions` + `manifests` row set)
// ---------------------------------------------------------------------------

export interface CreateCopilotInput {
  name: string
  slug: string
  description: string
  runtime: AgentRuntime
  model: string
  modelProvider: ModelProvider
  owner: string
  tags: string[]
  projectId: string | null
  targetProjectIds: string[]
  manifest: GeneratedManifest
}
