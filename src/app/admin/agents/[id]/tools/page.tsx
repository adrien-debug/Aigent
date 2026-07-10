import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ToolPermissionMatrix } from '@/components/agent-ops/tool-permission-matrix'
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

  return (
    <div className="space-y-8">
      <AgentSectionCard
        title="Tool permissions"
        description="Which tools this copilot may call, and under which confirmation rules."
        contentClassName="p-0"
      >
        <ToolPermissionMatrix tools={tools} />
      </AgentSectionCard>

      <p className="flex items-center gap-2 px-1 text-xs text-zinc-500">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent-500 dark:bg-accent-400" />
        <span>
          <span className="font-medium text-accent-600 dark:text-accent-400">Safety rule</span>
          {' — '}high &amp; critical risk tools always require human confirmation. This lock cannot be removed per
          tool.
        </span>
      </p>
    </div>
  )
}
