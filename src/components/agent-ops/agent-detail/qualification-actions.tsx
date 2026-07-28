'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { QualificationReadiness } from '@/lib/agent-mission-control/qualification-orchestrator'

export function QualificationActions({
  copilotId,
  candidateVersionId,
  readiness,
}: {
  copilotId: string
  candidateVersionId: string | null
  readiness: QualificationReadiness
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'sweep' | 'advance' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const canAct = candidateVersionId !== null

  async function run(action: 'sweep' | 'advance') {
    if (!candidateVersionId) return
    setPending(action)
    setError(null)
    setDone(null)
    try {
      const response = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/qualification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: candidateVersionId, action }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(body?.error ?? `Qualification ${action} failed (${response.status}).`)
        return
      }
      setDone(action === 'sweep' ? 'Qualification sweep completed.' : 'Qualification advanced one step.')
      router.refresh()
    } catch {
      setError('Qualification failed — the backend is unreachable.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/5 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button color="accent" disabled={!canAct || pending !== null} onClick={() => void run('sweep')}>
          {pending === 'sweep' ? (
            <>
              <Spinner />
              Running sweep…
            </>
          ) : (
            'Run qualification sweep'
          )}
        </Button>
        <Button
          color="zinc"
          disabled={!canAct || pending !== null || readiness.state === 'not_started'}
          onClick={() => void run('advance')}
        >
          {pending === 'advance' ? (
            <>
              <Spinner />
              Advancing…
            </>
          ) : (
            'Advance one step'
          )}
        </Button>
      </div>
      {!canAct ? (
        <Text size="xs">There is no candidate version to qualify.</Text>
      ) : (
        <Text size="xs">{readiness.nextAction}</Text>
      )}
      {done ? <Text size="xs">{done}</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}
    </div>
  )
}
