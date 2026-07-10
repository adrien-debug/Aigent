import { notFound } from 'next/navigation'

import { PublishSection } from '@/components/agent-ops/sections/publish-section'
import { Subsection } from '@/components/agent-ops/sections/subsection'
import { VersionsSection } from '@/components/agent-ops/sections/versions-section'
import { getCopilot } from '@/lib/agent-mission-control/data'

/** Release tab — version history + the promotion gate, as one page. */
export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  return (
    <div className="space-y-8">
      <VersionsSection copilotId={id} />
      <Subsection id="publish" label="Publish" />
      <PublishSection copilotId={id} />
    </div>
  )
}
