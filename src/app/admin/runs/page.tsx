import type { Metadata } from 'next'

import { RunsScreen } from '@/components/console/runs-screen'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

export default async function RunsPage() {
  const data = await getRunsPageData()
  return <RunsScreen data={data} />
}
