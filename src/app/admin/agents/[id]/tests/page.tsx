import { notFound } from 'next/navigation'

import { BenchmarksSection } from '@/components/agent-ops/sections/benchmarks-section'
import { ReplaySection } from '@/components/agent-ops/sections/replay-section'
import { ShadowSection } from '@/components/agent-ops/sections/shadow-section'
import { Subsection } from '@/components/agent-ops/sections/subsection'
import { TestsSection } from '@/components/agent-ops/sections/tests-section'
import { getCopilot } from '@/lib/agent-mission-control/data'

/** Quality tab — tests, benchmarks, shadow traffic and replay, as one page. */
export default async function QualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  return (
    <div className="space-y-8">
      <TestsSection copilotId={id} />
      <Subsection id="benchmarks" label="Benchmarks" />
      <BenchmarksSection copilotId={id} />
      <Subsection id="shadow" label="Shadow" />
      <ShadowSection copilotId={id} />
      <Subsection id="replay" label="Replay" />
      <ReplaySection copilotId={id} />
    </div>
  )
}
