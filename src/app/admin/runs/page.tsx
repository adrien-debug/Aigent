import type { Metadata } from 'next'

import { RunsView } from '@/components/runs-console/runs-view'
import { parseRunsFilters, type RawSearchParams } from '@/lib/runs-console/runs-filters'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const [data, params] = await Promise.all([getRunsPageData(), searchParams])
  return <RunsView data={data} initialFilters={parseRunsFilters(params)} />
}
