import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ManifestCompleteness } from '@/components/agent-ops/manifest-completeness'
import { ManifestJsonPreview } from '@/components/agent-ops/manifest-json-preview'
import { ManifestSummaryCard } from '@/components/agent-ops/manifest-summary-card'
import { ManifestVersionSelect } from '@/components/agent-ops/manifest-version-select'
import { ToolPermissionMatrix } from '@/components/agent-ops/tool-permission-matrix'
import { Button } from '@/components/catalyst/button'
import { formatUsd } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getManifestForCopilot,
  getToolsForCopilot,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'

/** Config tab — the agent's definition: its compiled manifest and its tool permissions. */
export default async function ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const [manifest, tools] = await Promise.all([getManifestForCopilot(copilot.id), getToolsForCopilot(id)])

  // Tool permissions section — rendered under the manifest (or on its own when
  // there is no manifest yet). Same content as the former standalone Tools tab.
  const toolsSection = (
    <section id="tools" className="scroll-mt-6 space-y-3">
      <AgentSectionCard
        title="Tool permissions"
        description="Which tools this copilot may call, and under which confirmation rules."
        contentClassName={tools.length === 0 ? undefined : 'p-0'}
      >
        {tools.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <WrenchScrewdriverIcon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-950 dark:text-white">No tools registered</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              This copilot has no tools attached to its manifest yet. Tools declared in the manifest will appear
              here with their risk level and confirmation rules.
            </p>
          </div>
        ) : (
          <ToolPermissionMatrix tools={tools} />
        )}
      </AgentSectionCard>
      {tools.length > 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-zinc-500">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent-500 dark:bg-accent-400" />
          <span>
            <span className="font-medium text-accent-600 dark:text-accent-400">Safety rule</span>
            {' — '}high &amp; critical risk tools always require human confirmation. This lock cannot be removed per
            tool.
          </span>
        </p>
      ) : null}
    </section>
  )

  if (!manifest) {
    return (
      <div className="space-y-8">
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
        {toolsSection}
      </div>
    )
  }

  const versions = await getVersionsForCopilot(copilot.id)
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
    <div className="space-y-8">
      <AgentKpiBand
        stats={[
          {
            name: 'Allowed routes',
            value: String(manifest.allowedRoutes.length),
            hint: `${manifest.forbiddenActions.length} forbidden action${manifest.forbiddenActions.length === 1 ? '' : 's'}`,
          },
          {
            name: 'Tools wired',
            value: String(manifest.toolIds.length),
            hint: `${manifest.memorySources.length} memory source${manifest.memorySources.length === 1 ? '' : 's'}`,
          },
          {
            name: 'Confirmation policy',
            value:
              manifest.confirmationPolicy === 'risky-only'
                ? 'Risky only'
                : manifest.confirmationPolicy === 'always'
                  ? 'Always'
                  : 'Never',
            hint: `${manifest.alwaysConfirmActions.length} always-confirm`,
          },
          {
            name: 'Per-run budget',
            value: formatUsd(manifest.maxCostPerRunUsd),
            hint: `${manifest.maxStepsPerRun} steps max`,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
        <div className="lg:col-span-3">
          <ManifestSummaryCard manifest={manifest} />
        </div>

        <div className="space-y-6 lg:sticky lg:top-6 lg:col-span-2 lg:self-start">
          {availableVersionId ? (
            <AgentSectionCard title="Version">
              <ManifestVersionSelect versions={versionOptions} initialVersionId={availableVersionId} />
            </AgentSectionCard>
          ) : null}

          <AgentSectionCard title="Completeness">
            <ManifestCompleteness manifest={manifest} />
          </AgentSectionCard>

          <AgentSectionCard
            title="Manifest source"
            description="Compiled manifest served to the runtime gate. Read-only."
          >
            <ManifestJsonPreview manifest={manifest} />
          </AgentSectionCard>
        </div>
      </div>

      {toolsSection}
    </div>
  )
}
