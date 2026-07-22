import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { ToolDefinition } from '@/lib/agent-mission-control/types'

/**
 * Tools — what the agent can actually do (AIGENT-AGENT-PAGES-021).
 *
 * The legacy Manifest tab listed tool IDs. An operator cannot act on
 * `tool-market-intelligence-read-market-snapshot`; they need the name, what it
 * reads, and whether it can change anything. Groups are derived from the tools
 * present, so an empty category is never rendered.
 */

/** Group from the tool's own name — no invented taxonomy, no empty buckets. */
function groupOf(tool: ToolDefinition): string {
  const n = tool.name
  if (n.includes('account') || n.includes('portfolio') || n.includes('position')) return 'Portfolio'
  if (n.includes('volatility') || n.includes('risk') || n.includes('derivatives')) return 'Risk'
  if (n.includes('macro') || n.includes('structure') || n.includes('regime')) return 'Analysis'
  if (n.includes('market') || n.includes('candle') || n.includes('liquidity') || n.includes('funding'))
    return 'Market data'
  if (n.includes('run') || n.includes('summary') || n.includes('permission')) return 'Reporting'
  return 'Other'
}

export default async function AgentToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  const { tools, agent } = detail
  const unresolved = new Set(agent?.unresolvedToolIds ?? [])

  const readOnly = tools.filter((t) => !t.requiresConfirmation).length
  const confirmRequired = tools.filter((t) => t.requiresConfirmation).length
  const disabled = tools.filter((t) => !t.enabled).length

  const groups = new Map<string, ToolDefinition[]>()
  for (const tool of tools) {
    const g = groupOf(tool)
    const list = groups.get(g) ?? []
    list.push(tool)
    groups.set(g, list)
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl md:grid-cols-5 ${surfaceSectionClass}`}>
        {[
          { label: 'Total', value: tools.length },
          { label: 'Read-only', value: readOnly },
          { label: 'Needs confirmation', value: confirmRequired },
          { label: 'Disabled', value: disabled },
          { label: 'Unresolved', value: unresolved.size },
        ].map((cell) => (
          <div key={cell.label} className="px-5 py-4">
            <dt className={eyebrowClass}>{cell.label}</dt>
            <dd className="mt-1 font-mono text-xl/7 font-light tabular-nums text-zinc-100">{cell.value}</dd>
          </div>
        ))}
      </dl>

      {tools.length === 0 ? (
        <EmptyState
          title="No tools mounted"
          description="This agent has no tool. It can only answer from its instructions."
        />
      ) : (
        [...groups.entries()].map(([group, groupTools]) => (
          <section key={group} className={surfaceSectionClass}>
            <div className="px-5 pt-4 pb-3">
              <Subheading level={2}>{group}</Subheading>
              <Text className="mt-1 !text-xs">
                {groupTools.length} tool{groupTools.length === 1 ? '' : 's'}
              </Text>
            </div>
            <ul className="px-5 pb-5">
              {groupTools.map((tool) => {
                const isUnresolved = unresolved.has(tool.id)
                return (
                  <li key={tool.id} className="border-b border-white/5 py-4 last:border-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="font-mono text-sm text-zinc-100">{tool.name}</span>
                      {isUnresolved ? (
                        <Badge color="accentSolid">No handler</Badge>
                      ) : (
                        <Badge color="zinc">Ready</Badge>
                      )}
                      <Badge color={tool.requiresConfirmation ? 'accentStrong' : 'zinc'}>
                        {tool.requiresConfirmation ? 'Confirmation required' : 'Read-only'}
                      </Badge>
                      {!tool.enabled ? <Badge color="zinc">Disabled</Badge> : null}
                    </div>
                    {tool.description ? (
                      <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-400">{tool.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
                      <span>
                        Risk: <span className="text-zinc-400">{tool.riskLevel}</span>
                      </span>
                      <span>
                        Provider: <span className="text-zinc-400">{tool.provider}</span>
                      </span>
                      {isUnresolved ? (
                        <span className="text-zinc-400">
                          Declared in the manifest but the runner has no handler under this name — every call fails.
                        </span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
