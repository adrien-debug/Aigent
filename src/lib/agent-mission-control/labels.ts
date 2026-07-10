/**
 * Agent Mission Control — static display labels.
 *
 * UI constants (enum → human label), NOT data. Live in their own module so the
 * running app never imports the mock dataset. Enum values come from `types.ts`.
 */
import type { AgentRuntime, ModelProvider } from './types'

export const AGENT_RUNTIME_LABELS: Record<AgentRuntime, string> = {
  langgraph: 'LangGraph',
  'openai-assistants': 'OpenAI Assistants',
  'anthropic-sdk': 'Anthropic SDK',
  gemini: 'Gemini',
  custom: 'Custom runtime',
}

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  mistral: 'Mistral',
  local: 'Local',
}
