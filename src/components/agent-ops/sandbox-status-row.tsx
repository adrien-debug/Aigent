'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/catalyst/button'
import { Badge } from '@/components/catalyst/badge'
import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import type { SandboxStatus } from '@/lib/agent-mission-control/target-repo-sandbox'

/** A trimmed view of the latest report for display (server passes only what the row needs). */
export interface SandboxRowData {
  status: SandboxStatus
  executionMode: 'dry_run' | 'execute'
  sandboxFitScore: number | null
  repo: string
  commit: string | null
  createdAt: string
}

/** Latest delivery (PR or direct commit) for the "latest delivery" line. */
export interface DeliveryRowData {
  mode: 'direct_commit' | 'pull_request'
  prNumber: number | null
  prUrl: string | null
  deliveryBranch: string | null
  createdAt: string
}

function statusColor(status: SandboxStatus): 'zinc' | 'accent' | 'accentSolid' {
  return status === 'passed' ? 'accent' : status === 'failed' ? 'accentSolid' : 'zinc'
}

/**
 * Target-repo sandbox status + run controls. The deep in-situ check runs on
 * demand (a read-only GitHub read, or a disposable clone in execute mode) —
 * never at page render. execute is a distinct, clearly-labelled action.
 */
export function SandboxStatusRow({
  copilotId,
  latest,
  delivery,
}: {
  copilotId: string
  latest: SandboxRowData | null
  delivery?: DeliveryRowData | null
}) {
  const router = useRouter()
  const [running, setRunning] = useState<'dry_run' | 'execute' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(mode: 'dry_run' | 'execute') {
    if (running) return
    setRunning(mode)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/target-sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, installMode: mode === 'execute' ? 'auto' : 'skip', persist: true }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setError(payload?.error ?? `Sandbox run failed (${res.status}).`)
        return
      }
      router.refresh()
    } catch {
      setError('Sandbox run failed — backend unreachable.')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="mt-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
      {delivery ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Latest delivery</span>
          {delivery.mode === 'pull_request' ? (
            <>
              <Badge color="accent">PR{delivery.prNumber ? ` #${delivery.prNumber}` : ''}</Badge>
              {delivery.deliveryBranch ? (
                <span className="font-mono text-zinc-500 tabular-nums dark:text-zinc-400">{delivery.deliveryBranch}</span>
              ) : null}
              {delivery.prUrl ? (
                <a
                  href={delivery.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-400"
                >
                  Open PR <span aria-hidden="true">→</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </>
          ) : (
            <Badge color="zinc">direct commit</Badge>
          )}
          <span className="text-zinc-500 dark:text-zinc-400">· {formatTimestamp(delivery.createdAt)}</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Target repo sandbox</span>
          {latest ? (
            <>
              <Badge color={statusColor(latest.status)}>{latest.status}</Badge>
              <span className="text-zinc-500 dark:text-zinc-400">
                {latest.executionMode}
                {latest.sandboxFitScore !== null ? ` · ${latest.sandboxFitScore}/100` : ''}
              </span>
              <span className="font-mono text-zinc-500 tabular-nums dark:text-zinc-400">
                {latest.repo}
                {latest.commit ? `@${latest.commit.slice(0, 7)}` : ''}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">· {formatTimestamp(latest.createdAt)}</span>
            </>
          ) : (
            <span className="font-mono text-zinc-500 dark:text-zinc-400">not run</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button outline onClick={() => run('dry_run')} disabled={running !== null}>
            {running === 'dry_run' ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-4" /> Running…
              </span>
            ) : (
              'Run dry-run'
            )}
          </Button>
          <Button color="accent" onClick={() => run('execute')} disabled={running !== null}>
            {running === 'execute' ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-4" /> Executing…
              </span>
            ) : (
              'Run execute'
            )}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Execute runs the target repo&apos;s real gate scripts in a temporary clone. Read-only — no GitHub write, no push.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-accent-700 dark:text-accent-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
