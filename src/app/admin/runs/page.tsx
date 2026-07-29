import type { Metadata } from 'next'

import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

/**
 * Placeholder. The run console is not rebuilt yet.
 *
 * The route is kept alive because it is a real destination, but it reads NO
 * data: the loader stays in `src/lib/runs-console/` (business logic, untouched
 * by this demolition) and will be wired back when the screen is rebuilt.
 */
export default function RunsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <Heading level={1}>Runs</Heading>
      <Text className="mt-3">
        The run console has been removed and is being rebuilt. No run data is read on this screen
        for now.
      </Text>
    </main>
  )
}
