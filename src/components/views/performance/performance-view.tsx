import { BoltIcon } from '@heroicons/react/24/outline'

import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { AgentLeaderboard } from '@/components/agent-ops/performance/agent-leaderboard'
import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { RecentRunsTable } from '@/components/agent-ops/performance/recent-runs-table'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Text } from '@/components/ui/text'
import type { PerformancePageData } from '@/lib/agent-mission-control/performance-page-data'

export function PerformanceView({
  nowIso,
  projectNameById,
  copilotById,
  ranked,
  recentRuns,
  windowTruncated,
  windowMaxRows,
}: PerformancePageData) {
  return (
    <PageLayout>
      <PageHeader
        eyebrow="Performance"
        title="Fleet Performance"
        actions={<LiveRefresh initialRefreshedAt={nowIso} />}
        className="pb-0"
      />

      <AgentLeaderboard copilots={ranked} projectNameById={projectNameById} />

      {recentRuns.length > 0 ? (
        <>
          <RecentRunsTable
            runs={recentRuns}
            copilotById={copilotById}
            projectNameById={projectNameById}
            nowIso={nowIso}
          />
          {windowTruncated ? (
            // `text-xs!`, not `text-xs`: `Text` composes `clsx(className, defaults)`,
            // so a bare `text-xs` is beaten by the primitive's own `sm:text-sm/6`
            // in the compiled sheet and this caption rendered at 14px, the size of
            // body copy. The colour is dropped — the primitive already defaults to
            // exactly the zinc it was restating.
            <Text className="text-xs!">
              24h window capped at {windowMaxRows} runs — the fleet produced more than this in the last
              24h; the trace feed below reflects the newest {windowMaxRows}, not every run.
            </Text>
          ) : null}
        </>
      ) : (
        // Same surface as the table it stands in for, so the page keeps its
        // structure with or without runs.
        <EmptyStatePanel
          icon={BoltIcon}
          title="No runs recorded"
          description="Runs appear here as soon as agents serve traffic in any project. This reflects recorded runs only — it is not evidence that agents are idle."
        />
      )}
    </PageLayout>
  )
}
