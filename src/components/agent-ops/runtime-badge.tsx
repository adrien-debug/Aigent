import { Badge } from '@/components/catalyst/badge'
import { AGENT_RUNTIME_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { AgentRuntime } from '@/lib/agent-mission-control/types'

/**
 * Runtime is neutral metadata (which engine), not a status — so it wears the
 * one neutral (zinc), keeping the accent hue reserved for states. Labels come
 * from AGENT_RUNTIME_LABELS (single source) and are always visible.
 */
/** Agent runtime badge — human-readable label, neutral zinc. */
export function RuntimeBadge({ runtime }: { runtime: AgentRuntime }) {
  return <Badge color="zinc">{AGENT_RUNTIME_LABELS[runtime]}</Badge>
}
