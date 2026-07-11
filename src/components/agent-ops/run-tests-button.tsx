'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'

interface RunTestsButtonProps {
  copilotId: string
  /** The suite to run. When omitted the button is disabled with a zinc hint. */
  suiteId?: string
  /** Optional explicit version; defaults server-side to production→latest. */
  versionId?: string
}

/** Shape of the test-runner endpoint's reply. */
interface RunTestsResult {
  testRun?: { status: string; passRate: number }
}

/**
 * "Run tests" trigger — real execution. POSTs to the copilot's test-runner
 * route (real OpenAI + judge per case, persisted as test_runs/test_results),
 * then `router.refresh()` so the section re-reads the new run. Monochrome
 * accent; the label says the action, states surface inline in accent/zinc —
 * never a second hue, never a fake success.
 */
export function RunTestsButton({ copilotId, suiteId, versionId }: RunTestsButtonProps) {
  const router = useRouter()
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunTestsResult['testRun'] | null>(null)

  async function handleRun() {
    if (isRunning || !suiteId) return

    setIsRunning(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suiteId, versionId }),
      })

      if (!response.ok) {
        setError(await messageForResponse(response, `Test run failed (${response.status}).`))
        return
      }

      const data = (await response.json()) as RunTestsResult
      setResult(data.testRun ?? null)
      router.refresh()
    } catch {
      setError('Test run failed — the backend is unreachable.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
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

      {error ? <Text className="!mt-0 !text-xs !text-accent-400">{error}</Text> : null}
    </div>
  )
}
