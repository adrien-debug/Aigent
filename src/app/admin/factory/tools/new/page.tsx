import type { Metadata } from 'next'

import { ToolNewView } from '@/components/views/factory/tool-new-view'
import { getTool } from '@/lib/agent-mission-control/registry'
import { TOOL_BUILD_STATE_STEPS } from '@/lib/agent-mission-control/tool-builder/mission'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Build a tool — Aigent',
}

export default function NewToolBuilderPage() {
  return <ToolNewView pipelineSteps={TOOL_BUILD_STATE_STEPS} countWords={getTool('count_words')} />
}
