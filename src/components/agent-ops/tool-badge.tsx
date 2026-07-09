import { Badge } from '@/components/catalyst/badge'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

/** Risk dot hues follow the doctrine scale: lime → amber → orange → rose. */
const riskDotConfig: Record<ToolRiskLevel, { label: string; dotClassName: string }> = {
  low: { label: 'low', dotClassName: 'bg-lime-500 dark:bg-lime-400' },
  medium: { label: 'medium', dotClassName: 'bg-amber-500 dark:bg-amber-400' },
  high: { label: 'high', dotClassName: 'bg-orange-500 dark:bg-orange-400' },
  critical: { label: 'critical', dotClassName: 'bg-rose-500 dark:bg-rose-400' },
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
