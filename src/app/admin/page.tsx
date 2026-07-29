import type { Metadata } from 'next'

import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export const metadata: Metadata = {
  title: 'Aigent — rebuilding',
}

/**
 * Placeholder. P006 deleted the old dashboard; the new one is not written yet.
 *
 * Deliberately built from two Catalyst atoms and nothing else: no card, no
 * surface, no KPI tile, no wrapper. Anything richer here would be the start of
 * the design system this mission exists to remove.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <Heading level={1}>Aigent</Heading>
      <Text className="mt-3">
        The previous admin interface has been removed. This screen is a placeholder while the
        console is rebuilt.
      </Text>
    </main>
  )
}
