'use client'

import { useState } from 'react'
import { ArrowUpTrayIcon } from '@heroicons/react/16/solid'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type { AgentPushStatus } from '@/lib/agent-mission-control/types'

interface PushAgentButtonProps {
  projectId: string
  copilotId: string
  /** Whether the project has a linked GitHub repo — the push target. */
  hasRepo: boolean
  /** Last known push status for this agent, if any. */
  initialStatus?: AgentPushStatus
}

/** Shape of the push endpoint's JSON reply (dry-run for now, real push later). */
interface PushResult {
  dryRun?: boolean
  pushed?: boolean
  commitUrl?: string
}

/**
 * Client action to push an agent's code to its project's GitHub repo.
 *
 * Monochrome accent button; the label says the action. Disabled when the
 * project has no linked repo (affordance = state: disabled + a zinc hint).
 * On click it POSTs to `/api/agent-ops/projects/{projectId}/push-agent` and
 * surfaces loading / success (accent badge) / error (zinc/accent text) inline —
 * never a second hue.
 *
 * NOTE: a real push mutates the remote repo and requires consent, so for now we
 * send WITHOUT `confirm` (the server treats this as a dry-run). Once consent is
 * captured the body should carry `confirm: true` to perform the real push.
 */
export function PushAgentButton({ projectId, copilotId, hasRepo, initialStatus }: PushAgentButtonProps) {
  const [isPushing, setIsPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Seed the receipt from the last known push so a page load reflects prior state
  // (a previously-pushed agent shows the accent badge before any fresh click).
  const [result, setResult] = useState<PushResult | null>(
    initialStatus === 'pushed' ? { pushed: true } : null
  )

  async function handlePush() {
    if (isPushing || !hasRepo) return

    setIsPushing(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`/api/agent-ops/projects/${projectId}/push-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Dry-run for now — a real push will add `confirm: true` after consent.
        body: JSON.stringify({ copilotId }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Push failed (${response.status}).`)
        return
      }

      const data = (await response.json()) as PushResult
      setResult(data)
    } catch {
      setError('Push failed — the backend is unreachable.')
    } finally {
      setIsPushing(false)
    }
  }

  const resultLabel = result?.pushed ? 'Pushed' : 'Dry-run ready'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button color="accent" onClick={handlePush} disabled={isPushing || !hasRepo}>
          {isPushing ? (
            <>
              <Spinner />
              Pushing…
            </>
          ) : (
            <>
              <ArrowUpTrayIcon data-slot="icon" />
              Push to GitHub
            </>
          )}
        </Button>

        {result ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="accent">{resultLabel}</Badge>
            {result.commitUrl ? (
              <Link
                href={result.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-zinc-500 hover:text-zinc-300"
              >
                View commit
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!hasRepo ? <Text className="!mt-0 !text-xs">No linked repo</Text> : null}

      {error ? <Text className="!mt-0 !text-xs !text-accent-400">{error}</Text> : null}
    </div>
  )
}
