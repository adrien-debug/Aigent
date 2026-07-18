'use client'

import * as Headless from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { Link } from '@/components/catalyst/link'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Copilot } from '@/lib/agent-mission-control/types'

/** Server-side PushResult shape (`github.ts`), narrowed for the client. */
type PushResult = {
  pushed: boolean
  dryRun: boolean
  mode: 'direct_commit' | 'pull_request'
  commitUrl?: string
  branch: string
  baseBranch?: string
  prUrl?: string
  prNumber?: number
  files: string[]
  message: string
}

type DeliveryMode = 'pull_request' | 'direct_commit'

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
  const [result, setResult] = useState<PushResult | null>(null)
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('pull_request')
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
      const payload = (await res.json()) as PushResult
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

        {/* Delivery mode — pull_request is recommended; direct commit is the
            advanced path. Selectable tiles (Headless.Button — same keyboard/focus
            semantics as a native control, no raw form element). */}
        {!result ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-950 dark:text-white">Delivery mode</p>
            <div role="radiogroup" aria-label="Delivery mode" className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  { mode: 'pull_request', label: 'Pull request', tag: 'recommended', detail: 'Opens a PR on a dedicated branch. Merge stays manual — never auto-merged.' },
                  { mode: 'direct_commit', label: 'Direct commit', tag: 'advanced', detail: 'Commits straight to the default branch. No review step.' },
                ] as const
              ).map((opt) => {
                const selected = deliveryMode === opt.mode
                return (
                  <Headless.Button
                    key={opt.mode}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDeliveryMode(opt.mode)}
                    className={clsx(
                      'rounded-lg p-3 text-left ring-1 transition-colors',
                      'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500',
                      selected
                        ? 'bg-[var(--accent-surface)] ring-[var(--accent-line-strong)]'
                        : 'bg-zinc-950/2.5 ring-zinc-950/10 hover:bg-zinc-950/5 dark:bg-white/5 dark:ring-white/10 dark:hover:bg-white/10'
                    )}
                  >
                    <span className="text-sm font-medium text-zinc-950 dark:text-white">{opt.label}</span>{' '}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">({opt.tag})</span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{opt.detail}</span>
                  </Headless.Button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div aria-live="polite">
          {result ? (
            result.dryRun && !result.pushed ? (
              <div className="mt-4">
                <p className="text-sm font-medium text-zinc-950 dark:text-white">
                  Dry-run — {result.files.length} fichiers prêts. Le push réel est désactivé côté serveur
                  (GITHUB_PUSH_ENABLED).
                </p>
                <ul className="mt-2 space-y-1">
                  {result.files.map((file) => (
                    <li key={file} className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            ) : result.pushed && result.mode === 'pull_request' ? (
              <p className="mt-4 text-sm font-medium text-zinc-950 dark:text-white">
                PR{result.prNumber ? ` #${result.prNumber}` : ''} opened on{' '}
                <span className="font-mono tabular-nums">{result.branch}</span> → {result.baseBranch}. Merge stays
                manual.
                {result.prUrl ? (
                  <>
                    {' '}
                    <Link
                      href={result.prUrl}
                      target="_blank"
                      className="font-medium text-zinc-950 underline decoration-zinc-950/30 hover:decoration-zinc-950 dark:text-white dark:decoration-white/30 dark:hover:decoration-white"
                    >
                      Open PR &rarr;
                    </Link>
                  </>
                ) : null}
              </p>
            ) : result.pushed ? (
              <p className="mt-4 text-sm font-medium text-zinc-950 dark:text-white">
                Pushed to <span className="font-mono tabular-nums">{result.branch}</span>.
                {result.commitUrl ? (
                  <>
                    {' '}
                    <Link
                      href={result.commitUrl}
                      target="_blank"
                      className="font-medium text-zinc-950 underline decoration-zinc-950/30 hover:decoration-zinc-950 dark:text-white dark:decoration-white/30 dark:hover:decoration-white"
                    >
                      View commit &rarr;
                    </Link>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{result.message}</p>
            )
          ) : null}
        </div>
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
