import { NextResponse } from 'next/server'

import { getLatestSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'

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
  if (typeof copilotId !== 'string' || copilotId.trim().length === 0) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
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
