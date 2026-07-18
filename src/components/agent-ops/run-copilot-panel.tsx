'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, ToolRiskLevel } from '@/lib/agent-mission-control/types'

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']

/** Narrow the interrupt payload's free-form risk string to a known level (else undefined). */
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

interface RunCopilotPanelProps {
  copilotId: string
  copilotName: string
  copilotSlug?: string
  copilotTags?: string[]
}

type RunResult = Pick<AgentRun, 'status' | 'outputSummary' | 'latencyMs' | 'costUsd'> & {
  /** Present once the run is persisted — the id the resume route needs. */
  runId?: string
  /** True when the LangGraph run paused for human approval before a tool. */
  interrupted?: boolean
  /** The approval question shown in the human-in-the-loop block. */
  interruptMessage?: string | null
  /** The tool awaiting approval — name + proposed args, so the operator isn't blind. */
  pendingTool?: { name: string; argumentsSummary: string; risk?: string } | null
}

/**
 * Small "run this copilot" panel — a task input + primary action that fires a
 * REAL OpenAI-backed run via the live backend, then shows the result inline.
 * On success the run also lands in the Runs tab (server-persisted); this panel
 * just surfaces the immediate receipt and nudges the rest of the page to catch up.
 */
export function RunCopilotPanel({ copilotId, copilotName, copilotSlug = '', copilotTags = [] }: RunCopilotPanelProps) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)

  async function handleRun() {
    if (isRunning || input.trim().length === 0) return

    setIsRunning(true)
    setError(null)
    setResumeError(null)
    setResult(null)

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: input }),
      })

      if (response.status === 503) {
        setError('Live backend not configured.')
        return
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? `Run failed (${response.status}).`)
        return
      }

      const data = (await response.json()) as RunResult
      setResult(data)
      router.refresh()
    } catch {
      setError('Live backend not configured.')
    } finally {
      setIsRunning(false)
    }
  }

  async function handleResume(approved: boolean) {
    if (resuming || !result?.runId) return

    setResuming(true)
    setResumeError(null)

    try {
      const response = await fetch(
        `/api/agent-ops/copilots/${copilotId}/runs/${result.runId}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        }
      )

      if (response.status === 503) {
        setResumeError('Live backend not configured.')
        return
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setResumeError(body?.error ?? `Resume failed (${response.status}).`)
        return
      }

      const data = (await response.json()) as {
        status: RunResult['status']
        outputSummary: string
        interrupted?: boolean
        interruptMessage?: string | null
        pendingTool?: RunResult['pendingTool']
      }
      // Fold the resume outcome back into the run receipt. A re-interrupted
      // run (approval led straight into another tool call) reports
      // interrupted:true here — propagate it so the approval block
      // re-renders instead of silently going quiet on a needs-confirmation run.
      setResult((prev) =>
        prev
          ? {
              ...prev,
              status: data.status,
              outputSummary: data.outputSummary,
              interrupted: data.interrupted ?? false,
              interruptMessage: data.interruptMessage,
              pendingTool: data.pendingTool,
            }
          : prev
      )
      router.refresh()
    } catch {
      setResumeError('Live backend not configured.')
    } finally {
      setResuming(false)
    }
  }

  return (
    <AgentSectionCard
      title={
        <div className="flex items-center gap-3">
          <CopilotAvatar copilot={{ name: copilotName, slug: copilotSlug, tags: copilotTags }} className="size-8 rounded-xl" />
          <span>Run {copilotName}</span>
        </div>
      }
      description="Send a task to this copilot and get a real, OpenAI-backed run back."
    >
      <Field>
        <Label>Task input</Label>
        <Textarea
          name="run-input"
          rows={4}
          placeholder="Describe the task for this copilot to run…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isRunning}
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button color="accent" onClick={handleRun} disabled={isRunning || input.trim().length === 0}>
          {isRunning ? (
            <>
              <Spinner />
              Running…
            </>
          ) : (
            'Run copilot'
          )}
        </Button>
        {isRunning ? <Text className="!mt-0">Waiting on a live model call…</Text> : null}
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {result ? (
        <div className="mt-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Result</p>
            <RunStatusText status={result.status} />
          </div>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{result.outputSummary}</p>

          {result.status === 'needs-confirmation' || result.interrupted ? (
            // Human-in-the-loop: the LangGraph run paused before a tool and is
            // waiting on an operator decision — surfaced automatically, no reveal.
            <div
              role="alert"
              className="mt-4 rounded-lg bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--accent-line)]"
            >
              <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                Human approval required
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {result.interruptMessage ??
                  'This run paused for human approval before running a tool.'}
              </p>
              {result.pendingTool ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <ToolBadge
                    name={result.pendingTool.name}
                    risk={asToolRisk(result.pendingTool.risk)}
                  />
                  <code className="line-clamp-2 max-w-full rounded-md bg-zinc-950/5 px-1.5 py-0.5 font-mono text-xs break-words text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                    {result.pendingTool.argumentsSummary}
                  </code>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button color="accent" onClick={() => handleResume(true)} disabled={resuming}>
                  {resuming ? (
                    <>
                      <Spinner />
                      Resuming…
                    </>
                  ) : (
                    'Approve'
                  )}
                </Button>
                <Button plain onClick={() => handleResume(false)} disabled={resuming}>
                  {resuming ? (
                    <>
                      <Spinner />
                      Resuming…
                    </>
                  ) : (
                    'Reject'
                  )}
                </Button>
              </div>
              {resumeError ? <ErrorBanner message={resumeError} /> : null}
            </div>
          ) : (
            <>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Latency</dt>
                  <dd className="ml-1.5 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
                    {formatDurationMs(result.latencyMs)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Cost</dt>
                  <dd className="ml-1.5 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
                    {formatUsd(result.costUsd)}
                  </dd>
                </div>
              </dl>
              <Text className="mt-3 !text-xs">This run now appears in the Runs tab.</Text>
            </>
          )}
        </div>
      ) : null}
    </AgentSectionCard>
  )
}
