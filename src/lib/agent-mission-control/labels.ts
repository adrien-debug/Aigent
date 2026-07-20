/**
 * Agent Mission Control — static display labels.
 *
 * UI constants (enum → human label), NOT data. Live in their own module so the
 * running app never imports the mock dataset. Enum values come from `types.ts`.
 */
import type {
  AgentRunStatus,
  AgentRuntime,
  CopilotStatus,
  ModelProvider,
  Project,
  ReplayCandidate,
  ToolCall,
  VersionStage,
} from './types'

export const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  langgraph: 'LangGraph',
  'openai-assistants': 'OpenAI Assistants',
  gemini: 'Gemini',
  custom: 'Custom runtime',
}

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  google: 'Google',
  local: 'Local',
}

export const COPILOT_STATUS_LABELS: Record<CopilotStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
}

export const AGENT_RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
  running: 'Running',
}

export const VERSION_STAGE_LABELS: Record<VersionStage, string> = {
  production: 'Production',
  beta: 'Beta',
  draft: 'Draft',
  archived: 'Archived',
}

export const TOOL_CALL_STATUS_LABELS: Record<ToolCall['status'], string> = {
  ok: 'OK',
  error: 'Error',
  blocked: 'Blocked',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
}

export const REPLAY_OUTCOME_LABELS: Record<ReplayCandidate['outcome'], string> = {
  matched: 'Matched',
  improved: 'Improved',
  diverged: 'Diverged',
  unsafe: 'Unsafe',
  pending: 'Pending',
}

export const PROJECT_PLATFORM_LABELS: Record<Project['platform'], string> = {
  web: 'Web',
  desktop: 'Desktop',
  mobile: 'Mobile',
  api: 'API',
}
