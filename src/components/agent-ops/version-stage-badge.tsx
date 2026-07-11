import type { VersionStage } from '@/lib/agent-mission-control/types'

/** Canonical display labels for version stages — never render the raw enum. */
export const versionStageLabels: Record<VersionStage, string> = {
  production: 'Production',
  beta: 'Beta',
  draft: 'Draft',
  archived: 'Archived',
}

/** The ONE version-stage indicator — plain muted text, same look on every screen (doctrine: no per-page drift). */
export function VersionStageBadge({ stage }: { stage: VersionStage }) {
  return (
    <span className="text-zinc-500 dark:text-zinc-400">
      {versionStageLabels[stage]}
    </span>
  )
}
