import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
        <p className="font-mono text-xs tabular-nums text-zinc-500">Error 404</p>
        <Heading className="mt-4">Page not found</Heading>
        <Text className="mt-2">
          This page doesn&apos;t exist, or the resource it points to is no longer in the registry.
        </Text>
        <div className="mt-6">
          <Button href="/admin">Back to dashboard</Button>
        </div>
      </div>
    </main>
  )
}
