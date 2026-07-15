'use client'

import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { consumeSSE } from '@/lib/agent-mission-control/sse-client'
import type { TestRunEvent } from '@/lib/agent-mission-control/test-runner'
import type { TestResultStatus, TestRun } from '@/lib/agent-mission-control/types'

interface RunTestsButtonProps {
  copilotId: string
  /** The suite to run. When omitted the button is disabled with a zinc hint. */
  suiteId?: string
  /** Optional explicit version; defaults server-side to production→latest. */
  versionId?: string
}

/** The SSE frames the stream route emits: the runner's own events + terminals. */
type StreamFrame = TestRunEvent | { type: 'done'; testRun: TestRun } | { type: 'error'; error?: string }

/** Live per-case row shown under the button while a run streams. */
type CaseStatus = 'running' | 'pass' | 'fail' | 'error'
interface LiveCase {
  caseId: string
  name: string
  status: CaseStatus
}

/**
 * The `case-completed` event carries a full TestResultStatus; collapse the two
 * non-terminal values (`skip`/`running`) — which shouldn't appear as a case's
 * final verdict — onto `error` so the row never gets stuck on a spinner.
 */
function toCaseStatus(status: TestResultStatus): CaseStatus {
  return status === 'pass' || status === 'fail' || status === 'error' ? status : 'error'
}

/**
 * Result semantics carried by the LABEL + accent-intensity — never a green/red
 * hue (doctrine: one chromatic teinte, accent). Mirrors `test-case-table.tsx`:
 * pass = soft accent, fail = solid accent, error = mid accent, running = zinc.
 */
const caseIconClass: Record<CaseStatus, string> = {
  pass: 'text-accent-400',
  fail: 'text-accent-600',
  error: 'text-accent-500',
  running: 'text-zinc-400 animate-spin',
}

function CaseIcon({ status }: { status: CaseStatus }) {
  const className = clsx('size-4 shrink-0', caseIconClass[status])
  switch (status) {
    case 'pass':
      return <CheckCircleIcon aria-hidden="true" className={className} />
    case 'fail':
      return <XCircleIcon aria-hidden="true" className={className} />
    case 'error':
      return <ExclamationTriangleIcon aria-hidden="true" className={className} />
    case 'running':
    default:
      return <ArrowPathIcon aria-hidden="true" className={className} />
  }
}

/**
 * "Run tests" trigger — real execution, streamed. POSTs to the copilot's
 * test-runner STREAM route (SSE), which runs the real graph + judge per case and
 * persists test_runs/test_results. Each case flips a live row under the button
 * (spinner → check/cross/triangle) as its event arrives, then `router.refresh()`
 * on the terminal frame re-reads the persisted run. Monochrome accent; the fail
 * indicator is accent-600 (never a second hue), never a fabricated success.
 */
export function RunTestsButton({ copilotId, suiteId, versionId }: RunTestsButtonProps) {
  const router = useRouter()
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: string; passRate: number } | null>(null)
  const [caseEvents, setCaseEvents] = useState<LiveCase[]>([])

  function onFrame(frame: StreamFrame) {
    switch (frame.type) {
      case 'run-started':
        setCaseEvents([])
        break
      case 'case-started':
        setCaseEvents((prev) => {
          if (prev.some((c) => c.caseId === frame.caseId)) return prev
          return [...prev, { caseId: frame.caseId, name: frame.name, status: 'running' }]
        })
        break
      case 'case-completed': {
        const next = toCaseStatus(frame.status)
        setCaseEvents((prev) => prev.map((c) => (c.caseId === frame.caseId ? { ...c, status: next } : c)))
        break
      }
      case 'run-finished':
        setResult({ status: frame.status, passRate: frame.passRate })
        break
      case 'done':
        setResult({ status: frame.testRun.status, passRate: frame.testRun.passRate })
        break
      case 'error':
        setError('Test run failed — a case aborted the run.')
        break
    }
  }

  async function handleRun() {
    if (isRunning || !suiteId) return

    setIsRunning(true)
    setError(null)
    setResult(null)
    setCaseEvents([])

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/tests/run/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ suiteId, versionId }),
      })

      if (!response.ok || !response.body) {
        setError(`Test run failed (${response.status}).`)
        return
      }

      await consumeSSE<StreamFrame>(response.body, onFrame)
      // The persisted run tables re-read once the stream closes.
      router.refresh()
    } catch {
      setError('Test run failed — the backend is unreachable.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          color="accent"
          onClick={handleRun}
          disabled={isRunning || !suiteId}
          title={suiteId ? undefined : 'No suite to run'}
        >
          {isRunning ? (
            <>
              <Spinner />
              Running…
            </>
          ) : (
            'Run tests'
          )}
        </Button>

        {result ? (
          <Badge color="accent">
            {result.status === 'completed'
              ? `${Math.round(result.passRate * 100)}% passed`
              : 'Run aborted'}
          </Badge>
        ) : null}
      </div>

      {caseEvents.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {caseEvents.map((c) => (
            <li key={c.caseId} className="flex items-center gap-2">
              <CaseIcon status={c.status} />
              <span className="truncate text-xs text-zinc-300" title={c.name}>
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <Text className="!mt-0 !text-xs !text-accent-400">{error}</Text> : null}
    </div>
  )
}
