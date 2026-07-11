import type { VersionStage } from '@/lib/agent-mission-control/types'

/** Canonical display labels for version stages — never render the raw enum. */
export const versionStageLabels: Record<VersionStage, string> = {
  production: 'Production',
  beta: 'Beta',
  draft: 'Draft',
  archived: 'Archived',
}
