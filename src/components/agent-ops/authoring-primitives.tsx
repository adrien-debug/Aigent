'use client'

import { formatUsd } from '@/lib/agent-mission-control/format'
import type { GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'

/**
 * Shared authoring-surface primitives — pulled out of `architect-chat.tsx`,
 * `create-agent-form.tsx`, and `run-copilot-panel.tsx` to kill copy-pasted
 * JSX. Pure presentation, accent+zinc only.
 */

const MANIFEST_PREVIEW_LENGTH = 220

/** Truncate `text` to `len` characters, appending an ellipsis when cut. */
function truncate(text: string, len: number): string {
  return text.length > len ? `${text.slice(0, len)}…` : text
}

/** Inline error banner — the exact shape used across the authoring surface. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-lg bg-accent-500/10 px-4 py-3 text-sm text-accent-700 dark:text-accent-400"
    >
      {message}
    </div>
  )
}

/** Small animated spinner. Size is overridable via `className` (default `size-4`). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'size-4 animate-spin'} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

interface ManifestRecapProps {
  manifest: GeneratedManifest
  showLimits?: boolean
}

/**
 * Shared manifest recap (plain block, no card chrome): header, truncated
 * system-prompt preview, and a small stat row (routes / tools / confirmation
 * policy — plus max steps and max cost per run when `showLimits` is set).
 * Distinct from `ManifestSummaryCard` (manifest-summary-card.tsx), which is
 * a full standalone card.
 */
export function ManifestRecap({ manifest, showLimits }: ManifestRecapProps) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
        Manifest summary
      </p>

      <p className="mt-2 text-sm break-words text-zinc-700 dark:text-zinc-300">
        {truncate(manifest.systemPromptSummary, MANIFEST_PREVIEW_LENGTH)}
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Allowed routes</dt>
          <dd className="ml-2 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
            {manifest.allowedRoutes.length}
          </dd>
        </div>
        <div>
          <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Proposed tools</dt>
          <dd className="ml-2 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
            {manifest.proposedTools.length}
          </dd>
        </div>
        <div>
          <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Confirmation</dt>
          <dd className="ml-2 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
            {manifest.confirmationPolicy}
          </dd>
        </div>
        {showLimits ? (
          <>
            <div>
              <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Max steps/run</dt>
              <dd className="ml-2 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
                {manifest.maxStepsPerRun}
              </dd>
            </div>
            <div>
              <dt className="inline text-xs font-medium tracking-wide text-zinc-500 uppercase">Max cost/run</dt>
              <dd className="ml-2 inline font-mono text-sm tabular-nums text-zinc-950 dark:text-white">
                {formatUsd(manifest.maxCostPerRunUsd)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </div>
  )
}
