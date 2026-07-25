import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { PageLayout } from '@/components/shell/page-layout'
import { eyebrowClass } from '@/components/shell/page-header'
import { Text } from '@/components/ui/text'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Instructions view — what the agent was told (AIGENT-AGENT-PAGES-021).
 *
 * Replaces the legacy Manifest page's prose half. Two rules drive the layout:
 * prose is capped at a reading measure (a system prompt stretched across 1728px
 * is unreadable), and guardrails are structured LINES, not a wall of badges.
 */

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

export function AgentInstructionsView({ detail }: { detail: AgentDetail }) {
  const { manifest, copilot } = detail

  if (!manifest) {
    return (
      <PageLayout>
        <EmptyState
          title="No instructions recorded"
          description="This agent has no manifest, so it carries no system prompt, guardrails or output contract."
        />
      </PageLayout>
    )
  }

  /**
   * The persisted `output_contract` is free-form JSON. The `OutputContract` TYPE
   * declares `{format, schemaName, invariants}`, but rows written by
   * scripts/provision-tradeagent-roster.mjs carry `{version, fields}` — reading
   * `contract.invariants.length` on those threw and the whole page fell into the
   * error boundary. Nothing validates this column on read, so the type is a
   * claim, not a guarantee: treat it as unknown and render what is actually
   * there. Any scalar key becomes a row; string arrays render as lists.
   */
  const rawContract: Record<string, unknown> =
    manifest.outputContract && typeof manifest.outputContract === 'object'
      ? (manifest.outputContract as unknown as Record<string, unknown>)
      : {}

  const asStringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

  const contractInvariants = asStringList(rawContract.invariants)

  const contractRows = Object.entries(rawContract)
    .filter(([key]) => key !== 'invariants')
    .map(([key, value]) => ({
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      value: Array.isArray(value)
        ? asStringList(value).join(', ')
        : value === null || value === undefined
          ? 'None declared'
          : String(value),
    }))
    .filter((row) => row.value !== '')

  return (
    <PageLayout>
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

        {contractRows.length > 0 || contractInvariants.length > 0 ? (
          <Section title="Output contract" description="The shape every run is expected to produce.">
            {contractRows.length > 0 ? (
              <dl className="flex flex-col">
                {contractRows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-1 gap-1 border-b border-white/5 py-2.5 last:border-0 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className={eyebrowClass}>{row.label}</dt>
                    <dd className="font-mono text-xs break-words text-zinc-300">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {contractInvariants.length > 0 ? (
              <div className="mt-4">
                <p className={eyebrowClass}>Invariants</p>
                <RuleList items={contractInvariants} />
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </PageLayout>
  )
}
