import { XMarkIcon } from '@heroicons/react/16/solid'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { Badge } from '@/components/catalyst/badge'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/catalyst/description-list'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentManifest, ConfirmationPolicy, MemorySource } from '@/lib/agent-mission-control/types'

const confirmationPolicyConfig: Record<
  ConfirmationPolicy,
  { label: string; color: 'zinc' | 'amber' | 'green'; detail: string }
> = {
  never: {
    label: 'Never',
    color: 'zinc',
    detail: 'Runs autonomously — no human confirmation is requested for any action.',
  },
  'risky-only': {
    label: 'Risky actions only',
    color: 'amber',
    detail: 'High-risk tool calls pause and wait for human confirmation before executing.',
  },
  always: {
    label: 'Always',
    color: 'green',
    detail: 'Every action requires human confirmation before it executes.',
  },
}

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

/** Small in-card section label — meta tier of the text ladder. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{children}</p>
}

/**
 * Read-only presentation of an agent manifest: scope, guardrails, memory,
 * output contract and hard run limits. Server-safe (no interactivity).
 */
export function ManifestSummaryCard({ manifest }: { manifest: AgentManifest }) {
  const policy = confirmationPolicyConfig[manifest.confirmationPolicy]

  return (
    <div className="space-y-6">
      {/* System prompt & scope ------------------------------------------------ */}
      <AgentSectionCard
        title="System prompt & scope"
        description="What the agent is instructed to do, and where it may operate."
        actions={
          <>
            <Badge color="zinc" className="font-mono tabular-nums">
              {manifest.version}
            </Badge>
            <span className="text-xs whitespace-nowrap text-zinc-500">
              Updated <time dateTime={manifest.updatedAt}>{formatTimestamp(manifest.updatedAt)}</time>
            </span>
          </>
        }
      >
        <Text>{manifest.systemPromptSummary}</Text>

        <div className="mt-6">
          <FieldLabel>
            Allowed routes{' '}
            <span className="font-mono tabular-nums normal-case">· {manifest.allowedRoutes.length}</span>
          </FieldLabel>
          {manifest.allowedRoutes.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {manifest.allowedRoutes.map((route) => (
                <li key={route}>
                  <Badge color="zinc" className="font-mono">
                    {route}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Text className="mt-3">No routes allowlisted — the agent cannot operate anywhere.</Text>
          )}
        </div>
      </AgentSectionCard>

      {/* Guardrails ----------------------------------------------------------- */}
      <AgentSectionCard
        title="Guardrails"
        description="Hard limits enforced by the runtime gate before any action executes."
      >
        <FieldLabel>
          Forbidden actions{' '}
          <span className="font-mono tabular-nums normal-case">· {manifest.forbiddenActions.length}</span>
        </FieldLabel>
        {manifest.forbiddenActions.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {manifest.forbiddenActions.map((action) => (
              <li key={action} className="flex gap-3 text-sm/6 text-zinc-700 dark:text-zinc-300">
                <XMarkIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span className="sr-only">Forbidden:</span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Text className="mt-3">No actions are hard-forbidden for this agent.</Text>
        )}

        <div className="mt-6 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <FieldLabel>Confirmation policy</FieldLabel>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge color={policy.color}>{policy.label}</Badge>
            <span className="text-sm/6 text-zinc-500 dark:text-zinc-400">{policy.detail}</span>
          </div>
          {manifest.alwaysConfirmActions.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-zinc-500">Always requires confirmation, regardless of policy:</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {manifest.alwaysConfirmActions.map((action) => (
                  <li key={action}>
                    <Badge color="zinc" className="font-mono">
                      {action}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </AgentSectionCard>

      {/* Memory sources ------------------------------------------------------- */}
      <AgentSectionCard
        title="Memory sources"
        description="Stores the agent can read from — write access is called out explicitly."
      >
        {manifest.memorySources.length > 0 ? (
          <Table dense>
            <TableHead>
              <TableRow>
                <TableHeader>Source</TableHeader>
                <TableHeader>Kind</TableHeader>
                <TableHeader>Scope</TableHeader>
                <TableHeader>Access</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {manifest.memorySources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell className="font-medium text-zinc-950 dark:text-white">{source.name}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{memoryKindLabel[source.kind]}</TableCell>
                  <TableCell className="text-zinc-500 dark:text-zinc-400">{memoryScopeLabel[source.scope]}</TableCell>
                  <TableCell>
                    {source.readOnly ? (
                      <Badge color="zinc">Read-only</Badge>
                    ) : (
                      <Badge color="amber">Read &amp; write</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text>No memory sources attached to this manifest.</Text>
        )}
      </AgentSectionCard>

      {/* Output contract -------------------------------------------------------- */}
      <AgentSectionCard title="Output contract" description="Shape and invariants every response must satisfy.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge color="zinc" className="font-mono">
            {manifest.outputContract.format}
          </Badge>
          {manifest.outputContract.schemaName ? (
            <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{manifest.outputContract.schemaName}</span>
          ) : (
            <span className="text-sm text-zinc-500">No named schema</span>
          )}
        </div>

        <div className="mt-6">
          <FieldLabel>
            Invariants{' '}
            <span className="font-mono tabular-nums normal-case">· {manifest.outputContract.invariants.length}</span>
          </FieldLabel>
          {manifest.outputContract.invariants.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {manifest.outputContract.invariants.map((invariant) => (
                <li key={invariant} className="flex gap-3 text-sm/6 text-zinc-700 dark:text-zinc-300">
                  <span aria-hidden="true" className="mt-2.5 size-1 shrink-0 rounded-full bg-zinc-500" />
                  <span>{invariant}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Text className="mt-3">No invariants declared.</Text>
          )}
        </div>
      </AgentSectionCard>

      {/* Run limits ------------------------------------------------------------- */}
      <AgentSectionCard
        title="Run limits"
        description="Hard ceilings — a run is aborted when either limit is reached."
      >
        <DescriptionList>
          <DescriptionTerm>Max steps per run</DescriptionTerm>
          <DescriptionDetails>
            <span className="font-mono tabular-nums">{manifest.maxStepsPerRun}</span>
            <span className="ml-1.5 text-zinc-500">steps</span>
          </DescriptionDetails>

          <DescriptionTerm>Max cost per run</DescriptionTerm>
          <DescriptionDetails>
            <span className="font-mono tabular-nums">{formatUsd(manifest.maxCostPerRunUsd)}</span>
            <span className="ml-1.5 text-zinc-500">USD</span>
          </DescriptionDetails>
        </DescriptionList>
      </AgentSectionCard>
    </div>
  )
}
