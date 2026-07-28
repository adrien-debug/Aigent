import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

/**
 * 404 boundary for the V2 slice.
 *
 * Reachable once a V2 route calls `notFound()` (a dynamic segment such as a run
 * or agent detail). A completely unrouted path under /admin-v2 resolves at the
 * ROOT boundary instead — measured, and identical to how `/admin/<unrouted>`
 * behaves today, so this is Next.js routing, not a V2 regression.
 */
export default function AdminV2NotFound() {
  return (
    <div className={`mx-auto mt-12 w-full max-w-md p-6 text-center ${surfaceRaised}`}>
      <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Error 404</p>
      <Heading className="mt-4">Not found in Aigent V2</Heading>
      <Text className="mt-2">
        This V2 route does not exist, or the record it pointed to is no longer in the registry.
      </Text>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button color="accent" href="/admin-v2/runs">
          Go to Runs
        </Button>
        <Button plain href="/admin">
          Back to V1 dashboard
        </Button>
      </div>
    </div>
  )
}
