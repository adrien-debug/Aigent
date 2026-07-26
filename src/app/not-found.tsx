import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-center ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
        {/* `dark:text-zinc-400`, not a bare `text-zinc-500`: measured by
            `check:contrast` on this exact node, zinc-500 at 12px scores 4.12:1
            against this plane (rgb(9,9,11)) for the 4.5:1 AA floor — the status
            code, the one string that tells a user WHICH failure this is, was
            the least readable glyph on the page. zinc-500 stays for light mode,
            where it measures above AA on white and zinc-400 would not. Same
            arbitration and same measured-before-changing rule as
            `dashboard-kpi-strip.tsx`. */}
        <p className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Error 404</p>
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
