/**
 * AIGENT-AUTONOMOUS-FACTORY-001 — end-to-end PRODUCT proof.
 *
 * Proves the product journey "I describe an agent → a coherent candidate is
 * created → qualification is orchestrated → the version becomes promotable (or is
 * honestly blocked)" using ONLY the product API route handlers — never a direct
 * SQL insert of a copilot, version or manifest after the initial product call:
 *
 *   1. POST /api/agent-ops/copilots            (the create route handler)
 *   2. read back the persisted rows            (READ-only verification via pgrest)
 *   3. verify runtime + candidate version
 *   4. POST .../qualification  {action:'sweep'} (the orchestration route handler)
 *   5. show the indisponible steps honestly     (shadow/replay → NOT_AVAILABLE)
 *   6. resume the workflow                       (.../qualification {action:'advance'})
 *   7. cleanup                                   (DELETE .../copilots/:id handler)
 *
 * HONEST BY CONSTRUCTION:
 *  - No fixture. shadow/replay report NOT_AVAILABLE because the real LangGraph
 *    candidate-execution driver lives in the shadow/replay engine perimeter — a
 *    fixture is never substituted, so no fixture-backed proof can reach a gate.
 *  - The create route provisions a REAL LangGraph assistant. If the local Agent
 *    Server is down, the route returns 502 and this proof records that as a
 *    BLOCKER (it never fakes an assistant). Auto-eval (billed) runs via after().
 *  - Cleanup is a DELETE (allowed); it is the only direct write and it removes,
 *    never creates.
 *
 * Run: node --env-file=.env.local npx tsx scripts/prove-autonomous-factory-e2e.ts [--keep]
 * Requires: AMC_DATA_SOURCE=gpu1 + Supabase env, and (for step 1) a reachable
 * LangGraph Agent Server with LANGGRAPH_API_URL resolving local in dev.
 */
import { randomUUID } from 'node:crypto'

import { POST as createCopilot } from '../../src/app/api/agent-ops/copilots/route'
import { DELETE as deleteCopilot } from '../../src/app/api/agent-ops/copilots/[copilotId]/route'
import {
  GET as observeQualification,
  POST as qualify,
} from '../../src/app/api/agent-ops/copilots/[copilotId]/qualification/route'
import { pgrest } from '../../src/lib/agent-mission-control/postgrest'

const KEEP = process.argv.includes('--keep')
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

interface Step {
  step: string
  ok: boolean
  detail: string
}
const steps: Step[] = []
function record(step: string, ok: boolean, detail: string) {
  steps.push({ step, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${step} — ${detail}`)
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const params = (copilotId: string) => ({ params: Promise.resolve({ copilotId }) })

async function main() {
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('live backend not configured (need AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  }
  const token = randomUUID().slice(0, 8)
  const slug = `af001-e2e-${token}`
  console.log(`\n=== AUTONOMOUS FACTORY E2E · token=${token} · keep=${KEEP} ===\n`)

  // 1) CREATE — the product route. A read-only candidate with one certified tool.
  const createRes = await createCopilot(
    jsonRequest('http://local/api/agent-ops/copilots', {
      name: `AF001 E2E ${token}`,
      slug,
      description: 'autonomous factory e2e candidate',
      runtime: 'langgraph',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      owner: 'legal@hearstcorporation.io',
      manifest: {
        systemPromptSummary: 'Read repository files and summarize them.',
        confirmationPolicy: 'risky-only',
        outputContract: { format: 'markdown' },
        proposedTools: [
          { name: 'read_repo_file', description: 'read a repo file', provider: 'internal', riskLevel: 'low', requiresConfirmation: false, mutates: false },
        ],
        maxStepsPerRun: 8,
        maxCostPerRunUsd: 1,
      },
    }),
  )
  const createBody = await createRes.json()
  if (createRes.status !== 201) {
    record('create', false, `POST /copilots → ${createRes.status}: ${JSON.stringify(createBody)} (assistant server likely unreachable — this is a BLOCKER, not a fake)`)
    console.log('\nBLOCKED at create — cannot proceed without a real copilot. No rows to clean up (creation is compensable).')
    printSummary()
    return
  }
  const copilotId: string = createBody.copilotId
  record('create', true, `copilot ${copilotId} created; contract.runtimeExecutable=${createBody.contract?.runtimeExecutable}, tools.certified=${createBody.contract?.tools?.certified}`)

  try {
    // 2) READ BACK the persisted rows (verification only — no writes).
    const [copilotRow] = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=id,runtime,status,latest_version_id,assistant_id`)
    const versionId = copilotRow?.latest_version_id as string
    const [versionRow] = await pgrest<Record<string, unknown>[]>('GET', `copilot_versions?${eq('id', versionId)}&select=id,stage,manifest_id`)
    const [manifestRow] = await pgrest<Record<string, unknown>[]>('GET', `manifests?${eq('id', versionRow?.manifest_id as string)}&select=id,tool_ids`)
    record('rows', !!(copilotRow && versionRow && manifestRow), `copilot+version(${versionRow?.stage})+manifest(${(manifestRow?.tool_ids as string[])?.length} tool ids) all persisted`)

    // 3) VERIFY runtime + candidate.
    record('runtime', copilotRow?.runtime === 'langgraph', `runtime=${copilotRow?.runtime}, status=${copilotRow?.status}`)
    record('candidate', versionRow?.stage === 'draft', `candidate version ${versionId} is ${versionRow?.stage}`)

    // 4) QUALIFICATION SWEEP — the orchestration route.
    const sweepRes = await qualify(jsonRequest(`http://local/api/agent-ops/copilots/${copilotId}/qualification`, { versionId, action: 'sweep' }), params(copilotId))
    const sweep = await sweepRes.json()
    record('sweep', sweepRes.status === 200, `run ${sweep.run?.id} → status=${sweep.run?.status}; next="${sweep.readiness?.nextAction}"`)

    // 5) HONEST indisponible steps.
    const byStep = Object.fromEntries((sweep.run?.steps ?? []).map((s: { step: string; status: string }) => [s.step, s.status]))
    const shadowHonest = byStep.shadow === 'NOT_AVAILABLE'
    const replayHonest = byStep.replay === 'NOT_AVAILABLE'
    record('honesty', shadowHonest && replayHonest, `steps=${JSON.stringify(byStep)} — shadow/replay NOT_AVAILABLE (no fixture stands in)`)
    record('no-lying-ready', sweep.readiness?.state !== 'promotable' || !/\bREADY\b/.test(sweep.readiness?.nextAction ?? ''), `state=${sweep.readiness?.state}, promotable=${sweep.readiness?.promotable}`)

    // 6) RESUME — the advance action is idempotent on a terminal run (proves the
    //    resume endpoint is exposed; failure-mid-flight resume is proven in unit #8).
    const advRes = await qualify(jsonRequest(`http://local/api/agent-ops/copilots/${copilotId}/qualification`, { versionId, action: 'advance' }), params(copilotId))
    const adv = await advRes.json()
    record('resume', advRes.status === 200, `advance → status=${adv.run?.status} (terminal runs are stable)`)

    // Observe via GET (the UI read path).
    const obsRes = await observeQualification(new Request(`http://local/api/agent-ops/copilots/${copilotId}/qualification?versionId=${versionId}`), params(copilotId))
    record('observe', obsRes.status === 200, `GET qualification → 200 (detail page read path)`)
  } finally {
    // 7) CLEANUP via the product DELETE route (cascades version/manifest/tools).
    if (!KEEP) {
      const delRes = await deleteCopilot(new Request(`http://local/api/agent-ops/copilots/${copilotId}`, { method: 'DELETE' }), params(copilotId))
      record('cleanup', delRes.status === 200 || delRes.status === 204, `DELETE /copilots/${copilotId} → ${delRes.status}`)
    } else {
      record('cleanup', true, `--keep set; left ${copilotId} in place`)
    }
  }
  printSummary()
}

function printSummary() {
  const ok = steps.filter((s) => s.ok).length
  console.log(`\n=== ${ok}/${steps.length} steps ok ===`)
  if (ok !== steps.length) process.exitCode = 1
}

main().catch((err) => {
  console.error('E2E proof crashed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
