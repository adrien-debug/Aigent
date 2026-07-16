import { NextResponse } from 'next/server'

import { getLatestSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'

// Shape guard for the `:copilotId` path param. Real ids are `makeId('copilot',
// slug)` (see slug.ts): lowercase alphanumerics/hyphens, bounded length — the
// same guard as the sibling copilot routes (`[copilotId]/route.ts`, `run`,
// `promotion`). Rejecting anything else before a live DB round-trip is a fast,
// safe 400 (no valid id is ever refused).
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * GET /api/agent-ops/copilots/:copilotId/target-sandbox/latest — return the most
 * recent PERSISTED sandbox report for this copilot. NO network run: a pure DB
 * read of `sandbox_reports` (migration 0014). Returns `{ report: null }` when
 * none has been run/persisted yet.
 *
 * Auth is enforced upstream by src/proxy.ts (admin session OR x-amc-key) for all
 * /api/agent-ops. Read-only — never runs a sandbox, never writes GitHub.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (typeof copilotId !== 'string' || !COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  try {
    const report = await getLatestSandboxReport(copilotId)
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    console.error('[target-sandbox/latest] read failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed to read sandbox report' }, { status: 502 })
  }
}
