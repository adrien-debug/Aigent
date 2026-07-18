'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'

interface GenerateSuiteButtonProps {
  copilotId: string
}

/**
 * "Generate test suite" trigger — recovery path for a copilot whose create-time
 * auto-eval failed to seed suites. POSTs to the copilot's tests/generate route
 * (real OpenAI synthesis, persisted as test_suites/test_cases/benchmark_suites),
 * then `router.refresh()` so the section re-reads and the new suite appears —
 * which in turn activates the existing "Run tests" button.
 *
 * This GENERATES the suite only; it does NOT run the tests. Monochrome accent;
 * states surface inline in accent/zinc, never a second hue, never a fake
 * success.
 */
export function GenerateSuiteButton({ copilotId }: GenerateSuiteButtonProps) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    if (generating) return

    setGenerating(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/tests/generate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      )

      if (!response.ok) {
        setError(await messageForResponse(response, `Suite generation failed (${response.status}).`))
        return
      }

      router.refresh()
    } catch {
      setError('Suite generation failed — the backend is unreachable.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <Button color="accent" onClick={handleGenerate} disabled={generating}>
        {generating ? (
          <>
            <Spinner />
            Generating…
          </>
        ) : (
          'Generate test suite'
        )}
      </Button>

      {error ? (
        <Text role="alert" className="!mt-0 max-w-xs text-center !text-xs !text-zinc-500 break-words">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
