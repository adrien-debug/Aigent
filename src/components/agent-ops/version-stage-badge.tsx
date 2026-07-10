import { Badge } from '@/components/catalyst/badge'
import type { VersionStage } from '@/lib/agent-mission-control/types'

/** Canonical display labels for version stages — never render the raw enum. */
export const versionStageLabels: Record<VersionStage, string> = {
  production: 'Production',
  beta: 'Beta',
  draft: 'Draft',
  archived: 'Archived',
}

const versionStageStyles: Record<VersionStage, { color: 'accent' | 'zinc'; className?: string }> = {
  production: { color: 'accent' },
  beta: { color: 'zinc' },
  draft: { color: 'zinc', className: 'opacity-75' },
  archived: { color: 'zinc', className: 'opacity-50' },
}

/** The ONE version-stage badge — same look on every screen (doctrine: no per-page drift). */
export function VersionStageBadge({ stage }: { stage: VersionStage }) {
  const style = versionStageStyles[stage]
  return (
    <Badge color={style.color} className={style.className}>
      {versionStageLabels[stage]}
    </Badge>
  )
}
