import {
  ArrowRightCircleIcon,
  CircleStackIcon,
  CpuChipIcon,
  HandRaisedIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'
import { formatDurationMs } from '@/lib/agent-mission-control/format'
import type { AgentRunStep, AgentRunStepKind, ToolCall } from '@/lib/agent-mission-control/types'

const stepIcons: Record<AgentRunStepKind, typeof CpuChipIcon> = {
  'llm-call': CpuChipIcon,
  'tool-call': WrenchIcon,
  'memory-read': CircleStackIcon,
  'memory-write': CircleStackIcon,
  'guardrail-check': ShieldCheckIcon,
  confirmation: HandRaisedIcon,
  output: ArrowRightCircleIcon,
}

const stepKindLabels: Record<AgentRunStepKind, string> = {
  'llm-call': 'LLM call',
  'tool-call': 'Tool call',
  'memory-read': 'Memory read',
  'memory-write': 'Memory write',
  'guardrail-check': 'Guardrail check',
  confirmation: 'Confirmation',
  output: 'Output',
}

const stepStatusStyles: Record<AgentRunStep['status'], { node: string; label: string | null; labelClassName: string }> =
  {
    ok: {
      node: 'bg-zinc-100 text-zinc-500 inset-ring inset-ring-zinc-950/10 dark:bg-zinc-800 dark:text-zinc-400 dark:inset-ring-white/10',
      label: null,
      labelClassName: '',
    },
    warning: {
      node: 'bg-accent-400/10 text-accent-600 inset-ring inset-ring-accent-400/30 dark:text-accent-400',
      label: 'Warning',
      labelClassName: 'text-accent-600 dark:text-accent-400',
    },
    blocked: {
      node: 'bg-accent-400/10 text-accent-600 inset-ring inset-ring-accent-400/30 dark:text-accent-400',
      label: 'Blocked',
      labelClassName: 'text-accent-600 dark:text-accent-400',
    },
    error: {
      node: 'bg-accent-400/10 text-accent-600 inset-ring inset-ring-accent-400/30 dark:text-accent-400',
      label: 'Error',
      labelClassName: 'text-accent-600 dark:text-accent-400',
    },
  }

const toolCallStatusConfig: Record<ToolCall['status'], { label: string; color: 'accent' | 'accentSolid' | 'zinc' }> = {
  ok: { label: 'OK', color: 'zinc' },
  confirmed: { label: 'Confirmed', color: 'accent' },
  error: { label: 'Error', color: 'accentSolid' },
  blocked: { label: 'Blocked', color: 'accentSolid' },
  rejected: { label: 'Rejected', color: 'accentSolid' },
}

function ToolCallSummary({ call }: { call: ToolCall }) {
  const status = toolCallStatusConfig[call.status]
  const danger = call.status === 'blocked' || call.status === 'rejected' || call.status === 'error'

  return (
    <div className="mt-2 border-l-2 border-zinc-950/10 pl-3 dark:border-white/10">
      <div className="flex min-w-0 items-center gap-2">
        <Badge color={status.color}>{status.label}</Badge>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate font-mono text-xs tabular-nums',
            danger ? 'text-accent-600 dark:text-accent-400' : 'text-zinc-500 dark:text-zinc-400'
          )}
        >
          {call.argumentsSummary} <span aria-hidden="true">&rarr;</span> {call.resultSummary}
        </span>
      </div>
      {call.requiredConfirmation ? (
        <p className="mt-1 text-xs text-zinc-500">Required human confirmation</p>
      ) : null}
    </div>
  )
}

/**
 * Vertical run timeline — one node per agent step, connector line between
 * nodes, tool-call steps expand into their ToolCall summary. Server-safe.
 */
export function RunTimeline({
  steps,
  toolCallsById,
}: {
  steps: AgentRunStep[]
  toolCallsById: Record<string, ToolCall | undefined>
}) {
  const ordered = [...steps].sort((a, b) => a.index - b.index)

  if (ordered.length === 0) {
    return <p className="text-sm text-zinc-500">No steps recorded for this run.</p>
  }

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {ordered.map((step, stepIndex) => {
          const Icon = stepIcons[step.kind]
          const statusStyle = stepStatusStyles[step.status]
          const toolCall = step.toolCallId ? toolCallsById[step.toolCallId] : undefined
          const isLast = stepIndex === ordered.length - 1

          return (
            <li key={step.id} className="relative pb-8">
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-950/10 dark:bg-white/10"
                />
              ) : null}
              <div className="relative flex gap-3">
                <div
                  className={clsx(
                    'flex size-8 shrink-0 items-center justify-center rounded-full ring-8 ring-white dark:ring-zinc-950',
                    statusStyle.node
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </div>
                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="min-w-0 truncate text-sm font-medium text-zinc-950 dark:text-white">
                      {step.title}
                      <span className="ml-2 text-xs font-normal text-zinc-500">{stepKindLabels[step.kind]}</span>
                      {statusStyle.label ? (
                        <span className={clsx('ml-2 text-xs font-medium', statusStyle.labelClassName)}>
                          {statusStyle.label}
                        </span>
                      ) : null}
                    </p>
                    <span className="shrink-0 font-mono text-xs tabular-nums whitespace-nowrap text-zinc-500">
                      {formatDurationMs(step.durationMs)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{step.detail}</p>
                  {toolCall ? <ToolCallSummary call={toolCall} /> : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
