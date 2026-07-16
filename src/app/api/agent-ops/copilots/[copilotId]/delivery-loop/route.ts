import { NextResponse } from 'next/server'

import { newLoopRunId, runDeliveryLoop } from '@/lib/agent-mission-control/delivery-loop-server'

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

  let runSandbox = false
  let sandboxMode: 'dry_run' | 'execute' = 'dry_run'
  let whatToTest: string | undefined
  try {
    const body = (await request.json().catch(() => null)) as
      | { runSandbox?: unknown; sandboxMode?: unknown; whatToTest?: unknown }
      | null
    runSandbox = body?.runSandbox === true
    sandboxMode = body?.sandboxMode === 'execute' ? 'execute' : 'dry_run'
    whatToTest = typeof body?.whatToTest === 'string' ? body.whatToTest : undefined
  } catch {
    // safe defaults
  }
  if (whatToTest !== undefined && whatToTest.length > MAX_WHAT_TO_TEST_LENGTH) {
    return NextResponse.json(
      { error: `whatToTest must be at most ${MAX_WHAT_TO_TEST_LENGTH} chars` },
      { status: 400 }
    )
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
    return NextResponse.json({ error: 'delivery loop iteration failed' }, { status: 502 })
  }
}
