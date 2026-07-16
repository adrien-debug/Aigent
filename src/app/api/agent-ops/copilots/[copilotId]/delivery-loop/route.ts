import { NextResponse } from 'next/server'

import { newLoopRunId, runDeliveryLoop } from '@/lib/agent-mission-control/delivery-loop-server'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

// Copilot ids are `copilot-<slug>-<uuid8>` (lowercase alnum + hyphens) — same
// guard as the sibling [copilotId]/route.ts. Rejecting anything else up front
// (400) keeps malformed segments out of every downstream PostgREST/sandbox call.
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

// `whatToTest` only feeds the manual-test message echoed back in the response,
// but an unbounded body string is still an easy memory/log amplifier — cap it
// like the other free-text fields on copilot routes.
const MAX_WHAT_TO_TEST_LENGTH = 2_000

/**
 * POST /api/agent-ops/copilots/:copilotId/delivery-loop — run ONE iteration of
 * the live delivery loop: assess the latest delivery + sandbox, classify any
 * failure, compute readiness, and return the state + next action.
 *
 * READ-ONLY by default. A sandbox run happens only when body `runSandbox:true`;
 * `sandboxMode:"execute"` (a disposable clone) is explicit. NEVER merges, NEVER
 * direct-commits to the target repo, NEVER edits the target repo's code.
 *
 * Body: { runSandbox?: boolean, sandboxMode?: "dry_run"|"execute", whatToTest?: string }
 * Auth enforced upstream by src/proxy.ts for all /api/agent-ops.
 */
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

  // Body: an ABSENT/EMPTY body keeps the safe defaults (documented
  // optional-body contract, same as the sibling target-sandbox route); a
  // PRESENT-but-invalid body/field is a 400, never a silent coercion — a
  // typoed `sandboxMode: "excute"` (or `runSandbox: "true"`) must not
  // silently downgrade an intended sandbox run to the read-only default.
  let runSandbox = false
  let sandboxMode: 'dry_run' | 'execute' = 'dry_run'
  let whatToTest: string | undefined
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
    const body = parsed as { runSandbox?: unknown; sandboxMode?: unknown; whatToTest?: unknown }
    if (body.runSandbox !== undefined && typeof body.runSandbox !== 'boolean') {
      return NextResponse.json({ error: 'runSandbox must be a boolean' }, { status: 400 })
    }
    if (body.sandboxMode !== undefined && body.sandboxMode !== 'dry_run' && body.sandboxMode !== 'execute') {
      return NextResponse.json({ error: "sandboxMode must be 'dry_run' or 'execute'" }, { status: 400 })
    }
    if (body.whatToTest !== undefined && typeof body.whatToTest !== 'string') {
      return NextResponse.json({ error: 'whatToTest must be a string' }, { status: 400 })
    }
    if (typeof body.whatToTest === 'string' && body.whatToTest.length > MAX_WHAT_TO_TEST_LENGTH) {
      return NextResponse.json(
        { error: `whatToTest must be at most ${MAX_WHAT_TO_TEST_LENGTH} chars` },
        { status: 400 }
      )
    }
    runSandbox = body.runSandbox === true
    sandboxMode = body.sandboxMode === 'execute' ? 'execute' : 'dry_run'
    whatToTest = typeof body.whatToTest === 'string' ? body.whatToTest : undefined
  }

  // Running a sandbox (esp. execute, which clones) needs GITHUB_TOKEN.
  if (runSandbox && !process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured (GITHUB_TOKEN missing)' }, { status: 503 })
  }

  const { runId, createdAt } = newLoopRunId()
  try {
    const state = await runDeliveryLoop(copilotId, { runId, createdAt, runSandbox, sandboxMode, whatToTest })
    if (!state) return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    return NextResponse.json({ ok: true, state })
  } catch (err) {
    console.error('[delivery-loop] iteration failed', err instanceof Error ? err.message : err)
    // pgrest() timeout (PgrestError 504, postgrest.ts) → 504 gateway timeout;
    // any other upstream failure stays a generic 502. Same body either way.
    return NextResponse.json({ error: 'delivery loop iteration failed' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
