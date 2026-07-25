'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'

import { surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/ui/link'

/** Client-safe mirror of `PushResult` from github.ts (server-only). */
export type GitHubDeliveryResult = {
  pushed: boolean
  dryRun: boolean
  mode: 'direct_commit' | 'pull_request'
  branch: string
  baseBranch?: string
  prUrl?: string
  prNumber?: number
  commitUrl?: string
  files: string[]
  message: string
}

export type GitHubDeliveryMode = 'pull_request' | 'direct_commit'

const DELIVERY_OPTIONS: {
  mode: GitHubDeliveryMode
  label: string
  tag: string
  detail: string
}[] = [
  {
    mode: 'pull_request',
    label: 'Pull request',
    tag: 'recommended',
    detail: 'Opens a PR on a dedicated branch. Merge stays manual — never auto-merged.',
  },
  {
    mode: 'direct_commit',
    label: 'Direct commit',
    tag: 'advanced',
    detail: 'Commits straight to the default branch. No review step.',
  },
]

/** Compact delivery-mode toggle for inline cards (plain text buttons). */
export function GitHubDeliveryModeToggle({
  value,
  onChange,
}: {
  value: GitHubDeliveryMode
  onChange: (mode: GitHubDeliveryMode) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {DELIVERY_OPTIONS.map((opt) => (
        <Headless.Button
          key={opt.mode}
          type="button"
          onClick={() => onChange(opt.mode)}
          className={clsx(
            'rounded-lg px-2 py-1 text-xs transition-colors',
            value === opt.mode ? 'text-accent-400' : 'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {opt.label}
          {opt.mode === 'pull_request' ? ' (default)' : ''}
        </Headless.Button>
      ))}
    </div>
  )
}

export function GitHubDeliveryReceipt({ result }: { result: GitHubDeliveryResult }) {
  if (result.dryRun && !result.pushed) {
    return (
      <div className={clsx(surfaceInsetClass, 'px-4 py-3 text-sm text-zinc-300')}>
        <p>
          Dry-run — {result.files.length} file{result.files.length === 1 ? '' : 's'} ready. Real writes
          require <span className="font-mono">GITHUB_PUSH_ENABLED=1</span>.
        </p>
        {result.files.length > 0 ? (
          <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-xs text-zinc-500">
            {result.files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-zinc-500">{result.message}</p>
      </div>
    )
  }

  if (result.pushed && result.mode === 'pull_request') {
    return (
      <div className={clsx(surfaceInsetClass, 'px-4 py-3 text-sm text-zinc-300')}>
        <p>
          PR{result.prNumber ? ` #${result.prNumber}` : ''} on{' '}
          <span className="font-mono">{result.branch}</span>
          {result.baseBranch ? ` → ${result.baseBranch}` : ''}. Merge manually.
        </p>
        {result.prUrl ? (
          <Link href={result.prUrl} target="_blank" className="mt-2 inline-block text-accent-400 hover:underline">
            Open PR →
          </Link>
        ) : null}
      </div>
    )
  }

  if (result.pushed) {
    return (
      <div className={clsx(surfaceInsetClass, 'px-4 py-3 text-sm text-zinc-300')}>
        <p>
          Pushed to <span className="font-mono">{result.branch}</span>.
        </p>
        {result.commitUrl ? (
          <Link href={result.commitUrl} target="_blank" className="mt-2 inline-block text-accent-400 hover:underline">
            View commit →
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div className={clsx(surfaceInsetClass, 'px-4 py-3 text-sm text-zinc-300')}>
      <p>{result.message}</p>
    </div>
  )
}
