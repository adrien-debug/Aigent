import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'

import { Badge } from '@/components/catalyst/badge'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

/**
 * Monochrome risk ladder — escalation reads on TWO axes so a glance is enough:
 * fill intensity (soft → strong → solid) AND a warning icon at the top of the
 * scale. Single accent hue; the label always states the level.
 */
const riskConfig: Record<
  ToolRiskLevel,
  { label: string; color: 'accent' | 'accentStrong' | 'accentSolid'; icon?: boolean }
> = {
  low: { label: 'Low', color: 'accent' },
  medium: { label: 'Medium', color: 'accentStrong' },
  high: { label: 'High', color: 'accentSolid' },
  critical: { label: 'Critical', color: 'accentSolid', icon: true },
}

/** Tool risk level badge — always-visible text label, never color alone. */
export function RiskBadge({ risk }: { risk: ToolRiskLevel }) {
  const config = riskConfig[risk]

  return (
    <Badge color={config.color}>
      {config.icon ? <ExclamationTriangleIcon aria-hidden="true" className="-ml-0.5 size-3.5 shrink-0" /> : null}
      <span className="sr-only">Risk: </span>
      {config.label}
    </Badge>
  )
}
