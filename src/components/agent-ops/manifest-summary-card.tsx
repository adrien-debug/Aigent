import { XMarkIcon } from '@heroicons/react/16/solid'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ChipCluster } from '@/components/agent-ops/widgets/chip-cluster'
import { Badge } from '@/components/catalyst/badge'
import { Divider } from '@/components/catalyst/divider'
import { Text } from '@/components/catalyst/text'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import type { AgentManifest, MemorySource } from '@/lib/agent-mission-control/types'

const memoryKindLabel: Record<MemorySource['kind'], string> = {
  'vector-store': 'vector-store',
  sql: 'sql',
  document: 'document',
  session: 'session',
  api: 'api',
}

const memoryScopeLabel: Record<MemorySource['scope'], string> = {
  user: 'User',
  project: 'Project',
  global: 'Global',
}

/** Small in-panel section label — meta tier of the text ladder. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{children}</p>
}

/**
 * The Manifest narrative panel — ONE card, sections separated only by hairline
 * <Divider/> (never a nested box). System prompt → scope → guardrails → memory
 * → output contract flow as a single spine. Confirmation policy and run limits
 * live in the KPI strip, so they are not restated here. Server-safe, read-only.
 */
export function ManifestSummaryCard({
  manifest,
  actions,
}: {
  manifest: AgentManifest
  /** Rendered in the card header (e.g. the version select). */
  actions?: React.ReactNode
}) {
  return (
    <AgentSectionCard
      title="Manifest"
      description="The compiled definition served to the runtime gate."
      actions={
        <>
          <Badge color="zinc" className="font-mono tabular-nums">
            {manifest.version}
          </Badge>
          <span className="hidden text-xs whitespace-nowrap text-zinc-500 sm:inline">
            Updated <time dateTime={manifest.updatedAt}>{formatTimestamp(manifest.updatedAt)}</time>
          </span>
          {actions}
        </>
      }
    >
      <div className="space-y-6">
        {/* System prompt ---------------------------------------------------- */}
        <div>
          <FieldLabel>System prompt</FieldLabel>
          <Text className="mt-3">{manifest.systemPromptSummary}</Text>
        </div>

        <Divider />

        {/* Scope ------------------------------------------------------------ */}
        <ChipCluster
          label="Allowed routes"
          items={manifest.allowedRoutes.map((route) => ({ key: route, text: route }))}
          tone="zinc"
          emptyText="No routes allowlisted — the agent cannot operate anywhere."
        />

        <Divider />

        {/* Guardrails ------------------------------------------------------- */}
        <div className="space-y-6">
          <ChipCluster
            label="Forbidden actions"
            items={manifest.forbiddenActions.map((action) => ({
              key: action,
              text: action,
              icon: <XMarkIcon aria-hidden="true" className="size-3" />,
            }))}
            tone="accentSolid"
            emptyText="No actions are hard-forbidden for this agent."
          />
          {manifest.alwaysConfirmActions.length > 0 ? (
            <ChipCluster
              label="Always confirm"
              items={manifest.alwaysConfirmActions.map((action) => ({ key: action, text: action }))}
              tone="accentStrong"
            />
          ) : null}
        </div>

        <Divider />

        {/* Memory ----------------------------------------------------------- */}
        <div>
          <FieldLabel>
            Memory sources{' '}
            <span className="font-mono normal-case tabular-nums">· {manifest.memorySources.length}</span>
          </FieldLabel>
          {manifest.memorySources.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {manifest.memorySources.map((source) => (
                <li key={source.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge color="zinc" className="font-mono">
                    {memoryKindLabel[source.kind]}
                  </Badge>
                  <span className="font-medium text-zinc-950 dark:text-white">{source.name}</span>
                  <span className="text-xs text-zinc-500">{memoryScopeLabel[source.scope]}</span>
                  <span className="ml-auto">
                    {source.readOnly ? (
                      <Badge color="zinc">Read-only</Badge>
                    ) : (
                      <Badge color="accentStrong">Read &amp; write</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Text className="mt-3">No memory sources attached to this manifest.</Text>
          )}
        </div>

        <Divider />

        {/* Output contract -------------------------------------------------- */}
        <div className="space-y-6">
          <div>
            <FieldLabel>Output contract</FieldLabel>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Badge color="zinc" className="font-mono">
                {manifest.outputContract.format}
              </Badge>
              {manifest.outputContract.schemaName ? (
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                  {manifest.outputContract.schemaName}
                </span>
              ) : (
                <span className="text-sm text-zinc-500">No named schema</span>
              )}
            </div>
          </div>
          <ChipCluster
            label="Invariants"
            items={manifest.outputContract.invariants.map((inv) => ({ key: inv, text: inv }))}
            tone="zinc"
            emptyText="No invariants declared."
          />
        </div>
      </div>
    </AgentSectionCard>
  )
}
