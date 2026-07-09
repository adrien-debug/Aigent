import { Badge } from '@/components/catalyst/badge'
import { AGENT_RUNTIME_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { AgentRuntime } from '@/lib/agent-mission-control/types'

/**
 * Doctrine: the blue / violet / indigo family is reserved for runtime & tracing.
 * Labels come from AGENT_RUNTIME_LABELS (single source) and are always visible,
 * so shared hues across runtimes stay unambiguous.
 */
const runtimeColors: Record<AgentRuntime, 'blue' | 'violet' | 'indigo'> = {
  langgraph: 'blue',
  'openai-assistants': 'violet',
  'anthropic-sdk': 'indigo',
  gemini: 'indigo',
  custom: 'blue',
}

/** Agent runtime badge — human-readable label, runtime color family only. */
export function RuntimeBadge({ runtime }: { runtime: AgentRuntime }) {
  return <Badge color={runtimeColors[runtime]}>{AGENT_RUNTIME_LABELS[runtime]}</Badge>
}
