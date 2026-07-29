import { NextResponse } from 'next/server'

/**
 * GET /api/agent-ops/delivery-capability — can this deployment perform a REAL
 * GitHub delivery at all?
 *
 * Why it exists: `push-agent/route.ts` decides `dryRun` from server-only state
 * (`GITHUB_PUSH_ENABLED`, `GITHUB_TOKEN`, the gpu1 backend vars). None of that
 * is readable from the browser, so the console could not tell a real delivery
 * from a forced dry-run until AFTER it had already posted. The delivery
 * controls therefore left the real button disabled and only armed it once a
 * response happened to come back `dryRun:false` — circular: you had to
 * successfully deliver for real before the button that delivers for real
 * became clickable. This route breaks that loop by answering the question up
 * front.
 *
 * AUTH: enforced upstream by src/proxy.ts for every `/api/agent-ops/**` path —
 * this handler adds no second gate on purpose (duplicated gates drift). Same
 * convention as `agent-ops/agents/route.ts`.
 *
 * THE RESPONSE IS ONE BOOLEAN, DELIBERATELY:
 *
 *     { "realDeliveryEnabled": boolean }
 *
 * No token, no flag value, no variable NAME, no per-precondition breakdown.
 * A body like `{ tokenPresent: false, pushFlag: "0" }` would be a map of which
 * secret to go set — the caller only needs to know whether the button works.
 * The three preconditions below mirror `push-agent/route.ts` exactly; if that
 * route's gates change, this one must change with them or the console starts
 * lying in the safe direction (button enabled, delivery silently downgraded).
 *
 * WHAT `true` DOES NOT PROMISE: that the repo exists, that the token can reach
 * it, that the branch is writable, or that the delivery will succeed. It is a
 * statement about THIS SERVER'S configuration, nothing about GitHub's side.
 * The strong confirmation in the UI is not excused by a `true` here.
 *
 * READ-ONLY. Touches no database, calls no LLM, contacts no remote.
 */
export async function GET() {
  // Mirrors push-agent/route.ts:96-101 — live gpu1 backend must be configured.
  const backendConfigured =
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Mirrors push-agent/route.ts:99 and github.ts's `requireGithub()`.
  const githubConfigured = Boolean(process.env.GITHUB_TOKEN)

  // Mirrors push-agent/route.ts:163 and github.ts's `pushArmed()`. Strict
  // '1' — any other value (including 'true') leaves the push disarmed.
  const pushArmed = process.env.GITHUB_PUSH_ENABLED === '1'

  return NextResponse.json({
    realDeliveryEnabled: backendConfigured && githubConfigured && pushArmed,
  })
}
