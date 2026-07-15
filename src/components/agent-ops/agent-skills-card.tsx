import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import type { AgentManifest, ToolDefinition } from '@/lib/agent-mission-control/types'

/**
 * Skills — an at-a-glance recap of what the agent can do, aggregating the
 * manifest role, the enabled tools and the guardrail counters that otherwise
 * live scattered across the manifest and tools views. Pure presentation:
 * every field is passed in, no fetch happens here.
 */
export function AgentSkillsCard({
  manifest,
  enabledTools,
  className,
}: {
  manifest: AgentManifest | undefined
  enabledTools: ToolDefinition[]
  className?: string
}) {
  // No manifest → the agent has not been framed yet; skills are undefined.
  if (!manifest) {
    return (
      <AgentBentoCard title="Skills" className={className}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No manifest yet — skills appear once the agent is framed.
        </p>
      </AgentBentoCard>
    )
  }

  const gatedCount = enabledTools.filter((tool) => tool.requiresConfirmation).length

  return (
    <AgentBentoCard title="Skills" className={className}>
      {/* Role — the manifest's one-line framing of what the agent is for */}
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{manifest.systemPromptSummary}</p>

      {/* Compact meta line: capability count · gated count · confirmation policy */}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          <span className="font-mono tabular-nums">{enabledTools.length}</span> capabilities
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-mono tabular-nums">{gatedCount}</span> gated
        </span>
        <span aria-hidden="true">·</span>
        <span>
          confirm: <span className="font-mono">{manifest.confirmationPolicy}</span>
        </span>
      </p>

      {/* Capabilities — one row per enabled tool */}
      {enabledTools.length > 0 ? (
        <ul className="mt-6 divide-y divide-zinc-950/5 dark:divide-white/5">
          {enabledTools.map((tool) => (
            <li key={tool.id} className="flex items-center gap-3 py-3">
              <ToolBadge name={tool.name} risk={tool.riskLevel} />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                {tool.description}
              </span>
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {tool.requiresConfirmation ? 'gated' : 'read-only'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">No tools enabled yet.</p>
      )}

      {/* Guardrails — count only, the full list lives in the manifest view */}
      {manifest.forbiddenActions.length > 0 ? (
        <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
          Guardrails: <span className="font-mono tabular-nums">{manifest.forbiddenActions.length}</span> forbidden
          action(s)
        </p>
      ) : null}
    </AgentBentoCard>
  )
}
