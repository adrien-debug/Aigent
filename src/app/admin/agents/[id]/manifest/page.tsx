import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ManifestJsonPreview } from '@/components/agent-ops/manifest-json-preview'
import { ManifestSummaryCard } from '@/components/agent-ops/manifest-summary-card'
import { ManifestVersionSelect } from '@/components/agent-ops/manifest-version-select'
import { ToolPermissionMatrix } from '@/components/agent-ops/tool-permission-matrix'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { PolicyStateIndicator } from '@/components/agent-ops/widgets/policy-state-indicator'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { Button } from '@/components/catalyst/button'
import { formatUsd } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getManifestForCopilot,
  getToolsForCopilot,
  getVersionsForCopilot,
} from '@/lib/agent-mission-control/data'
import type { AgentManifest, ToolRiskLevel } from '@/lib/agent-mission-control/types'

const RISK_ORDER: ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
const RISK_TONE = {
  low: 'accent-400',
  medium: 'accent-500',
  high: 'accent-600',
  critical: 'accent-700',
} as const

/** The 5 manifest sections scored by the completeness ring (mirrors deriveSteps). */
function completeSectionCount(manifest: AgentManifest): number {
  const checks = [
    manifest.allowedRoutes.length > 0,
    manifest.forbiddenActions.length > 0,
    manifest.confirmationPolicy !== 'never' || manifest.alwaysConfirmActions.length > 0,
    manifest.memorySources.length > 0,
    Boolean(manifest.outputContract.schemaName) || manifest.outputContract.invariants.length > 0,
  ]
  return checks.filter(Boolean).length
}

/** Config tab — the agent's definition: its compiled manifest and its tool permissions. */
export default async function ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const [manifest, tools] = await Promise.all([getManifestForCopilot(copilot.id), getToolsForCopilot(id)])

  // Tool permissions section — a real table (legitimate box). A risk-mix
  // SplitBar heads the card; the safety rule folds into its description.
  const riskCounts = RISK_ORDER.map((risk) => tools.filter((t) => t.riskLevel === risk).length)
  const toolsSection = (
    <section id="tools" className="scroll-mt-6">
      <AgentSectionCard
        title="Tool permissions"
        description="Which tools this copilot may call, and under which confirmation rules. High & critical risk tools always require human confirmation — this lock cannot be removed per tool."
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
          <>
            <div className="border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
              <SplitBar
                segments={RISK_ORDER.map((risk, i) => ({
                  key: risk,
                  label: risk,
                  value: riskCounts[i],
                  tone: RISK_TONE[risk],
                }))}
                caption={`${tools.length} tool${tools.length === 1 ? '' : 's'} by risk level`}
              />
            </div>
            <ToolPermissionMatrix tools={tools} />
          </>
        )}
      </AgentSectionCard>
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

  const readWriteCount = manifest.memorySources.filter((s) => !s.readOnly).length
  const readOnlyCount = manifest.memorySources.length - readWriteCount
  const complete = completeSectionCount(manifest)

  return (
    <div className="space-y-8">
      <AgentKpiBand
        stats={[
          {
            name: 'Scope',
            value: String(manifest.allowedRoutes.length),
            viz: (
              <SplitBar
                segments={[
                  { key: 'allowed', label: 'Allowed', value: manifest.allowedRoutes.length, tone: 'accent-400' },
                  { key: 'forbidden', label: 'Forbidden', value: manifest.forbiddenActions.length, tone: 'accent-700' },
                ]}
              />
            ),
          },
          {
            name: 'Tools & memory',
            value: String(manifest.toolIds.length),
            viz: (
              <SplitBar
                segments={[
                  { key: 'ro', label: 'Read-only', value: readOnlyCount, tone: 'zinc' },
                  { key: 'rw', label: 'Read & write', value: readWriteCount, tone: 'accent-600' },
                ]}
              />
            ),
          },
          {
            name: 'Confirmation',
            value:
              manifest.confirmationPolicy === 'risky-only'
                ? 'Risky only'
                : manifest.confirmationPolicy === 'always'
                  ? 'Always'
                  : 'Never',
            viz: (
              <PolicyStateIndicator
                policy={manifest.confirmationPolicy}
                alwaysConfirmCount={manifest.alwaysConfirmActions.length}
              />
            ),
          },
          {
            name: 'Per-run budget',
            value: formatUsd(manifest.maxCostPerRunUsd),
            viz: (
              <div className="space-y-2">
                <LinearMeter
                  value={manifest.maxCostPerRunUsd}
                  max={Math.max(manifest.maxCostPerRunUsd, 1)}
                  valueText={formatUsd(manifest.maxCostPerRunUsd)}
                  label="Cost ceiling"
                  ariaLabel="Per-run cost ceiling"
                />
                <LinearMeter
                  value={manifest.maxStepsPerRun}
                  max={Math.max(manifest.maxStepsPerRun, 1)}
                  tone="zinc"
                  valueText={`${manifest.maxStepsPerRun} steps`}
                  label="Steps ceiling"
                  ariaLabel="Per-run steps ceiling"
                />
              </div>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
        <div className="lg:col-span-3">
          <ManifestSummaryCard
            manifest={manifest}
            actions={
              availableVersionId ? (
                <ManifestVersionSelect versions={versionOptions} initialVersionId={availableVersionId} />
              ) : undefined
            }
          />
        </div>

        <div className="lg:col-span-2 lg:sticky lg:top-6 lg:self-start">
          {/* Completeness ring + the compiled source, expanded to fill the
              column beside the (tall) manifest panel — no empty gutter. */}
          <div className="flex items-center gap-4 pb-5">
            <RadialMeter
              value={complete}
              max={5}
              segments={5}
              size={96}
              strokeWidth={8}
              centerText={`${complete}/5`}
              ariaLabel={`Manifest completeness: ${complete} of 5 sections`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950 dark:text-white">Completeness</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {complete} of 5 manifest sections defined.
                {complete < 5 ? ' Fill the rest before promoting.' : ' Ready for the gate.'}
              </p>
            </div>
          </div>

          <div className="border-t border-zinc-950/5 pt-5 dark:border-white/5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Manifest source</p>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">read-only</span>
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-label="Manifest source, scrollable"
              className="max-h-[32rem] overflow-y-auto rounded-md focus:outline-2 focus:outline-offset-2 focus:outline-accent-500"
            >
              <ManifestJsonPreview manifest={manifest} />
            </div>
          </div>
        </div>
      </div>

      {toolsSection}
    </div>
  )
}
