'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/ui/button'
import { Field, Fieldset, Label } from '@/components/ui/fieldset'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Text } from '@/components/ui/text'

/**
 * Minimal entry point for the Tool Builder — starts a local-deterministic
 * mission through the API. Only tools with a sandbox implementation can reach
 * CERTIFIED today (count_words is the reference).
 */
export function ToolBuildStartForm() {
  const router = useRouter()
  const [id, setId] = useState('count_words')
  const [label, setLabel] = useState('Count words')
  const [summary, setSummary] = useState('Count words, characters and the longest token in a text.')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/agent-ops/tool-build-missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: {
            id: id.trim(),
            version: '1.0.0',
            label: label.trim(),
            summary: summary.trim(),
            kind: 'local-deterministic',
            mutates: false,
            risk: 'low',
            requiresConfirmation: false,
            secretRefs: [],
          },
        }),
      })
      const body = (await response.json().catch(() => null)) as {
        error?: string
        mission?: { state: string; rejectionReason?: string | null }
      } | null
      if (!response.ok) {
        setError(body?.error ?? `Build failed (${response.status}).`)
        return
      }
      const state = body?.mission?.state ?? 'unknown'
      const reason = body?.mission?.rejectionReason
      setResult(reason ? `Mission ended ${state}: ${reason}` : `Mission reached ${state}.`)
      router.refresh()
    } catch {
      setError('Build failed — the backend is unreachable.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 px-6 py-4">
      <Text size="sm">
        Starts a local-deterministic build (DRAFT → TESTING → CERTIFIED when sandbox proof exists).
        Only <span className="font-mono">count_words</span> has a sandbox today.
      </Text>
      <Fieldset>
        <Field>
          <Label>Tool id (snake_case)</Label>
          <Input value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field>
          <Label>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field>
          <Label>Summary</Label>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
        </Field>
      </Fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" color="accent" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              Starting build…
            </>
          ) : (
            'Start tool build'
          )}
        </Button>
      </div>
      {result ? <Text size="xs">{result}</Text> : null}
      {error ? <ErrorBanner message={error} /> : null}
    </form>
  )
}
