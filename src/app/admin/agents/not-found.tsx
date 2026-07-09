import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

export default function CopilotNotFound() {
  return (
    <div className="mx-auto mt-12 w-full max-w-md rounded-xl bg-white p-6 text-center ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <p className="font-mono text-xs tabular-nums text-zinc-500">Error 404</p>
      <Heading className="mt-4">Copilot not found</Heading>
      <Text className="mt-2">
        No copilot with this id exists in the registry. It may have been retired, or the link is
        stale.
      </Text>
      <div className="mt-6">
        <Button href="/admin/agents">Back to copilots</Button>
      </div>
    </div>
  )
}
