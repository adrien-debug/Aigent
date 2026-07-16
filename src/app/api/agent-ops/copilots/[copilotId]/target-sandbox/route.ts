import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getCopilot } from '@/lib/agent-mission-control/data'
import { persistSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'
import { collectTargetRepoSandbox } from '@/lib/agent-mission-control/target-repo-sandbox-server'

/**
 * POST /api/agent-ops/copilots/:copilotId/target-sandbox — evaluate whether the
 * agent DELIVERED into its project's GitHub repo actually fits there: reads the
 * pushed `agents/<slug>/…` artifacts + the target repo's package.json scripts
 * (read-only, GitHub Contents API — no clone, no write, no push) and returns a
 * `TargetRepoSandboxReport` JSON.
 *
 * READ-ONLY / DRY-RUN by default: it never modifies the target repo, never
 * commits, never pushes. Repo gate scripts are DETECTED (reported skipped/
 * dry_run), not executed, unless a future disposable-clone runner opts in.
 *
 * Body (optional): { persist?: boolean }. When `persist` is true the report is
 * also written to `.aigent/reports/<runId>.json` (gitignored, disposable).
 *
 * Auth is enforced upstream by src/proxy.ts (admin session OR x-amc-key) for all
 * /api/agent-ops. Needs GITHUB_TOKEN to read the target repo; 503 without it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (typeof copilotId !== 'string' || copilotId.trim().length === 0) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
  }

  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured (GITHUB_TOKEN missing)' }, { status: 503 })
  }

  // Body: mode is `dry_run` unless EXPLICITLY `execute` — execution is never the
  // default. installMode defaults to `skip`. keepSandbox is debug-only.
  let persist = false
  let mode: 'dry_run' | 'execute' = 'dry_run'
  let installMode: 'skip' | 'auto' = 'skip'
  let keepSandbox = false
  try {
    const body = (await request.json().catch(() => null)) as
      | { persist?: unknown; mode?: unknown; installMode?: unknown; keepSandbox?: unknown }
      | null
    persist = body?.persist === true
    mode = body?.mode === 'execute' ? 'execute' : 'dry_run'
    installMode = body?.installMode === 'auto' ? 'auto' : 'skip'
    keepSandbox = body?.keepSandbox === true
  } catch {
    // keep the safe defaults
  }

  // Deterministic stamps generated at the route boundary — the sandbox modules
  // stay pure of Date.now()/randomUUID so they're trivially testable.
  const runId = `sandbox_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const createdAt = new Date().toISOString()

  try {
    const report = await collectTargetRepoSandbox(copilotId, { runId, createdAt, mode, installMode, keepSandbox })
    if (!report) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }

    if (persist) {
      try {
        const copilot = await getCopilot(copilotId)
        await persistSandboxReport(report, copilot?.projectId ?? null)
      } catch (err) {
        // Persistence is best-effort — a DB hiccup must not fail the eval; the
        // report is still returned in the response.
        console.error('[target-sandbox] report persistence failed', err instanceof Error ? err.message : err)
      }
    }

    return NextResponse.json({ ok: true, report })
  } catch (err) {
    console.error('[target-sandbox] evaluation failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'sandbox evaluation failed' }, { status: 502 })
  }
}
