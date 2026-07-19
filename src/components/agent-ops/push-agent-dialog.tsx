'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Copilot } from '@/lib/agent-mission-control/types'

import {
  GitHubDeliveryModeRadios,
  GitHubDeliveryReceipt,
  type GitHubDeliveryMode,
  type GitHubDeliveryResult,
} from '@/components/agent-ops/github-delivery-primitives'

/**
 * Confirm dialog for publishing a copilot's runtime into its project's GitHub
 * repo. This IS an external write, so it is gated behind an explicit confirm.
 * The endpoint is dry-run by default (a real push also needs GITHUB_PUSH_ENABLED
 * server-side), so three receipts are possible and each is rendered distinctly:
 *   - dryRun    → neutral info, NOT an error (files are listed, push disarmed)
 *   - pushed    → success, with a link to the commit when returned
 *   - HTTP 4xx/5xx → clean error via messageForResponse (never the raw error)
 */
export function PushAgentDialog({
  copilot,
  projectId,
  projectName,
  open,
  onClose,
}: {
  copilot: Copilot
  projectId: string
  projectName: string | null
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GitHubDeliveryResult | null>(null)
  const [deliveryMode, setDeliveryMode] = useState<GitHubDeliveryMode>('pull_request')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  // Re-opening the dialog starts a fresh attempt — clear the previous receipt.
  // (Render-time state adjustment, per React's "you might not need an effect".)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setResult(null)
      setError(null)
    }
  }

  const agentDir = `agents/${copilot.slug}/`
  const repoLabel = projectName ?? 'the project'

  async function pushToRepo() {
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/push-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copilotId: copilot.id, confirm: true, deliveryMode }),
      })
      if (!res.ok) {
        // 422 = the copilot has no promoted production version yet. The server sends
        // its own `error`, but pass a maturity-specific fallback so an empty-body 422
        // still reads clearly instead of the generic push-failure copy.
        const fallback =
          res.status === 422
            ? 'This agent needs a promoted production version before it can be pushed.'
            : 'Push failed — nothing was written to the repo.'
        setError(await messageForResponse(res, fallback))
        return
      }
      const payload = (await res.json()) as GitHubDeliveryResult
      setResult(payload)
      if (payload.pushed) {
        // A real push changes the copilot's lastPushStatus shown elsewhere.
        refreshTimerRef.current = setTimeout(() => {
          router.refresh()
        }, 400)
      }
    } catch {
      setError('Push failed — nothing was written to the repo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogTitle>Push to repo</DialogTitle>
      <DialogDescription>
        This publishes the agent&rsquo;s runtime to {repoLabel}
        {projectName ? '’s' : ''} repository. The files below are written into the project&rsquo;s
        GitHub repo.
      </DialogDescription>
      <DialogBody>
        <div className="rounded-lg bg-zinc-950/5 p-4 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
          <p className="text-sm font-medium text-zinc-950 dark:text-white">What gets pushed</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="font-mono tabular-nums text-zinc-950 dark:text-white">{agentDir}</span> — handler,
              manifest &amp; README
            </li>
            <li>
              <span className="font-mono tabular-nums text-zinc-950 dark:text-white">agents/_registry.json</span> —
              the agent registry
            </li>
          </ul>
        </div>

        {!result ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-950 dark:text-white">Delivery mode</p>
            <div className="mt-2">
              <GitHubDeliveryModeRadios value={deliveryMode} onChange={setDeliveryMode} />
            </div>
          </div>
        ) : null}

        <div aria-live="polite">{result ? <GitHubDeliveryReceipt result={result} /> : null}</div>
        <div aria-live="assertive">
          {error ? (
            <p role="alert" className="mt-4 text-sm text-accent-600 dark:text-accent-400">
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        <Button color="accent" disabled={saving || result !== null} onClick={pushToRepo}>
          {saving
            ? deliveryMode === 'pull_request'
              ? 'Creating PR…'
              : 'Pushing…'
            : deliveryMode === 'pull_request'
              ? 'Create PR'
              : 'Push to repo'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
