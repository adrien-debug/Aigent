import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Instructions — what the agent was told (AIGENT-AGENT-PAGES-021).
 *
 * Replaces the legacy Manifest page's prose half. Two rules drive the layout:
 * prose is capped at a reading measure (a system prompt stretched across 1728px
 * is unreadable), and guardrails are structured LINES, not a wall of badges.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className={surfaceSectionClass}>
      <div className="px-5 pt-4 pb-3">
        <Subheading level={2}>{title}</Subheading>
        {description ? <Text className="mt-1 !text-xs">{description}</Text> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}

/** Guardrails as scannable lines — never a hundred badges glued together. */
function RuleList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li
          key={item}
          className="border-b border-white/5 py-2.5 text-sm leading-6 text-zinc-300 last:border-0"
        >
          {item}
        </li>
      ))}
    </ul>
  )
}

export default async function AgentInstructionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  const { manifest, copilot } = detail

  if (!manifest) {
    return (
      <EmptyState
        title="No instructions recorded"
        description="This agent has no manifest, so it carries no system prompt, guardrails or output contract."
      />
    )
  }

  const contract = manifest.outputContract

  return (
    <div className="flex flex-col gap-6">
      <Section title="Mission" description="The short statement of what this agent is for.">
        <p className="max-w-[68ch] text-sm leading-7 text-zinc-300">
          {copilot.description || 'No mission recorded.'}
        </p>
      </Section>

      <Section title="System prompt" description="The full instruction the model receives on every run.">
        {manifest.systemPromptSummary ? (
          <p className="max-w-[80ch] text-sm leading-7 whitespace-pre-wrap text-zinc-300">
            {manifest.systemPromptSummary}
          </p>
        ) : (
          <Text className="!text-xs">No system prompt recorded.</Text>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {manifest.forbiddenActions.length > 0 ? (
          <Section title="Forbidden actions" description="Refused by the runtime gate, regardless of the prompt.">
            <RuleList items={manifest.forbiddenActions} />
          </Section>
        ) : null}

        {manifest.alwaysConfirmActions.length > 0 ? (
          <Section title="Always confirm" description="These require explicit human approval every time.">
            <RuleList items={manifest.alwaysConfirmActions} />
          </Section>
        ) : null}

        {manifest.skills.length > 0 ? (
          <Section title="Skills" description="Mission-level capabilities this agent performs.">
            <ul className="flex flex-col">
              {manifest.skills.map((skill) => (
                <li key={skill.label} className="border-b border-white/5 py-2.5 last:border-0">
                  <p className="text-sm text-zinc-200">{skill.label}</p>
                  {skill.detail ? (
                    <p className="mt-1 max-w-[70ch] text-xs leading-5 text-zinc-500">{skill.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {contract ? (
          <Section title="Output contract" description="The shape every run is expected to produce.">
            <dl className="flex flex-col">
              {[
                { label: 'Format', value: contract.format },
                { label: 'Schema', value: contract.schemaName ?? 'None declared' },
              ].map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-1 gap-1 border-b border-white/5 py-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className={eyebrowClass}>{row.label}</dt>
                  <dd className="font-mono text-xs break-words text-zinc-300">{row.value}</dd>
                </div>
              ))}
            </dl>
            {contract.invariants.length > 0 ? (
              <div className="mt-4">
                <p className={eyebrowClass}>Invariants</p>
                <RuleList items={contract.invariants} />
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  )
}
