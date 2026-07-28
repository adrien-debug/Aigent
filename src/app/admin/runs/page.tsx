import type { Metadata } from 'next'

import { RunsView } from '@/components/runs-console/runs-view'
import { parseRunsFilters, type RawSearchParams } from '@/lib/runs-console/runs-filters'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

/**
 * The fleet-wide run console. Before P004 there was no such page: runs were
 * reachable only inside one agent (`/admin/agents/[id]/runs`) or as a capped
 * feed on `/admin/performance`.
 *
 * NO `loading.tsx` for this segment, deliberately. It is a Suspense boundary,
 * so React flushes a `200 OK` shell before the page resolves; when
 * `getRunsPageData` then throws, the error UI paints inside an already
 * committed 200. Measured against an unreachable PostgREST: with the skeleton
 * the route answered 200, without it 500. A backend outage that answers 200 is
 * invisible to every monitor — the honest status line wins over the skeleton.
 */
export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  // Filters are read from the URL on the server so a shared link renders the
  // view it describes, with no client-side flash of the unfiltered list.
  const [data, params] = await Promise.all([getRunsPageData(), searchParams])
  return <RunsView data={data} initialFilters={parseRunsFilters(params)} />
}
