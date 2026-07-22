import { notFound } from 'next/navigation'
import { TextValue, TimestampValue } from '@/components/agent-ops/agent-detail/agent-value'
import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Text } from '@/components/catalyst/text'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Configuration — runtime, version, permissions, bindings (AIGENT-AGENT-PAGES-021).
 *
 * Absorbs the legacy Manifest (config half), Versions and Release pages. The raw
 * manifest JSON lives in Advanced, collapsed by default: it is debugging
 * material, not the first thing an operator should meet.
 */

function Rows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-1 gap-1 border-b border-white/5 py-2.5 last:border-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4"
        >
          <dt className={eyebrowClass}>{row.label}</dt>
          <dd className="font-mono text-xs tabular-nums break-words text-zinc-300">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default async function AgentConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  const { copilot, agent, manifest, currentVersion, versions, metrics } = detail

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Runtime" description="What executes this agent, and the ceilings it runs under.">
          <Rows
            rows={[
              { label: 'Provider', value: <TextValue value={agent?.provider ?? copilot.modelProvider} /> },
              { label: 'Configured model', value: <TextValue value={agent?.configuredModel ?? copilot.model} /> },
              {
                label: 'Executed model',
                value: agent?.executedModel ? (
                  agent.executedModel
                ) : (
                  <span className="text-zinc-500">Not proven by a run</span>
                ),
              },
              { label: 'Runtime', value: <TextValue value={copilot.runtime} /> },
              {
                label: 'Max steps per run',
                value: manifest ? String(manifest.maxStepsPerRun) : <TextValue value={null} />,
              },
              {
                label: 'Cost ceiling',
                value: manifest ? `$${manifest.maxCostPerRunUsd}` : <TextValue value={null} />,
              },
            ]}
          />
        </Section>

        <Section title="Version" description={`${versions.length} version${versions.length === 1 ? '' : 's'} recorded.`}>
          <Rows
            rows={[
              { label: 'Current version', value: <TextValue value={currentVersion?.label ?? null} /> },
              { label: 'Stage', value: <TextValue value={currentVersion?.stage ?? null} /> },
              { label: 'Manifest version', value: <TextValue value={manifest?.version ?? null} /> },
              { label: 'Created', value: <TimestampValue value={currentVersion?.createdAt ?? null} /> },
              {
                label: 'Serving',
                value: copilot.productionVersionId
                  ? 'Production version'
                  : 'Latest version (no production version set)',
              },
            ]}
          />
        </Section>

        <Section title="Permissions" description="What the agent may do, and what it may never do.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge color={agent?.readOnly ? 'accent' : 'zinc'}>
                {agent?.readOnly ? 'Read-only' : 'Write-capable'}
              </Badge>
              <Badge color={agent?.requiresHumanApproval ? 'accentStrong' : 'zinc'}>
                {agent?.requiresHumanApproval ? 'Human approval required' : 'No approval step'}
              </Badge>
              <Badge color="zinc">Confirmation: {manifest?.confirmationPolicy ?? 'unknown'}</Badge>
            </div>

            {manifest && manifest.forbiddenActions.length > 0 ? (
              <div>
                <p className={eyebrowClass}>Forbidden actions</p>
                <ul className="mt-2 flex flex-col">
                  {manifest.forbiddenActions.map((action) => (
                    <li key={action} className="border-b border-white/5 py-2 text-xs leading-5 text-zinc-300 last:border-0">
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {manifest && manifest.alwaysConfirmActions.length > 0 ? (
              <div>
                <p className={eyebrowClass}>Always confirm</p>
                <ul className="mt-2 flex flex-col">
                  {manifest.alwaysConfirmActions.map((action) => (
                    <li key={action} className="border-b border-white/5 py-2 text-xs leading-5 text-zinc-300 last:border-0">
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Project binding" description="Where this agent lives and which records define it.">
          <Rows
            rows={[
              { label: 'Project', value: <TextValue value={copilot.projectId} /> },
              { label: 'Copilot ID', value: copilot.id },
              { label: 'Manifest ID', value: <TextValue value={manifest?.id ?? null} /> },
              { label: 'Version ID', value: <TextValue value={currentVersion?.id ?? null} /> },
              { label: 'Total runs', value: String(metrics.totalRuns) },
            ]}
          />
        </Section>
      </div>

      {/* Advanced: raw material, collapsed by default. */}
      <details className={surfaceSectionClass}>
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-zinc-300 hover:text-white">
          Advanced — raw manifest and internal identifiers
        </summary>
        <div className="px-5 pb-5">
          {manifest ? (
            <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-4 font-mono text-[11px] leading-5 text-zinc-400">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          ) : (
            <Text className="!text-xs">No manifest is recorded for this agent.</Text>
          )}
        </div>
      </details>
    </div>
  )
}
