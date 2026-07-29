'use client'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/**
 * Next.js error boundary for everything under `/admin`. Next only ever hands
 * this component `error.message` from a Server Component / Route Handler
 * throw after stripping it down to a redacted `digest` in production — the
 * raw stack and the original message never cross the RSC boundary in a prod
 * build. We still don't render `error.message` here: in dev Next passes the
 * real message through, and this file has no way to tell dev from prod at
 * render time, so the sober fallback string is used unconditionally and only
 * the `digest` (safe, opaque) is ever shown.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-start justify-center gap-4 px-6 py-12">
      <Heading level={1}>Something went wrong</Heading>
      <Text>This screen failed to render. You can try again.</Text>
      {error.digest ? (
        <Text className="font-mono text-xs">Reference: {error.digest}</Text>
      ) : null}
      <Button onClick={reset} color="accent">
        Try again
      </Button>
    </div>
  )
}
