'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { useEffect, useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

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
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/25">
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
