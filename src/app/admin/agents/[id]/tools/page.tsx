import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'

import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ToolPermissionMatrix } from '@/components/agent-ops/tool-permission-matrix'
import { formatPercent } from '@/lib/agent-mission-control/format'
import { getCopilot, getToolsForCopilot } from '@/lib/agent-mission-control/data'

export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const tools = await getToolsForCopilot(id)

  if (tools.length === 0) {
    return (
      <AgentSectionCard
        title="Tool permissions"
        description="Which tools this copilot may call, and under which confirmation rules."
      >
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <WrenchScrewdriverIcon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
          <p className="text-sm font-medium text-zinc-950 dark:text-white">No tools registered</p>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            This copilot has no tools attached to its manifest yet. Tools declared in the manifest will appear here
            with their risk level and confirmation rules.
          </p>
        </div>
      </AgentSectionCard>
    )
  }

  const enabledCount = tools.filter((tool) => tool.enabled).length
  const highRiskCount = tools.filter(
    (tool) => tool.riskLevel === 'high' || tool.riskLevel === 'critical'
  ).length
  const avgErrorRate = tools.reduce((sum, tool) => sum + tool.errorRateLast7d, 0) / tools.length

  return (
    <div className="space-y-8">
      <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
        <AgentMetricCard
          label="Enabled tools"
          value={`${enabledCount}`}
          hint={`of ${tools.length} registered`}
        />
        <AgentMetricCard
          label="High & critical risk"
          value={`${highRiskCount}`}
          hint="Always require confirmation"
        />
        <AgentMetricCard
          label="Error rate (7d avg)"
          value={formatPercent(avgErrorRate)}
          hint="Mean across all registered tools"
        />
      </div>

      <AgentSectionCard
        title="Tool permissions"
        description="Which tools this copilot may call, and under which confirmation rules."
        contentClassName="p-0"
      >
        <ToolPermissionMatrix tools={tools} />
      </AgentSectionCard>

      <p className="flex items-center gap-2 px-1 text-xs text-zinc-500">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span>
          <span className="font-medium text-amber-600 dark:text-amber-400">Safety rule</span>
          {' — '}high &amp; critical risk tools always require human confirmation. This lock cannot be removed per
          tool.
        </span>
      </p>
    </div>
  )
}
