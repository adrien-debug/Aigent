/**
 * Project Builder — persistent conversation types (shared server + client).
 */
import type { BuilderRunState } from './agent-builder-run'
import type { AgentSkill } from './types'

export type ProjectBuilderConversationStatus = 'active' | 'draft_ready' | 'draft_created' | 'archived'

export interface AgentPreviewOption {
  id: string
  title: string
  summary: string
  tradeoffs: string[]
}

export interface AgentPreviewTool {
  name: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  requiresConfirmation: boolean
}

export interface AgentPreviewTest {
  name: string
  expectedBehavior?: string
}

/** Evolving spec rail — updated by the architect across conversation turns. */
export interface AgentPreview {
  name?: string
  role?: string
  description?: string
  options?: AgentPreviewOption[]
  selectedOptionId?: string | null
  tools?: string[]
  proposedTools?: AgentPreviewTool[]
  tests?: string[]
  testCases?: AgentPreviewTest[]
  benchmarks?: string[]
  riskPolicy?: string
  approvalPolicy?: string
  flow?: string[]
  readyForApproval?: boolean
  systemPromptSummary?: string
  confirmationPolicy?: string
  maxStepsPerRun?: number
  /** Mission-level capabilities, populated by the architect as the mission firms up. */
  skills?: AgentSkill[]
  /** Set after draft materialization — not part of architect tool schema. */
  createdCopilotId?: string | null
}

export interface ProjectBuilderMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ProjectBuilderConversation {
  id: string
  projectId: string
  status: ProjectBuilderConversationStatus
  langgraphThreadId: string | null
  latestPreview: AgentPreview | null
  createdAt: string
  updatedAt: string
}

export interface ProjectBuilderConversationBundle {
  conversation: ProjectBuilderConversation
  messages: ProjectBuilderMessage[]
  repoSummary: string | null
  createdCopilotId: string | null
  /**
   * Reconstructed LangGraph run state when `conversation.langgraphThreadId`
   * points at a still-live thread awaiting human approval — lets a page reload
   * show "Confirm draft" instead of re-offering "Approve — create draft" (which
   * would 502 on a run that is already in flight). `null` when there is no
   * thread, the thread is dead (server restart wiped it), or its liveness
   * couldn't be determined (server unreachable) — callers should render as if
   * no run is in progress in all three cases.
   */
  runState?: BuilderRunState | null
}
