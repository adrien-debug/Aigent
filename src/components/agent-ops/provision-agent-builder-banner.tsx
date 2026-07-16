'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/catalyst/button'

/**
 * One-click provisioning of the Agent Builder Copilot, shown on /admin/agents
 * ONLY when it isn't in the registry yet. The point: the Agent Builder must
 * never depend on someone remembering to run a script — an operator provisions
 * it from the UI. Idempotent server-side; on success the page refreshes and the
 * copilot appears in the registry with a Builder tab.
 */
export function ProvisionAgentBuilderBanner() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleProvision() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/agent-ops/copilots/provision-agent-builder', { method: 'POST' })
      if (res.status === 503) {
        setError('Live backend not configured.')
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Provisioning failed (${res.status}).`)
        return
      }
      router.refresh()
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-zinc-950 p-6 ring-1 ring-white/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-accent-300 uppercase">Agent Builder Copilot</p>
          <p className="mt-2 max-w-prose text-sm text-zinc-300">
            The meta copilot that drafts new copilots — with human approval — isn&apos;t provisioned yet. Add it to the
            registry to open its Builder workbench.
          </p>
        </div>
        <Button color="accent" onClick={handleProvision} disabled={busy}>
          {busy ? (
            <>
              <Spinner />
              Provisioning…
            </>
          ) : (
            'Provision Agent Builder'
          )}
        </Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
    </div>
  )
}
