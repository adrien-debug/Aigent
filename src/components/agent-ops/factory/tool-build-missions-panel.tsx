import { EmptyState } from '@/components/agent-ops/empty-state'
import { surfaceSunken } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import type { ToolBuildMissionRow } from '@/lib/agent-mission-control/tool-build-missions-store'

const STATE_BADGE: Record<ToolBuildMissionRow['state'], 'accent' | 'zinc'> = {
  DRAFT: 'zinc',
  IMPLEMENTING: 'zinc',
  TESTING: 'zinc',
  CERTIFIED: 'accent',
  REJECTED: 'zinc',
  DEPRECATED: 'zinc',
}

export function ToolBuildMissionsPanel({ missions }: { missions: ToolBuildMissionRow[] }) {
  if (missions.length === 0) {
    return (
      <EmptyState
        title="No tool build missions"
        description="Start a local-deterministic tool build from the Tool Builder."
      />
    )
  }

  return (
    <div className="max-h-96 overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-2">
        {missions.map((mission) => (
          <li key={mission.id} className={`flex flex-col gap-2 p-4 ${surfaceSunken}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Strong className="truncate text-sm">{mission.spec.label}</Strong>
                  <Badge color={STATE_BADGE[mission.state]}>{mission.state}</Badge>
                </div>
                <Text size="xs" className="mt-0.5 font-mono">
                  {mission.toolId} · v{mission.spec.version}
                </Text>
              </div>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{mission.spec.kind}</span>
            </div>
            {mission.rejectionReason ? (
              <Text size="xs">{mission.rejectionReason}</Text>
            ) : mission.evidence ? (
              <Text size="xs">
                tests: {mission.evidence.passed} passed, {mission.evidence.failed} failed
                {mission.evidence.detail ? ` — ${mission.evidence.detail}` : ''}
              </Text>
            ) : (
              <Text size="xs">Build in progress.</Text>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
