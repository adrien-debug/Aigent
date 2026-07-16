'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'

interface RunBenchmarkButtonProps {
  copilotId: string
  suiteId: string
  /** Optional explicit version; defaults server-side to production→latest. */
  versionId?: string
}

/** Shape of the benchmark-runner endpoint's reply. */
interface RunBenchmarkResult {
  benchmarkRun?: { status: string }
}

/**
 * "Run benchmark" trigger — real V1 execution. POSTs to the copilot's
 * benchmark-runner route (runs + grades every task, persists benchmark_runs /
 * benchmark_results), then `router.refresh()` so the section re-reads the new
 * run. Monochrome accent, states inline in accent/zinc — never a second hue,
 * never a fake result.
 */
export function RunBenchmarkButton({ copilotId, suiteId, versionId }: RunBenchmarkButtonProps) {
  const router = useRouter()
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function handleRun() {
    if (isRunning) return

    setIsRunning(true)
    setError(null)
    setDone(null)

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/benchmarks/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suiteId, versionId }),
      })

      if (!response.ok) {
        setError(await messageForResponse(response, `Benchmark run failed (${response.status}).`))
        return
      }

      const data = (await response.json()) as RunBenchmarkResult
      setDone(data.benchmarkRun?.status === 'completed' ? 'Benchmark complete' : 'Run finished')
      router.refresh()
    } catch {
      setError('Benchmark run failed — the backend is unreachable.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {done ? (
          <Badge color="accent" role="status" aria-live="polite">
            {done}
          </Badge>
        ) : null}
        <Button color="accent" onClick={handleRun} disabled={isRunning}>
          {isRunning ? (
            <>
              <Spinner />
              Running…
            </>
          ) : (
            'Run benchmark'
          )}
        </Button>
      </div>
      {error ? (
        <Text role="alert" className="!mt-0 !text-xs !text-accent-400">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
