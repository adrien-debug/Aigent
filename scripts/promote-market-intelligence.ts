/**
 * Promote copilot-market-intelligence through the official gate + RPC path.
 * 💲 OpenAI billed (suite generation + tests + benchmark).
 */
import { ensureAgentSuites } from '../src/lib/agent-mission-control/agent-suite-generator'
import { runBenchmarkSuite } from '../src/lib/agent-mission-control/benchmark-runner'
import { evaluateAndPersistPromotionGate } from '../src/lib/agent-mission-control/promotion-gate'
import { resolvePromotionPolicy } from '../src/lib/agent-mission-control/promotion-policy'
import { evaluateReleaseGate } from '../src/lib/agent-mission-control/release-gate'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { runTestSuite } from '../src/lib/agent-mission-control/test-runner'

const COPILOT = 'copilot-market-intelligence'
const VERSION = 'ver-market-intelligence-v1'

async function main() {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = process.env.AMC_API_KEY
  if (!base || !key) throw new Error('backend not configured')

  console.log(`\n=== PROMOTE ${COPILOT} ===\n`)

  // 1) Suites
  let suites = await ensureAgentSuites(COPILOT)
  if (!suites) {
    const [testSuite] = await pgrest<Record<string, unknown>[]>(
      'GET',
      `test_suites?copilot_id=eq.${encodeURIComponent(COPILOT)}&select=id&limit=1`
    )
    const [benchSuite] = await pgrest<Record<string, unknown>[]>(
      'GET',
      `benchmark_suites?copilot_id=eq.${encodeURIComponent(COPILOT)}&select=id&limit=1`
    )
    if (!testSuite || !benchSuite) throw new Error('suites missing after ensureAgentSuites')
    suites = {
      testSuiteId: testSuite.id as string,
      benchmarkSuiteId: benchSuite.id as string,
      suiteSource: 'manifest_only',
      repoFit: {
        score: 0,
        level: 'none',
        suiteSource: 'manifest_only',
        checks: [],
        missingCoverage: [],
        hallucinationWarnings: [],
      },
    }
    console.log('suites already exist')
  } else {
    console.log(`suites created: test=${suites.testSuiteId} bench=${suites.benchmarkSuiteId}`)
  }
  if (!suites) throw new Error('suites unavailable')

  // 2) Test run (live evidence for release gate)
  console.log('running test suite…')
  const testRun = await runTestSuite({
    copilotId: COPILOT,
    suiteId: suites.testSuiteId,
    versionId: VERSION,
    triggeredBy: 'promote-market-intelligence-script',
  })
  console.log(`test run: ${testRun.status} passRate=${testRun.passRate} cases=${testRun.resultIds.length}`)

  // 3) Benchmark (live evidence)
  console.log('running benchmark…')
  const benchRun = await runBenchmarkSuite({
    copilotId: COPILOT,
    suiteId: suites.benchmarkSuiteId,
    versionId: VERSION,
  })
  console.log(`benchmark: ${benchRun.status} resultId=${benchRun.resultId ?? 'n/a'}`)

  // 4) Release gate preview
  const release = await evaluateReleaseGate(COPILOT, VERSION)
  console.log(
    '\nrelease gate:',
    JSON.stringify(
      {
        promotable: release?.promotable,
        checks: release?.checks.map((c) => ({ id: c.id, status: c.status, observed: c.observed })),
      },
      null,
      2
    )
  )
  if (!release?.promotable) throw new Error('release gate not green')

  // 5) Full promotion gate + persist
  const { policy, source: policySource } = await resolvePromotionPolicy(COPILOT)
  const gate = await evaluateAndPersistPromotionGate(COPILOT, VERSION, policy)
  if (!gate?.result.promotable) {
    console.log('promotion gate blocked:', gate?.result.checks)
    throw new Error('promotion gate not green')
  }
  console.log(`promotion gate PASS (policy=${policySource}) id=${gate.gateEvaluationId}`)

  // 6) Official RPC (same as route)
  const rpcRes = await fetch(`${base}/rest/v1/rpc/promote_copilot_version`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_copilot_id: COPILOT,
      p_version_id: VERSION,
      p_previous_prod: null,
      p_is_rollback: false,
    }),
  })
  if (!rpcRes.ok) throw new Error(`RPC failed ${rpcRes.status}: ${(await rpcRes.text()).slice(0, 300)}`)

  const [cop] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(COPILOT)}&select=status,production_version_id`
  )
  console.log(`\n✓ promoted → status=${cop.status} production=${cop.production_version_id}`)

  // 7) Verify run gate via API
  if (apiKey) {
    const runRes = await fetch(`http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3987}/api/agent-ops/copilots/${COPILOT}/run`, {
      method: 'POST',
      headers: { 'x-amc-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userInput: 'Quick BTCUSDT volatility check — one paragraph, use tools.',
        versionId: VERSION,
      }),
    })
    const runBody = await runRes.json()
    console.log(`\nAPI run gate: HTTP ${runRes.status}`, JSON.stringify(runBody, null, 2).slice(0, 800))
  }
}

main().catch((e) => {
  console.error('\n✗', e instanceof Error ? e.message : e)
  process.exit(1)
})
