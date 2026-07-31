/**
 * AIGENT-FACTORY-SHADOW-REPLAY-001 — end-to-end proof that Shadow and Replay
 * are now product capabilities, reachable ONLY through the official API
 * routes — no manual insert into shadow_experiments/replay_comparisons, no
 * SQL fixture, no private script calling the engines directly.
 *
 * Scope: this proof exercises the SAME route handler functions Next.js
 * invokes for a real HTTP request (`POST`/`GET` exported by
 * shadow/route.ts and replay/route.ts) — calling them in-process is not a
 * bypass, it is the identical code path with the HTTP transport removed,
 * exactly the same principle prove-factory-e2e.ts already established for
 * createCopilotFromManifest and the promotion RPC.
 *
 * Cleanable: a unique namespaced agent (SHADOW-REPLAY-PROOF-E2E <token>),
 * cascade-deleted at the end unless --keep.
 *
 * NOT YET RUN AGAINST LIVE gpu1 (2026-07-25) — recorded here so the gap is
 * never silently assumed closed:
 *   1. Migrations 0034/0035 are NOT applied to the shared gpu1 database yet.
 *      They exist on disk and are proven correct offline (112 unit test
 *      files / 1357 tests, including two in-memory-table tests that
 *      reproduce the exact partial-unique-index semantics these migrations
 *      add), but gpu1 is shared infrastructure — applying them requires its
 *      own reviewed PR + explicit sign-off, never an ad hoc SQL call from a
 *      proof script or an alternate/unconfirmed Supabase project.
 *   2. The LangGraph Agent Server is not confirmed reachable from every host
 *      that might run this proof.
 *   3. No billed LLM call has been authorized for this proof — it must stay
 *      fixture-backed ($0) until an operator explicitly authorizes a real,
 *      billed run.
 * This script is ready to run as soon as (1) is done on the integration
 * branch; running it before then will fail with PGRST204 (column not found
 * in schema cache) on `copilots.requires_shadow_replay`. See
 * git history (`docs/factory-shadow-replay-001.md`, deleted 2026-07-31) for the
 * original verdict and gap list.
 *
 * Run: node --env-file=.env.local npx tsx --conditions=react-server scripts/prove-shadow-replay-e2e.ts [--keep]
 */
import { randomUUID } from 'node:crypto'

import { createCopilotFromManifest, deleteCopilotCascade } from '../../src/lib/agent-mission-control/authoring-writes'
import { pgrest } from '../../src/lib/agent-mission-control/postgrest'
import type { CreateCopilotInput } from '../../src/lib/agent-mission-control/authoring-types'

const KEEP = process.argv.includes('--keep')
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

interface Step {
  step: string
  ok: boolean
  real: 'executed' | 'read'
  detail: string
  persisted?: Record<string, unknown>
  defect?: string
}
const steps: Step[] = []
function record(s: Step) {
  steps.push(s)
  const tag = s.ok ? '✓' : '✗'
  console.log(`${tag} [${s.real.toUpperCase()}] ${s.step} — ${s.detail}${s.defect ? `  ⚠ DEFECT: ${s.defect}` : ''}`)
}

function req(body: unknown) {
  return new Request('http://proof-host/x', { method: 'POST', body: JSON.stringify(body) })
}
function ctx(copilotId: string, versionId: string) {
  return { params: Promise.resolve({ copilotId, versionId }) }
}

async function main() {
  const runToken = randomUUID().slice(0, 8)
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error('live backend not configured (need AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  }
  const proofName = `SHADOW-REPLAY-PROOF-E2E ${runToken}`
  console.log(`\n=== SHADOW/REPLAY PRODUCT-ROUTE E2E PROOF · token=${runToken} · keep=${KEEP} ===\n`)

  let copilotId: string | null = null
  try {
    // ── 0) precondition ──────────────────────────────────────────────────────
    const pre = await pgrest<Record<string, unknown>[]>('GET', `copilots?name=eq.${encodeURIComponent(proofName)}&select=id`)
    record({ step: '0. precondition: agent absent', ok: pre.length === 0, real: 'read', detail: `0 rows named "${proofName}"` })

    // ── 1) create via the product path ───────────────────────────────────────
    const input: CreateCopilotInput = {
      name: proofName,
      slug: `shadow-replay-proof-e2e-${runToken}`,
      description: 'Shadow/Replay product-route proof agent — counts words. Test-only, cleanable.',
      runtime: 'langgraph',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      owner: 'shadow-replay-proof',
      tags: ['factory-proof', 'shadow-replay', 'e2e', 'cleanable'],
      projectId: null,
      targetProjectIds: [],
      manifest: {
        systemPromptSummary: 'You count the words in the user text using the count_words tool and report the number. Nothing else.',
        allowedRoutes: [],
        forbiddenActions: [],
        confirmationPolicy: 'never',
        alwaysConfirmActions: [],
        outputContract: { format: 'json', schemaName: null, invariants: ['returns the integer word count'] },
        proposedTools: [
          {
            name: 'count_words',
            description: 'Count words, characters and the longest token in a text (pure, local, deterministic).',
            provider: 'internal',
            riskLevel: 'low',
            requiresConfirmation: false,
            mutates: false,
          },
        ],
        skills: [],
        maxStepsPerRun: 4,
        maxCostPerRunUsd: 0.5,
      },
    }
    copilotId = await createCopilotFromManifest(input)
    record({ step: '1. create agent (createCopilotFromManifest = product path)', ok: !!copilotId, real: 'executed', detail: `copilotId=${copilotId}`, persisted: { copilotId } })

    const [cop] = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=id,latest_version_id,requires_shadow_replay`)
    const versionId = cop.latest_version_id as string
    record({
      step: '1b. verify new-copilot policy default (migration 0035 + authoring-writes.ts)',
      ok: cop.requires_shadow_replay === true,
      real: 'read',
      detail: `copilots.requires_shadow_replay=${cop.requires_shadow_replay} (must be true for every copilot created via the product path from now on)`,
      persisted: { versionId },
    })

    // ── 2) SHADOW via the product ROUTE (not runShadowExperiment directly) ────
    const { POST: shadowPOST, GET: shadowGET } = await import('../../src/app/api/agent-ops/copilots/[copilotId]/versions/[versionId]/shadow/route')
    const shadowRes = await shadowPOST(req({}), ctx(copilotId, versionId))
    const shadowBody = await shadowRes.json()
    record({
      step: '2. shadow via POST /api/agent-ops/copilots/:id/versions/:id/shadow',
      ok: shadowRes.status === 200 && shadowBody.verdict === 'PASS' && shadowBody.wouldMutateCount === 0,
      real: 'executed',
      detail: `status=${shadowRes.status} verdict=${shadowBody.verdict} sampled=${shadowBody.sampledRunCount} wouldMutate=${shadowBody.wouldMutateCount} experimentId=${shadowBody.experimentId}`,
      persisted: { experimentId: shadowBody.experimentId },
    })

    // 2b) Concurrency proof: a second shadow POST for the SAME candidate while
    // evidence already exists must not silently double-run — the route's own
    // GET must reflect one persisted, completed experiment (the POST above
    // already fully resolved, so a fresh POST here is a NEW run, not a
    // collision — the collision case itself is proven offline in
    // tests/unit/shadow-replay-routes.test.ts with a synthetic race; here we
    // only prove the GET reads back exactly what the route persisted).
    const shadowGetRes = await shadowGET(new Request('http://proof-host/x'), ctx(copilotId, versionId))
    const shadowGetBody = await shadowGetRes.json()
    record({
      step: '2c. read back shadow evidence via GET (no manual DB read of shadow_experiments)',
      ok: shadowGetBody.experiment?.verdict === 'PASS' && shadowGetBody.experiment?.id === shadowBody.experimentId,
      real: 'read',
      detail: `GET returns the same experimentId=${shadowGetBody.experiment?.id} verdict=${shadowGetBody.experiment?.verdict}`,
    })

    // ── 3) REPLAY via the product ROUTE (not runReplayComparison directly) ────
    const { POST: replayPOST, GET: replayGET } = await import('../../src/app/api/agent-ops/copilots/[copilotId]/versions/[versionId]/replay/route')
    const replayRes = await replayPOST(req({}), ctx(copilotId, versionId))
    const replayBody = await replayRes.json()
    record({
      step: '3. replay via POST /api/agent-ops/copilots/:id/versions/:id/replay',
      ok: replayRes.status === 200 && typeof replayBody.verdict === 'string' && replayBody.caseCount > 0,
      real: 'executed',
      detail: `status=${replayRes.status} verdict=${replayBody.verdict} caseCount=${replayBody.caseCount} comparisonId=${replayBody.comparisonId}`,
      persisted: { comparisonId: replayBody.comparisonId },
    })

    const replayGetRes = await replayGET(new Request('http://proof-host/x'), ctx(copilotId, versionId))
    const replayGetBody = await replayGetRes.json()
    record({
      step: '3c. read back replay evidence via GET, bound to this exact candidate_version_id',
      ok: replayGetBody.comparison?.id === replayBody.comparisonId,
      real: 'read',
      detail: `GET returns the same comparisonId=${replayGetBody.comparison?.id} verdict=${replayGetBody.comparison?.verdict} caseCount=${replayGetBody.comparison?.caseCount}`,
    })

    // ── 4) empty-corpus refusal, proven live through the route ────────────────
    const emptyRes = await shadowPOST(req({ inputs: [] }), ctx(copilotId, versionId))
    const emptyBody = await emptyRes.json()
    record({
      step: '4. empty corpus explicitly refused (422 INSUFFICIENT_EVIDENCE), not silently substituted',
      ok: emptyRes.status === 422 && emptyBody.code === 'INSUFFICIENT_EVIDENCE',
      real: 'executed',
      detail: `status=${emptyRes.status} code=${emptyBody.code}`,
    })

    // ── 5) IDOR proof: an unrelated copilot cannot shadow/replay this version ─
    const otherInput: CreateCopilotInput = { ...input, name: `${proofName}-OTHER`, slug: `${input.slug}-other` }
    const otherCopilotId = await createCopilotFromManifest(otherInput)
    try {
      const idorRes = await shadowPOST(req({}), ctx(otherCopilotId, versionId))
      record({
        step: '5. IDOR: an unrelated copilot cannot launch shadow for this candidate — generic 404',
        ok: idorRes.status === 404,
        real: 'executed',
        detail: `status=${idorRes.status}`,
      })
    } finally {
      await deleteCopilotCascade(otherCopilotId)
    }

    // ── 6) gate reflects real shadow+replay evidence ──────────────────────────
    const { evaluateAndPersistPromotionGate } = await import('../../src/lib/agent-mission-control/promotion-gate')
    const gate = await evaluateAndPersistPromotionGate(copilotId, versionId, { requireShadow: true, requireReplay: true })
    record({
      step: '6. promotion gate reads the route-produced evidence (requireShadow+requireReplay)',
      ok: !!gate && gate.result.checks.some((c) => c.id === 'shadow-proof' && c.status === 'PASS') && gate.result.checks.some((c) => c.id === 'replay-comparison' && c.status !== 'FAIL'),
      real: 'executed',
      detail: gate ? `overall=${gate.result.overall} checks=[${gate.result.checks.map((c) => `${c.id}:${c.status}`).join(', ')}]` : 'gate evaluation returned null',
    })
  } finally {
    if (copilotId && !KEEP) {
      const deleted = await deleteCopilotCascade(copilotId)
      record({ step: '7. cleanup (deleteCopilotCascade)', ok: deleted, real: 'executed', detail: deleted ? `copilot ${copilotId} + children (incl. shadow_experiments/replay_comparisons rows) cascade-deleted` : 'nothing to delete' })
      const after = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=id`)
      record({ step: '7b. verify cleanup', ok: after.length === 0, real: 'read', detail: `${after.length} rows remain for ${copilotId}` })
    } else if (copilotId) {
      record({ step: '7. cleanup', ok: true, real: 'read', detail: `--keep set: agent ${copilotId} left in DB` })
    }
  }

  const allOk = steps.every((s) => s.ok)
  console.log(`\n=== SUMMARY · token=${runToken} · allOk=${allOk} ===`)
  console.log(JSON.stringify({ runToken, allOk, steps }, null, 2))
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error('\n✗ PROOF ABORTED:', err instanceof Error ? err.message : err)
  console.log(JSON.stringify({ aborted: true, steps }, null, 2))
  process.exit(1)
})
