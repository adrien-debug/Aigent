/**
 * Promote a TradeAgent roster copilot through gate + official RPC.
 * Usage: npx tsx --conditions=react-server scripts/promote-tradeagent-copilot.ts <slug>
 * Example: promote-tradeagent-copilot.ts portfolio-risk-guardian
 */
import { ensureAgentSuites } from '../src/lib/agent-mission-control/agent-suite-generator'
import { runBenchmarkSuite } from '../src/lib/agent-mission-control/benchmark-runner'
import { evaluateAndPersistPromotionGate } from '../src/lib/agent-mission-control/promotion-gate'
import { resolvePromotionPolicy } from '../src/lib/agent-mission-control/promotion-policy'
import { evaluateReleaseGate } from '../src/lib/agent-mission-control/release-gate'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { runTestSuite } from '../src/lib/agent-mission-control/test-runner'

const slug = process.argv[2]
if (!slug) {
  console.error('usage: promote-tradeagent-copilot.ts <slug>  (e.g. portfolio-risk-guardian)')
  process.exit(1)
}

const COPILOT = `copilot-${slug}`
const VERSION = `ver-${slug}-v1`

async function main() {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('backend not configured')

  console.log(`\n=== PROMOTE ${COPILOT} ===\n`)

  const [cop] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(COPILOT)}&select=id,status,production_version_id`
  )
  if (!cop) throw new Error(`${COPILOT} not found`)

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
    if (!testSuite || !benchSuite) throw new Error('suites missing')
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
  } else {
    console.log(`suites created: test=${suites.testSuiteId} bench=${suites.benchmarkSuiteId}`)
  }
  if (!suites) throw new Error('suites unavailable')

  const testRun = await runTestSuite({
    copilotId: COPILOT,
    suiteId: suites.testSuiteId,
    versionId: VERSION,
    triggeredBy: `promote-${slug}`,
  })
  console.log(`tests: ${testRun.status} passRate=${testRun.passRate}`)

  const benchRun = await runBenchmarkSuite({
    copilotId: COPILOT,
    suiteId: suites.benchmarkSuiteId,
    versionId: VERSION,
  })
  console.log(`benchmark: ${benchRun.status}`)

  const release = await evaluateReleaseGate(COPILOT, VERSION)
  if (!release?.promotable) {
    console.log(release?.checks)
    throw new Error('release gate not green')
  }

  const { policy, source } = await resolvePromotionPolicy(COPILOT)
  const gate = await evaluateAndPersistPromotionGate(COPILOT, VERSION, policy)
  if (!gate?.result.promotable) throw new Error('promotion gate blocked')

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
  if (!rpcRes.ok) throw new Error(`RPC ${rpcRes.status}: ${(await rpcRes.text()).slice(0, 300)}`)

  const [after] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(COPILOT)}&select=status,production_version_id`
  )
  console.log(`\n✓ promoted policy=${source} status=${after.status} production=${after.production_version_id}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
