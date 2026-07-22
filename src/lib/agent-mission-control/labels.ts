/**
 * Agent Mission Control — static display labels.
 *
 * UI constants (enum → human label), NOT data. Live in their own module so the
 * running app never imports the mock dataset. Enum values come from `types.ts`.
 *
 * THE SINGLE PLACE A STATUS LABEL MAY EXIST (AIGENT-UI-TRUTH-026). One agent
 * used to read `ACTIVE` on the catalogue, `ACTIVE` on its detail header and
 * `IDLE` on the team canvas at the same instant, because three components each
 * spelled their own vocabulary. A component must import from here and must
 * never write `'Active'` / `'DRAFT'` / `'Idle'` itself — `check-status-truth.mjs`
 * enforces it.
 *
 * An agent carries THREE independent statuses; they are three tables here and
 * must stay three labels on screen, never one ambiguous badge:
 *   - LIFECYCLE  — `copilots.status`, what an operator decided (draft, paused…)
 *   - RUNTIME    — `AvailableAgent.status`, what the runtime can prove today
 *   - EXECUTABLE — whether the run gate would accept a launch right now
 *
 * `import type` only from `available-agents.ts`: that module is `server-only`
 * and a type import is erased at compile time, so this file stays importable
 * from a client component.
 */
import type { AvailableAgentStatus } from './available-agents'
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

/**
 * Runtime label by raw `copilots.runtime` value.
 *
 * The column holds ids the `AgentRuntime` union never listed
 * (`openai-responses`, `http` — see `EXECUTABLE_RUNTIMES` in
 * `available-agents.ts`), so a `Record<AgentRuntime, string>` lookup silently
 * returned `undefined` for them. Keyed by `string` and read with a fallback to
 * the raw id: an unknown runtime shows its id, which is a fact, instead of a
 * blank cell.
 */
export const RUNTIME_ID_LABELS: Record<string, string> = {
  ...AGENT_RUNTIME_LABELS,
  'openai-responses': 'OpenAI Responses',
  http: 'HTTP',
}

/** Runtime label, falling back to the raw id — never a blank, never a guess. */
export function runtimeLabel(runtime: string | null): string | null {
  if (runtime === null) return null
  return RUNTIME_ID_LABELS[runtime] ?? runtime
}

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  google: 'Google',
  local: 'Local',
}

/**
 * LIFECYCLE — the stored `copilots.status` column: what an operator decided
 * about this agent. It says nothing about whether the agent can run today.
 */
export const COPILOT_STATUS_LABELS: Record<CopilotStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
}

/** Lifecycle label for a raw column value, falling back to the raw string. */
export function copilotStatusLabel(status: string): string {
  return COPILOT_STATUS_LABELS[status as CopilotStatus] ?? status
}

/**
 * RUNTIME — `AvailableAgent.status`, derived from persisted runtime truth.
 *
 * Deliberately NOT the same words as the lifecycle table where the two differ
 * in meaning: an agent whose lifecycle is `draft` is `Inactive` at runtime, and
 * showing "Draft" in a runtime slot is what made a single agent read as two
 * different states on two screens.
 */
export const AVAILABLE_AGENT_STATUS_LABELS: Record<AvailableAgentStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
}

/**
 * Alias fixed by the AIGENT-UI-TRUTH-026 wave contract so every agent imports
 * the same table under the name it expects. Same object, not a copy.
 */
export const availableAgentStatusLabels = AVAILABLE_AGENT_STATUS_LABELS

/**
 * The three status DIMENSIONS. A badge that shows a status without naming its
 * dimension is the ambiguity this module exists to remove: use these as the
 * column header or the inline prefix.
 */
export const AGENT_STATUS_DIMENSION_LABELS = {
  lifecycle: 'Lifecycle',
  runtime: 'Runtime',
  executable: 'Executable',
} as const

/** EXECUTABLE — would the run gate accept a launch right now? */
export const AGENT_EXECUTABLE_LABELS: Record<'yes' | 'no', string> = {
  yes: 'Yes',
  no: 'No',
}

/** Executable label from the boolean the catalogue derives. */
export function agentExecutableLabel(executable: boolean): string {
  return executable ? AGENT_EXECUTABLE_LABELS.yes : AGENT_EXECUTABLE_LABELS.no
}

/**
 * The one label for "no persisted row proved this". Distinct from a measured
 * zero and distinct from a status — see `NotMeasuredDash` for the glyph form.
 */
export const NOT_MEASURED_LABEL = 'Not measured'

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
