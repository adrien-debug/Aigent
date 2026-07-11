/**
 * Agent Mission Control — authoring domain types.
 *
 * Shared contract for the agent-authoring surface (the "architect" assistant
 * that converses with a user, proposes a manifest, and — once ready — creates
 * a real `Copilot` row). Backed live by the `agent_drafts` table (PostgREST on
 * gpu1). Pure types, no logic — reuse the enum unions already established by
 * the DB CHECK constraints and by `./types.ts`.
 */

import type { AgentRuntime, ConfirmationPolicy, ModelProvider, ToolRiskLevel } from './types'

// ---------------------------------------------------------------------------
// Shared scalars (re-exported for convenience of callers of this module)
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp, e.g. "2026-07-09T14:32:00Z". */
export type IsoTimestamp = string

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
