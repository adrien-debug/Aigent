import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ManifestJsonPreview } from '@/components/agent-ops/manifest-json-preview'
import { ManifestSummaryCard } from '@/components/agent-ops/manifest-summary-card'
import { ManifestVersionSelect } from '@/components/agent-ops/manifest-version-select'
import { Button } from '@/components/catalyst/button'
import { getCopilot, getManifestForCopilot, getVersionsForCopilot } from '@/lib/agent-mission-control/mock-data'

export default async function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const manifest = getManifestForCopilot(copilot.id)

  if (!manifest) {
    return (
      <AgentBentoCard
        title="No manifest yet"
        description={`${copilot.name} doesn't have a compiled manifest. Define the system prompt, the allowed routes and the guardrails to produce the first manifest version — until then, the runtime gate blocks every run.`}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Create manifest</Button>
            <Button plain disabled>
              Read the manifest guide
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Manifest authoring and the guide ship in V2 — these actions are disabled until then.
          </p>
        </div>
      </AgentBentoCard>
    )
  }

  const versions = getVersionsForCopilot(copilot.id)
  // V1 serves a single compiled manifest: only the version matching
  // manifest.version is selectable — the others are listed but disabled.
  const availableVersionId = versions.find((version) => version.label === manifest.version)?.id
  const versionOptions = versions.map((version) => ({
    id: version.id,
    label: version.label,
    stage: version.stage,
    disabled: version.id !== availableVersionId,
  }))

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
      <div className="lg:col-span-3">
        <ManifestSummaryCard manifest={manifest} />
      </div>

      <div className="lg:sticky lg:top-6 lg:col-span-2 lg:self-start">
        <AgentSectionCard
          title="Manifest source"
          description="Compiled manifest served to the runtime gate. Read-only."
        >
          <div className="space-y-4">
            {availableVersionId ? (
              <ManifestVersionSelect versions={versionOptions} initialVersionId={availableVersionId} />
            ) : null}
            <ManifestJsonPreview manifest={manifest} />
          </div>
        </AgentSectionCard>
      </div>
    </div>
  )
}
