'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * Route error boundary for /admin-v2.
 *
 * The runs read is load-bearing (see `getRunsPageData`): when it throws, this
 * renders instead of the cockpit. That is the fail-closed contract — a data
 * source that did not answer must be VISIBLE, never flattened into an empty
 * table that reads as "the fleet ran nothing".
 *
 * The failure wears the danger role, the retry stays accent: retrying is the
 * constructive action, not the failure (`check:danger`).
 */
export default function AdminV2Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    console.error('[admin-v2] route error:', error)
  }, [error])

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--state-danger-soft)] text-[var(--state-danger-text)] ring-1 ring-[var(--state-danger-line)]">
        <ExclamationTriangleIcon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="mt-5">Runs could not be loaded</Heading>
      <Text className="mt-2 max-w-md">
        The Aigent data source did not answer, so this page is showing nothing rather than an empty
        fleet. No run has been hidden — the read itself failed.
      </Text>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-zinc-400">ref: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <Button
          color="accent"
          onClick={() => {
            if (retrying) return
            setRetrying(true)
            reset()
          }}
          disabled={retrying}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
        <Button plain href="/admin">
          Back to V1 dashboard
        </Button>
      </div>
    </div>
  )
}
