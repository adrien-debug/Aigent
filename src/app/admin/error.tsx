'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * Route error boundary for /admin. The data layer (PostgREST on gpu1) can
 * throw; instead of a blank screen the operator gets a monochrome panel and a
 * retry that re-runs the server render.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    console.error('[admin] route error:', error)
  }, [error])

  function handleRetry() {
    if (retrying) return
    setRetrying(true)
    reset()
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center"
    >
      {/* The boundary that says "the data source didn't respond" was painted in
          the accent — the same green as a healthy agent and as the Retry button
          below it. Danger tokens instead: this IS a failure. The Retry stays
          accent, because retrying is the constructive action, not the failure. */}
      <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--state-danger-soft)] text-[var(--state-danger-text)] ring-1 ring-[var(--state-danger-line)]">
        <ExclamationTriangleIcon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="mt-5">Something went wrong</Heading>
      <Text className="mt-1 max-w-sm">
        The data source didn&apos;t respond. This is usually transient — retry in a moment.
      </Text>
      {error.digest ? <p className="mt-2 font-mono text-xs text-zinc-600">ref: {error.digest}</p> : null}
      <Button color="accent" className="mt-6" onClick={handleRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  )
}
