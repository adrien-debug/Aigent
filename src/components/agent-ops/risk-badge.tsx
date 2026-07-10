import { Badge } from '@/components/catalyst/badge'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

/** Monochrome risk ladder: accent soft → strong → solid (low → critical). */
const riskConfig: Record<ToolRiskLevel, { label: string; color: 'accent' | 'accentStrong' | 'accentSolid' }> = {
  low: { label: 'Low', color: 'accent' },
  medium: { label: 'Medium', color: 'accent' },
  high: { label: 'High', color: 'accentStrong' },
  critical: { label: 'Critical', color: 'accentSolid' },
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
