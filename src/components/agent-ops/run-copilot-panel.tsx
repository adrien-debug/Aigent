'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun } from '@/lib/agent-mission-control/types'

interface RunCopilotPanelProps {
  copilotId: string
  copilotName: string
}

type RunResult = Pick<AgentRun, 'status' | 'outputSummary' | 'latencyMs' | 'costUsd'>

/**
 * Small "run this copilot" panel — a task input + primary action that fires a
 * REAL OpenAI-backed run via the live backend, then shows the result inline.
 * On success the run also lands in the Runs tab (server-persisted); this panel
 * just surfaces the immediate receipt and nudges the rest of the page to catch up.
 */
export function RunCopilotPanel({ copilotId, copilotName }: RunCopilotPanelProps) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)

  async function handleRun() {
    if (isRunning || input.trim().length === 0) return

    setIsRunning(true)
    setError(null)
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

  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 bg-zinc-950/[0.025] px-6 py-4 dark:border-white/5 dark:bg-white/[0.04]">
        <Subheading>Run {copilotName}</Subheading>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Send a task to this copilot and get a real, OpenAI-backed run back.
        </p>
      </div>

      <div className="px-6 py-5">
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

        <div className="mt-4 flex items-center gap-3">
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
          </div>
        ) : null}
      </div>
    </section>
  )
}
