'use client'

import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type { AgentPreview } from '@/lib/agent-mission-control/project-builder-types'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

const DEFAULT_FLOW = ['start', 'agent', 'approval?', 'tools?', 'final'] as const

/**
 * Secondary preview rail — driven by persistent conversation preview state.
 */
export function ProjectBuilderPreviewPanel({
  preview,
  conversationStatus,
  createdCopilotId,
  projectName,
  selectingOption,
  onSelectOption,
  onCreateDraft,
  creatingDraft,
  draftReady,
}: {
  preview: AgentPreview | null
  conversationStatus: string | null
  createdCopilotId: string | null
  projectName: string
  selectingOption?: boolean
  onSelectOption?: (optionId: string) => void
  onCreateDraft?: () => void
  creatingDraft?: boolean
  draftReady?: boolean
}) {
  const flow = preview?.flow?.length ? preview.flow : [...DEFAULT_FLOW]
  const tools =
    preview?.proposedTools ??
    (preview?.tools ?? []).map((name) => ({
      name,
      riskLevel: 'low' as const,
      requiresConfirmation: false,
    }))
  const tests = preview?.testCases ?? (preview?.tests ?? []).map((name) => ({ name }))
  const hasSpec = Boolean(preview?.name || preview?.role || tools.length > 0 || preview?.options?.length)

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl ring-1 ring-zinc-950/5 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 px-4 py-3 dark:border-white/10">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Preview</p>
        <p className="mt-0.5 text-sm font-medium text-zinc-950 dark:text-white">
          {createdCopilotId ? 'Draft created' : hasSpec ? 'Spec in progress — not created yet' : 'Waiting for discussion'}
        </p>
        {conversationStatus ? <p className="mt-1 text-xs text-zinc-500">{conversationStatus}</p> : null}
        {preview?.readyForApproval && !createdCopilotId ? (
          <Badge color="accent" className="mt-2">
            Ready for approval
          </Badge>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Flow</p>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {flow.map((step, i) => (
              <li key={`${step}-${i}`} className="flex items-center gap-1.5">
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
                {i < flow.length - 1 ? (
                  <span aria-hidden="true" className="text-zinc-400">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        {preview?.options && preview.options.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Options</p>
            <ul className="mt-2 space-y-2">
              {preview.options.map((option) => {
                const selected = preview.selectedOptionId === option.id
                return (
                  <li
                    key={option.id}
                    className={
                      'rounded-lg p-3 ring-1 ' +
                      (selected
                        ? 'bg-[var(--accent-soft)] ring-[var(--accent-line)]'
                        : 'ring-zinc-950/5 dark:ring-white/10')
                    }
                  >
                    <p className="text-sm font-medium text-zinc-950 dark:text-white">
                      {option.title}
                      {selected ? <span className="ml-2 text-xs text-accent-600">selected</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{option.summary}</p>
                    {option.tradeoffs.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-[10px] text-zinc-500">
                        {option.tradeoffs.map((t) => (
                          <li key={t}>• {t}</li>
                        ))}
                      </ul>
                    ) : null}
                    {!selected && onSelectOption ? (
                      <Button
                        outline
                        className="mt-2"
                        disabled={selectingOption}
                        onClick={() => onSelectOption(option.id)}
                      >
                        Select this option
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {preview ? (
          <dl className="space-y-2 text-sm">
            <PreviewRow label="Agent name" value={preview.name} />
            <PreviewRow label="Role" value={preview.role ?? preview.description} />
            <PreviewRow label="Confirmation" value={preview.confirmationPolicy} mono />
            {typeof preview.maxStepsPerRun === 'number' ? (
              <PreviewRow label="Max steps" value={String(preview.maxStepsPerRun)} mono />
            ) : null}
          </dl>
        ) : (
          <Text className="!text-xs">Ask the Builder about the repo — preview fills in as the conversation progresses.</Text>
        )}

        {tools.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tools</p>
            <ul className="mt-2 space-y-1.5">
              {tools.map((t) => (
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

        {preview?.benchmarks && preview.benchmarks.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Benchmarks</p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
              {preview.benchmarks.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {tests.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tests</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {tests.slice(0, 4).map((c, i) => (
                <li key={i} className="text-zinc-700 dark:text-zinc-300">
                  {c.name}
                </li>
              ))}
              {tests.length > 4 ? <li className="text-zinc-500">+{tests.length - 4} more</li> : null}
            </ul>
          </div>
        ) : null}

        {preview?.riskPolicy || preview?.approvalPolicy ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Policies</p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {preview.riskPolicy ? <li>Risk: {preview.riskPolicy}</li> : null}
              {preview.approvalPolicy ? <li>Approval: {preview.approvalPolicy}</li> : null}
            </ul>
          </div>
        ) : null}

        {draftReady && onCreateDraft && !createdCopilotId ? (
          <Button color="accent" onClick={onCreateDraft} disabled={creatingDraft} className="w-full">
            {creatingDraft ? 'Starting draft…' : 'Approve — create draft'}
          </Button>
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
