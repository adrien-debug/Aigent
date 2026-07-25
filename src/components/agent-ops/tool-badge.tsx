import { Badge } from '@/components/ui/badge'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

/** Risk dot on the monochrome accent ramp: faint → solid (low → critical). */
const riskDotConfig: Record<ToolRiskLevel, { label: string; dotClassName: string }> = {
  low: { label: 'low', dotClassName: 'bg-accent-300 dark:bg-accent-300' },
  medium: { label: 'medium', dotClassName: 'bg-accent-400 dark:bg-accent-400' },
  high: { label: 'high', dotClassName: 'bg-accent-500 dark:bg-accent-500' },
  critical: { label: 'critical', dotClassName: 'bg-accent-600 dark:bg-accent-600' },
}

/**
 * Tool name badge — zinc, monospaced name. When a risk level is provided,
 * a tiny dot marks it visually with an sr-only text equivalent.
 */
export function ToolBadge({ name, risk }: { name: string; risk?: ToolRiskLevel }) {
  const riskDot = risk ? riskDotConfig[risk] : null

  return (
    <Badge color="zinc" className="font-mono">
      {name}
      {riskDot && (
        <>
          <span aria-hidden="true" className={`size-1 shrink-0 rounded-full ${riskDot.dotClassName}`} />
          <span className="sr-only">({riskDot.label} risk)</span>
        </>
      )}
    </Badge>
  )
}
