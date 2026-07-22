import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { surfaceRaised } from '@/components/catalyst/surface'
import { Text } from '@/components/catalyst/text'

export default function CopilotNotFound() {
  return (
    <div className={`mx-auto mt-12 w-full max-w-md p-6 text-center ${surfaceRaised}`}>
      <p className="font-mono text-xs tabular-nums text-zinc-500">Error 404</p>
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
