import { Badge } from '@/components/catalyst/badge'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

/** Doctrine risk scale: lime → amber → orange → rose (low → critical). */
const riskConfig: Record<ToolRiskLevel, { label: string; color: 'lime' | 'amber' | 'orange' | 'rose' }> = {
  low: { label: 'Low', color: 'lime' },
  medium: { label: 'Medium', color: 'amber' },
  high: { label: 'High', color: 'orange' },
  critical: { label: 'Critical', color: 'rose' },
}

/** Tool risk level badge — always-visible text label, never color alone. */
export function RiskBadge({ risk }: { risk: ToolRiskLevel }) {
  const config = riskConfig[risk]

  return (
    <Badge color={config.color}>
      <span className="sr-only">Risk: </span>
      {config.label}
    </Badge>
  )
}
