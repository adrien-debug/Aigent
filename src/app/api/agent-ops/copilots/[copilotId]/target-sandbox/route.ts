import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
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
 * Body (optional): { persist?: boolean; mode?: 'dry_run'|'execute';
 * installMode?: 'skip'|'auto'; keepSandbox?: boolean }. When `persist` is true
 * the report is also persisted (sandbox_reports table).
 *
 * Auth is enforced upstream by src/proxy.ts (admin session OR x-amc-key) for all
 * /api/agent-ops. Needs GITHUB_TOKEN to read the target repo; 503 without it.
 */

/**
 * Shape guard for `:copilotId` path params — same contract as the sibling
 * routes (`../route.ts`, `../run/route.ts`): real ids are `makeId('copilot',
 * slug)`, lowercase alphanumerics/hyphens, bounded length. Garbage is rejected
 * with a fast 400 before any DB/GitHub round-trip (no valid id is ever refused).
 */
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (typeof copilotId !== 'string' || !COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
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
  // An ABSENT/EMPTY body keeps the safe defaults (documented optional-body
  // contract); a PRESENT-but-invalid body/field is a 400, never a silent
  // coercion — a typoed `mode: "excute"` must not silently downgrade an
  // intended execute run to dry_run (mirrors ../run/route.ts's field checks).
  let persist = false
  let mode: 'dry_run' | 'execute' = 'dry_run'
  let installMode: 'skip' | 'auto' = 'skip'
  let keepSandbox = false
  const rawBody = await request.text().catch(() => '')
  if (rawBody.trim().length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
    }
    const body = parsed as { persist?: unknown; mode?: unknown; installMode?: unknown; keepSandbox?: unknown }
    if (body.persist !== undefined && typeof body.persist !== 'boolean') {
      return NextResponse.json({ error: 'persist must be a boolean' }, { status: 400 })
    }
    if (body.mode !== undefined && body.mode !== 'dry_run' && body.mode !== 'execute') {
      return NextResponse.json({ error: "mode must be 'dry_run' or 'execute'" }, { status: 400 })
    }
    if (body.installMode !== undefined && body.installMode !== 'skip' && body.installMode !== 'auto') {
      return NextResponse.json({ error: "installMode must be 'skip' or 'auto'" }, { status: 400 })
    }
    if (body.keepSandbox !== undefined && typeof body.keepSandbox !== 'boolean') {
      return NextResponse.json({ error: 'keepSandbox must be a boolean' }, { status: 400 })
    }
    persist = body.persist === true
    mode = body.mode === 'execute' ? 'execute' : 'dry_run'
    installMode = body.installMode === 'auto' ? 'auto' : 'skip'
    keepSandbox = body.keepSandbox === true
  }

  // Deterministic stamps generated at the route boundary — the sandbox modules
  // stay pure of Date.now()/randomUUID so they're trivially testable.
  const runId = `sandbox_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const createdAt = new Date().toISOString()

  try {
    const collected = await collectTargetRepoSandbox(copilotId, { runId, createdAt, mode, installMode, keepSandbox })
    if (!collected) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    // The collector already resolved the copilot — reuse its projectId instead
    // of a second getCopilot round-trip. Destructured OFF the report so the
    // HTTP response body and the persisted jsonb keep their exact prior shape.
    const { projectId, ...report } = collected

    if (persist) {
      try {
        await persistSandboxReport(report, projectId)
      } catch (err) {
        // Persistence is best-effort — a DB hiccup must not fail the eval; the
        // report is still returned in the response.
        console.error('[target-sandbox] report persistence failed', err instanceof Error ? err.message : err)
      }
    }

    return NextResponse.json({ ok: true, report })
  } catch (err) {
    console.error('[target-sandbox] evaluation failed', err instanceof Error ? err.message : err)
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'sandbox evaluation failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
