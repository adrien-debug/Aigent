import { EmptyState } from '@/components/agent-ops/empty-state'
import { eyebrowClass } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { surfaceSectionClass } from '@/components/ui/section'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { ToolDefinition } from '@/lib/agent-mission-control/types'

/**
 * Tools — what the agent can actually do (AIGENT-AGENT-PAGES-021).
 *
 * The legacy Manifest tab listed tool IDs. An operator cannot act on
 * `tool-market-intelligence-read-market-snapshot`; they need the name, what it
 * reads, and whether it can change anything. Groups are derived from the tools
 * present, so an empty category is never rendered.
 */

/**
 * A tool's NATURE — does it change anything? — never its confirmation policy.
 *
 * The page badged every confirmation-free tool "Read-only", so a mutating tool
 * whose author had simply not required a confirmation read as harmless, and the
 * "READ-ONLY 5" tile counted them. Same rule as `isHighRiskOrWriteCapableTool`
 * (authoring-writes.ts) and as `available-agents.ts`: high/critical risk mutates
 * by definition, and below that only an explicit `mutates: false` — an auditable
 * act by the tool's author, migration 0022/0023 — proves a read. An absent flag
 * is UNKNOWN, never "read-only".
 */
type ToolNature = 'read-only' | 'mutating' | 'unknown'

function natureOf(tool: ToolDefinition): ToolNature {
  if (tool.riskLevel === 'high' || tool.riskLevel === 'critical') return 'mutating'
  if (tool.mutates === undefined) return 'unknown'
  return tool.mutates ? 'mutating' : 'read-only'
}

const NATURE_LABELS: Record<ToolNature, string> = {
  'read-only': 'Read-only',
  mutating: 'Can write',
  unknown: 'Nature unverified',
}

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

export function AgentToolsView({ detail }: { detail: AgentDetail }) {
  const { tools, agent, metrics } = detail
  const unresolved = new Set(agent?.unresolvedToolIds ?? [])

  // Counted by nature, not by policy. `agent.unavailableFields` carries the
  // catalogue's own verdict on the same question: when it names `readOnly`,
  // the agent-level claim is unproven and the tile must not assert one.
  const readOnly = tools.filter((t) => natureOf(t) === 'read-only').length
  const natureUnknown = tools.filter((t) => natureOf(t) === 'unknown').length
  const readOnlyUnproven = agent?.unavailableFields.includes('readOnly') ?? true
  const confirmRequired = tools.filter((t) => t.requiresConfirmation).length
  const disabled = tools.filter((t) => !t.enabled).length

  // The RUNTIME dimension, distinct from "declared" (Total) and "resolved"
  // (Total − Unresolved): did a completed run actually INVOKE any tool? A real
  // MEASURED 0 with resolved tools present is the LangGraph "healthy catalogue /
  // toolless execution" trap — the tools resolve to handlers but were never
  // mounted on the assistant at run time, so the model never called them. UNKNOWN
  // (no completed run) shows "—", never a fabricated 0.
  const resolved = tools.length - unresolved.size
  const toolCallsMeasured = metrics.toolCallCountState === 'MEASURED'
  const toolCallsNote =
    toolCallsMeasured && metrics.toolCallCount === 0 && resolved > 0
      ? 'resolved but never invoked — may not be mounted at runtime'
      : toolCallsMeasured
        ? undefined
        : 'no completed run to measure'

  const groups = new Map<string, ToolDefinition[]>()
  for (const tool of tools) {
    const g = groupOf(tool)
    const list = groups.get(g) ?? []
    list.push(tool)
    groups.set(g, list)
  }

  return (
    <PageLayout>
      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl md:grid-cols-6 ${surfaceSectionClass}`}>
        {[
          { label: 'Total', value: tools.length },
          {
            label: 'Read-only',
            value: readOnly,
            // The count of tools PROVEN read-only. The note says how much of the
            // set that count leaves unanswered, so "Read-only 5" can never be
            // read as "5 tools, all harmless" when the nature of some is unknown.
            note:
              natureUnknown > 0
                ? `${natureUnknown} unverified`
                : readOnlyUnproven
                  ? 'agent-level claim unproven'
                  : undefined,
          },
          { label: 'Needs confirmation', value: confirmRequired },
          { label: 'Disabled', value: disabled },
          { label: 'Unresolved', value: unresolved.size },
          // The "called" dimension — a run-time fact, not a declaration. Makes
          // the toolless-execution trap legible next to declared/resolved.
          { label: 'Tool calls', value: toolCallsMeasured ? metrics.toolCallCount : '—', note: toolCallsNote },
        ].map((cell) => (
          <div key={cell.label} className="px-5 py-4">
            <dt className={eyebrowClass}>{cell.label}</dt>
            <dd className="mt-1 font-mono text-xl/7 font-light tabular-nums text-zinc-100">{cell.value}</dd>
            {'note' in cell && cell.note ? (
              // zinc-400, not -500: check-contrast measures -500 at 3.59:1 on
              // this raised plane (rgb(26,26,30)) for a 4.5 threshold. This note
              // is the provenance of the number above it — it must be readable.
              <p className="mt-1 text-[11px] text-zinc-400">{cell.note}</p>
            ) : null}
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
                      {/* Two independent facts, two badges: what the tool DOES,
                          then the policy applied to it. Collapsing them into one
                          badge is what let "Read-only" stand for "nobody asked
                          for a confirmation". */}
                      <Badge color={natureOf(tool) === 'read-only' ? 'zinc' : 'accentStrong'}>
                        {NATURE_LABELS[natureOf(tool)]}
                      </Badge>
                      {tool.requiresConfirmation ? (
                        <Badge color="accentStrong">Confirmation required</Badge>
                      ) : null}
                      {!tool.enabled ? <Badge color="zinc">Disabled</Badge> : null}
                    </div>
                    {tool.description ? (
                      <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-400">{tool.description}</p>
                    ) : null}
                    {/* Labels move zinc-500 -> zinc-400: check-contrast measures
                        -500 at 3.59:1 on this raised plane (rgb(26,26,30)) for a
                        4.5 threshold. The VALUES move -400 -> -300 with them, or
                        label and value would land on the same zinc and the
                        two-level hierarchy of this meta line would collapse —
                        same pair as the dt/dd of agent-observability-view. */}
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-400">
                      <span>
                        Risk: <span className="text-zinc-300">{tool.riskLevel}</span>
                      </span>
                      <span>
                        Provider: <span className="text-zinc-300">{tool.provider}</span>
                      </span>
                      {isUnresolved ? (
                        <span className="text-zinc-300">
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
    </PageLayout>
  )
}
