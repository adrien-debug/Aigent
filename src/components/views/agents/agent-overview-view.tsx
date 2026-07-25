import {
  CostValue,
  DurationValue,
  RateValue,
  TimeAgoValue,
} from '@/components/agent-ops/agent-detail/agent-value'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { PageLayout } from '@/components/shell/page-layout'
import { eyebrowClass } from '@/components/shell/page-header'
import { surfaceSunken } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Agent Overview — the operational cockpit (AIGENT-AGENT-PAGES-021).
 *
 * Replaces an 816-line page of stacked cards, meters and scorecards. The order
 * answers an operator's questions in sequence: is it working, what did it just
 * do, what can it do, what needs attention.
 */

/**
 * A tool's NATURE, never its confirmation policy. The old strip printed
 * `requiresConfirmation ? 'confirm' : 'read'`, so a mutating tool with no
 * confirmation read as "read" — the exact anti-pattern the Tools tab fixed.
 * Same rule as tools/page.tsx `natureOf`: high/critical mutates by definition;
 * below that only an explicit `mutates: false` proves a read; absent is unknown.
 */
function toolNatureLabel(tool: { riskLevel: string; mutates?: boolean }): string {
  if (tool.riskLevel === 'high' || tool.riskLevel === 'critical') return 'can write'
  if (tool.mutates === undefined) return 'unverified'
  return tool.mutates ? 'can write' : 'read-only'
}

function LatestResult({ detail }: { detail: AgentDetail }) {
  const run = detail.metrics.lastRun
  if (!run) {
    return (
      <EmptyState
        title="No run yet"
        description={
          detail.executable
            ? 'This agent is executable but has never run. Start one to produce its first result.'
            : 'This agent has never run, and cannot run in its current state.'
        }
        action={
          detail.executable ? (
            <Button color="accent" href={`/admin/agents/${detail.copilot.id}/runs`}>
              Run agent
            </Button>
          ) : undefined
        }
      />
    )
  }

  // An unproven model is never presented as fact.
  const unverified = run.modelUnverified !== false

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RunStatusText status={run.status} />
        <span className="text-xs text-zinc-500">
          <TimeAgoValue value={run.startedAt} />
        </span>
        <span className="font-mono text-xs text-zinc-400">
          {run.resolvedModel ? `${run.resolvedModel}${unverified ? ' (unverified)' : ''}` : 'model unverified'}
        </span>
      </div>

      {run.outputSummary ? (
        <p className="max-w-3xl text-sm leading-6 text-zinc-300">{run.outputSummary.slice(0, 600)}</p>
      ) : null}

      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg sm:grid-cols-4 ${surfaceSunken}`}>
        {[
          { label: 'Duration', value: <DurationValue value={run.latencyMs ?? null} /> },
          { label: 'Cost', value: <CostValue value={run.costUsd ?? null} /> },
          { label: 'Tool calls', value: run.toolCallCount },
          { label: 'Unsafe attempts', value: run.unsafeAttemptCount },
        ].map((cell) => (
          <div key={cell.label} className="px-4 py-3">
            <dt className={eyebrowClass}>{cell.label}</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-100">{cell.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function AgentOverviewView({ detail }: { detail: AgentDetail }) {
  const { agent, metrics, manifest, tools, runs, executable, copilot } = detail
  const id = copilot.id

  // Attention exists only when something is genuinely wrong — never an empty
  // panel. Blockers are NOT repeated here: the header already states them in
  // full, and saying the same thing twice on one screen reads as two problems.
  const attention: { label: string; detail: string }[] = []
  if (executable && metrics.totalRuns === 0) {
    attention.push({
      label: 'No proof run yet',
      detail: 'This agent is executable but has never produced a run.',
    })
  }
  if (metrics.runsWithoutCost > 0) {
    attention.push({
      label: `${metrics.runsWithoutCost} recent run${metrics.runsWithoutCost > 1 ? 's' : ''} without a recorded cost`,
      detail: 'Their cost is unavailable and is excluded from the 24h total rather than counted as zero.',
    })
  }

  return (
    <PageLayout>
      {/* SIX stats, not eight: the band lays out on a 6-column grid, so a
          seventh and eighth wrap onto a second row and leave four empty cells.
          Status and tool count already appear in the header and in Capabilities;
          what belongs here is what changes run to run. */}
      <AgentKpiBand
        separators
        flush
        stats={[
          { name: 'Executable', value: executable ? 'Yes' : 'No', valueSize: 'small' },
          {
            name: 'Last run',
            content: (
              <span className="font-mono text-lg/6 font-light tabular-nums">
                <TimeAgoValue value={metrics.lastRun?.startedAt ?? null} />
              </span>
            ),
          },
          { name: 'Runs 24h', value: String(metrics.runs24h), valueSize: 'small' },
          {
            name: 'Success rate',
            content: (
              <span className="font-mono text-lg/6 font-light tabular-nums">
                <RateValue value={metrics.successRate} />
              </span>
            ),
          },
          {
            name: 'Avg duration',
            content: (
              <span className="font-mono text-lg/6 font-light tabular-nums">
                <DurationValue value={metrics.avgDurationMs} />
              </span>
            ),
          },
          {
            name: 'Cost 24h',
            content: (
              <span className="font-mono text-lg/6 font-light tabular-nums">
                <CostValue value={metrics.cost24hUsd} />
              </span>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Section title="Latest result" description="The most recent run, exactly as recorded.">
            <LatestResult detail={detail} />
          </Section>

          <Section
            title="Recent runs"
            description={`${metrics.totalRuns} run${metrics.totalRuns === 1 ? '' : 's'} recorded.`}
            actions={
              runs.length > 0 ? (
                <Link href={`/admin/agents/${id}/runs`} className="text-xs text-zinc-400 hover:text-white">
                  View all
                </Link>
              ) : undefined
            }
          >
            {runs.length === 0 ? (
              <EmptyState title="No runs yet" description="Runs appear here as soon as the agent executes." />
            ) : (
              <ul className="flex flex-col">
                {runs.slice(0, 6).map((run) => (
                  <li
                    key={run.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 py-2.5 last:border-0"
                  >
                    <RunStatusText status={run.status} />
                    <span className="truncate text-xs text-zinc-500">
                      <TimeAgoValue value={run.startedAt} /> · {run.toolCallCount} tool calls
                    </span>
                    <span className="font-mono text-xs tabular-nums text-zinc-400">
                      <CostValue value={run.costUsd ?? null} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Mission" description="What this agent does, and what it may never do.">
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-6 text-zinc-300">
                {copilot.description || 'No mission recorded for this agent.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {agent?.unavailableFields.includes('readOnly') ? (
                  // Nature is unproven (no manifest, or a tool with an unknown
                  // risk level). Do NOT assert "Write-capable" — that's the same
                  // lie the Tools tile avoids. Same signal, same three states.
                  <Badge color="zinc">Nature unverified</Badge>
                ) : (
                  <Badge color={agent?.readOnly ? 'accent' : 'zinc'}>
                    {agent?.readOnly ? 'Read-only' : 'Write-capable'}
                  </Badge>
                )}
                <Badge color={agent?.requiresHumanApproval ? 'accentStrong' : 'zinc'}>
                  {agent?.requiresHumanApproval ? 'Human approval required' : 'No approval step'}
                </Badge>
              </div>
              {manifest && manifest.forbiddenActions.length > 0 ? (
                <div>
                  <p className={eyebrowClass}>Never allowed</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {manifest.forbiddenActions.slice(0, 5).map((action) => (
                      <li key={action} className="text-xs leading-5 text-zinc-400">
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            title="Capabilities"
            description={`${tools.length} tool${tools.length === 1 ? '' : 's'} mounted.`}
            actions={
              <Link href={`/admin/agents/${id}/tools`} className="text-xs text-zinc-400 hover:text-white">
                All tools
              </Link>
            }
          >
            {tools.length === 0 ? (
              <EmptyState title="No tools" description="This agent has no tool mounted." />
            ) : (
              <ul className="flex flex-col gap-2">
                {tools.slice(0, 6).map((tool) => (
                  <li key={tool.id} className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-zinc-300">{tool.name}</span>
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      {toolNatureLabel(tool)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {attention.length > 0 ? (
            <Section title="Attention" description="Real issues only — hidden entirely when there are none.">
              <ul className="flex flex-col gap-3">
                {attention.map((item) => (
                  <li key={item.label} className="text-sm leading-6">
                    <span className="font-medium text-zinc-100">{item.label}</span>
                    <span className="text-zinc-400"> — {item.detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </PageLayout>
  )
}
