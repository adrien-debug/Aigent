import type { Metadata } from 'next'

import { RunsView } from '@/components/aigent-v2/runs/runs-view'
import { parseRunsFilters, type RawSearchParams } from '@/lib/aigent-v2/runs-filters'
import { getRunsPageData } from '@/lib/aigent-v2/runs-page-data'

// Live-only: renders per-request against the gpu1 data layer, same reason as
// /admin (see src/app/admin/layout.tsx). Force dynamic so `next build` never
// prerenders it — the fail-closed data layer would throw without a backend.
export const dynamic = 'force-dynamic'

/**
 * NO `loading.tsx` FOR THIS SEGMENT — measured, not assumed.
 *
 * A skeleton was written and then removed. `loading.tsx` is a Suspense
 * boundary, so React flushes the HTML shell with `200 OK` before the page has
 * resolved; when `getRunsPageData` then throws, `error.tsx` paints its failure
 * UI inside an ALREADY COMMITTED 200 response. Measured on 29/07/2026 against
 * an unreachable PostgREST (`AMC_SUPABASE_URL=http://127.0.0.1:9`):
 *
 *   with    runs/loading.tsx -> GET /admin-v2/runs 200  (error UI, 200 status)
 *   without runs/loading.tsx -> GET /admin-v2/runs 500  (error UI, 500 status)
 *
 * A backend outage that answers 200 is invisible to every monitor, crawler and
 * uptime check — the opposite of the fail-closed contract this page is built
 * on. The same trap is documented for the legacy dashboard in
 * `src/app/admin/layout.tsx`. The honest status line wins over the skeleton.
 */

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  // Filters are read from the URL on the server so a shared/bookmarked link
  // renders the same view it described, without a client-side flash of the
  // unfiltered list.
  const [data, params] = await Promise.all([getRunsPageData(), searchParams])
  return <RunsView data={data} initialFilters={parseRunsFilters(params)} />
}
