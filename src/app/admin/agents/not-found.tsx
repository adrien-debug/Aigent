import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

export default function CopilotNotFound() {
  return (
    <div className={`mx-auto mt-12 w-full max-w-md p-6 text-center ${surfaceRaised}`}>
      {/* `dark:text-zinc-400` — measured 3.59:1 by `check:contrast` on this node
          (12px zinc-500 over the raised plane rgb(26,26,30)) for a 4.5:1 AA
          floor. Raised surface, so it scores even lower than the root 404 page;
          zinc-500 is kept for light mode where it clears AA on white. Same rule
          as `dashboard-kpi-strip.tsx`: change the ramp only where the gate
          measured a miss. */}
      <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Error 404</p>
      <Heading className="mt-4">Copilot not found</Heading>
      <Text className="mt-2">
        No copilot with this id exists in the registry. It may have been retired, or the link is
        stale.
      </Text>
      <div className="mt-6">
        <Button href="/admin">Back to dashboard</Button>
      </div>
    </div>
  )
}
