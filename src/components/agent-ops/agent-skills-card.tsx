import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import type { AgentManifest, ToolDefinition } from '@/lib/agent-mission-control/types'

/**
 * Skills — an at-a-glance recap of what the agent can actually DO for its
 * mission. Shows the manifest role, then the business skills the Agent Builder
 * derived from that mission (e.g. "Read spot price", "Emit a verdict"), plus the
 * guardrail counters. Pure presentation: every field is passed in, no fetch.
 *
 * `enabledTools` is still accepted (page.tsx passes it) but no longer rendered —
 * this card surfaces mission skills, not infra tools. It is intentionally not
 * destructured so it produces no unused-variable warning; drop it from the
 * call-site once page.tsx is updated.
 */
export function AgentSkillsCard({
  manifest,
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

  const skills = manifest.skills

  return (
    <AgentBentoCard title="Skills" className={className}>
      {/* Role — the manifest's one-line framing of what the agent is for */}
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{manifest.systemPromptSummary}</p>

      {/* Compact meta line: skill count · confirmation policy */}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          <span className="font-mono tabular-nums">{skills.length}</span> skills
        </span>
        <span aria-hidden="true">·</span>
        <span>
          confirm: <span className="font-mono">{manifest.confirmationPolicy}</span>
        </span>
      </p>

      {/* Mission skills — one row per business skill the agent was given */}
      {skills.length > 0 ? (
        <ul className="mt-6 divide-y divide-zinc-950/5 dark:divide-white/5">
          {skills.map((skill, index) => (
            <li key={`${skill.label}-${index}`} className="flex items-start gap-3 py-3">
              <span
                aria-hidden="true"
                className="mt-1.5 size-1 shrink-0 rounded-full bg-accent-500"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {skill.label}
                </span>
                {skill.detail ? (
                  <span className="mt-0.5 block text-xs text-zinc-500 line-clamp-2 dark:text-zinc-400">
                    {skill.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No skills defined yet — the Agent Builder derives them from the mission.
        </p>
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
