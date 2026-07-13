'use client'

import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

interface ProposedTool {
  name: string
  riskLevel: string
  requiresConfirmation: boolean
}
interface TestCase {
  name: string
  expectedBehavior?: string
}
interface ManifestDraft {
  name?: string
  description?: string
  suggestedRuntime?: string
  suggestedModel?: string
  systemPromptSummary?: string
  confirmationPolicy?: string
  maxStepsPerRun?: number
}

const FLOW_STEPS = ['start', 'agent', 'approval?', 'tools?', 'final'] as const

/**
 * Secondary preview rail — shows the in-progress spec without blocking the chat.
 */
export function ProjectBuilderPreviewPanel({
  draft,
  selectedTools,
  testCases,
  risks,
  status,
  createdCopilotId,
  projectName,
}: {
  draft: ManifestDraft | null
  selectedTools: ProposedTool[]
  testCases: TestCase[]
  risks: string[]
  status: string | null
  createdCopilotId: string | null
  projectName: string
}) {
  const hasSpec = draft || selectedTools.length > 0 || testCases.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl ring-1 ring-zinc-950/5 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 px-4 py-3 dark:border-white/10">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Preview</p>
        <p className="mt-0.5 text-sm font-medium text-zinc-950 dark:text-white">
          {createdCopilotId ? 'Draft created' : hasSpec ? 'Spec in progress — not created yet' : 'Waiting for discussion'}
        </p>
        {status ? (
          <p className="mt-1 text-xs text-zinc-500">{status}</p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Flow</p>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {FLOW_STEPS.map((step, i) => (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={
                    'rounded-md px-2 py-0.5 font-mono text-[10px] ring-1 ' +
                    (hasSpec || createdCopilotId
                      ? 'bg-[var(--accent-soft)] text-accent-700 ring-[var(--accent-line)] dark:text-accent-300'
                      : 'text-zinc-500 ring-zinc-950/10 dark:ring-white/10')
                  }
                >
                  {step}
                </span>
                {i < FLOW_STEPS.length - 1 ? (
                  <span aria-hidden="true" className="text-zinc-400">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        {draft ? (
          <dl className="space-y-2 text-sm">
            <PreviewRow label="Agent name" value={draft.name} />
            <PreviewRow label="Role" value={draft.description} />
            <PreviewRow label="Runtime" value={draft.suggestedRuntime} mono />
            <PreviewRow label="Model" value={draft.suggestedModel} mono />
            <PreviewRow label="Confirmation" value={draft.confirmationPolicy} mono />
            {typeof draft.maxStepsPerRun === 'number' ? (
              <PreviewRow label="Max steps" value={String(draft.maxStepsPerRun)} mono />
            ) : null}
          </dl>
        ) : (
          <Text className="!text-xs">Ask the Builder to prepare a spec — preview fills in as the conversation progresses.</Text>
        )}

        {selectedTools.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tools</p>
            <ul className="mt-2 space-y-1.5">
              {selectedTools.map((t) => (
                <li key={t.name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ToolBadge name={t.name} risk={asToolRisk(t.riskLevel)} />
                  <span className="text-[10px] text-zinc-500">
                    {t.requiresConfirmation ? 'gated' : 'read-only'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {testCases.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tests</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {testCases.slice(0, 4).map((c, i) => (
                <li key={i} className="text-zinc-700 dark:text-zinc-300">
                  {c.name}
                </li>
              ))}
              {testCases.length > 4 ? (
                <li className="text-zinc-500">+{testCases.length - 4} more</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {risks.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Risk policy</p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {risks.slice(0, 3).map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {createdCopilotId ? (
          <div className="rounded-lg bg-zinc-950 p-3 ring-1 ring-white/10">
            <Badge color="accent">Draft attached to {projectName}</Badge>
            <Link
              href={`/admin/agents/${createdCopilotId}`}
              className="mt-2 block text-xs font-medium text-accent-400 hover:text-accent-300"
            >
              Open drafted agent →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PreviewRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : ' text-sm')}>
        {value}
      </dd>
    </div>
  )
}
