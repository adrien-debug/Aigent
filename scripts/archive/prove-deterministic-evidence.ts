/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — end-to-end proof, NO direct SQL into the
 * result tables.
 *
 * Proves the whole chain the mission asks for, honestly:
 *   create a cleanable agent → create a test suite + cases → run the OFFICIAL
 *   runTestSuite / runBenchmarkSuite through the DETERMINISTIC adapter ($0, no
 *   billed LLM) → read back the persisted rows → evaluate the REAL release gate.
 *
 * Unlike scripts/prove-factory-e2e.ts (steps 3–4 wrote test_runs/benchmark_runs
 * DIRECTLY and flagged the missing adapter as a defect), NOT ONE result row here
 * is written by this script — every row comes from the runner. That is the hole
 * this chantier closes.
 *
 * Because the directive makes LangGraph canonical and forbids a fixture-backed
 * proof from satisfying a production gate, this script does NOT promote. It
 * demonstrates the CORRECT refusal: the fixture evidence is persisted through the
 * official path and labelled `deterministic-fixture`, and the release gate — which
 * reads `execution_mode=eq.live` only — treats it as MISSING and refuses to make
 * the candidate promotable. A red run blocks; a green run supersedes it as the
 * latest; both are gate-refused because they are fixtures. Only a real LangGraph
 * (or direct) run would ever promote.
 *
 * Requirements: the gpu1 PostgREST perimeter (AMC_DATA_SOURCE=gpu1 + URL + key)
 * with migration 0037 applied. The Agent Server is NOT needed — the deterministic
 * adapter is offline. This script sets an explicit fail-closed opt-in for the
 * guard; it refuses to run in production.
 *
 * Run: NODE_ENV=development AIGENT_DETERMINISTIC_EVIDENCE=allow \
 *      node --env-file=.env.local npx tsx scripts/prove-deterministic-evidence.ts [--keep]
 *
 * STATUS: coded, NOT executed live in this session — see docs/deterministic-evidence-001.md
 * (running it writes cleanable rows to the SHARED gpu1 DB and requires migration
 * 0037 applied there, a pre-merge coordination step deferred to the integrator).
 * The identical logic is verified offline in tests/unit/deterministic-evidence-*.
 */
import { randomUUID } from 'node:crypto'

// Make the deterministic executor constructible in this proof-script context
// BEFORE importing the domain (the guard reads env at construction). Never
// production: isProductionRuntime() still refuses if NODE_ENV=production.
process.env.AIGENT_DETERMINISTIC_EVIDENCE = 'allow'
// NODE_ENV is typed read-only; assign through a widened view. Never overrides an
// explicit production (the guard refuses production regardless).
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = 'development'

import { createCopilotFromManifest, deleteCopilotCascade } from '../../src/lib/agent-mission-control/authoring-writes'
import { makeDeterministicEvidenceAdapter } from '../../src/lib/agent-mission-control/evidence/deterministic-adapter'
import { evaluateReleaseGate } from '../../src/lib/agent-mission-control/release-gate'
import { pgrest } from '../../src/lib/agent-mission-control/postgrest'
import { runBenchmarkSuite } from '../../src/lib/agent-mission-control/benchmark-runner'
import { runTestSuite } from '../../src/lib/agent-mission-control/test-runner'
import type { CreateCopilotInput } from '../../src/lib/agent-mission-control/authoring-types'

const KEEP = process.argv.includes('--keep')
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`
const ok = (b: boolean, msg: string) => console.log(`${b ? '✓' : '✗'} ${msg}`)

async function main() {
  const token = randomUUID().slice(0, 8)
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('live gpu1 backend not configured (AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  }
  const name = `DETERMINISTIC-EVIDENCE-E2E ${token}`
  console.log(`\n=== DETERMINISTIC EVIDENCE E2E · token=${token} · keep=${KEEP} ===\n`)

  let copilotId: string | null = null
  try {
    // 1) Create a cleanable agent via the product path (count_words, langgraph).
    const input: CreateCopilotInput = {
      name,
      slug: `deterministic-evidence-e2e-${token}`,
      description: 'Deterministic evidence proof agent — counts words. Test-only, cleanable.',
      runtime: 'langgraph',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      owner: 'deterministic-evidence',
      tags: ['deterministic-evidence', 'e2e', 'cleanable'],
      projectId: null,
      targetProjectIds: [],
      manifest: {
        systemPromptSummary: 'You count the words in the user text using count_words and report the number.',
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
    ok(!!copilotId, `1. created agent ${copilotId} (product path, no direct write)`)

    const [cop] = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=latest_version_id`)
    const versionId = cop.latest_version_id as string

    // 2) Create a test suite + cases WITHOUT touching test_runs/test_results.
    const suiteId = `de-suite-${token}`
    await pgrest('POST', 'test_suites', { id: suiteId, copilot_id: copilotId, name: 'deterministic suite', kind: 'behavior' })
    const cases = [
      { id: `de-case-a-${token}`, input: 'the quick brown fox', expected_behavior: 'reports the word count' },
      { id: `de-case-b-${token}`, input: 'one two three', expected_behavior: 'reports the word count' },
    ]
    for (const c of cases) {
      await pgrest('POST', 'test_cases', { id: c.id, suite_id: suiteId, name: c.id, input: c.input, expected_behavior: c.expected_behavior })
    }
    ok(true, `2. created suite + ${cases.length} cases (no result rows written)`)

    // 3) RED proof: a wrong-answer scenario → the runner persists a real test_runs
    //    row with pass_rate < 1, via runTestSuite. NO direct write.
    const redAdapter = makeDeterministicEvidenceAdapter({
      scenarios: [
        { input: 'the quick brown fox', behavior: { kind: 'wrong-answer' }, grade: { pass: false, reason: 'wrong count' } },
        { input: 'one two three', behavior: { kind: 'count-words' }, grade: { pass: true } },
      ],
      source: 'proof-script',
    })
    const redRun = await runTestSuite({ copilotId, suiteId, adapter: redAdapter })
    ok(redRun.passRate < 1, `3. RED run via runTestSuite: pass_rate=${redRun.passRate} (< 1) — persisted by the runner`)

    // 4) The gate refuses the RED fixture evidence (fixture never satisfies a prod gate).
    const gateAfterRed = await evaluateReleaseGate(copilotId, versionId)
    const testsCheckRed = gateAfterRed?.checks.find((c) => c.id === 'tests-pass')
    ok(testsCheckRed?.status === 'missing', `4. gate ignores the fixture RED run (tests-pass=${testsCheckRed?.status}, not 'fail' — fixtures are invisible to the gate)`)
    ok(gateAfterRed?.promotable === false, `4b. candidate NOT promotable on fixture evidence`)

    // 5) GREEN proof: re-run all-green → a NEW test_runs row (append-only, versioned).
    const greenAdapter = makeDeterministicEvidenceAdapter({
      scenarios: cases.map((c) => ({ input: c.input, behavior: { kind: 'count-words' as const }, grade: { pass: true } })),
      source: 'proof-script',
    })
    const greenRun = await runTestSuite({ copilotId, suiteId, adapter: greenAdapter })
    ok(greenRun.passRate === 1 && greenRun.id !== redRun.id, `5. GREEN run supersedes RED as the latest (pass_rate=1, new id ${greenRun.id !== redRun.id})`)

    // 6) Benchmark via the runner, deterministic — real benchmark_runs row, no direct write.
    const benchSuiteId = `de-bench-${token}`
    await pgrest('POST', 'benchmark_suites', { id: benchSuiteId, copilot_id: copilotId, name: 'deterministic bench', task_count: 2 })
    const benchRun = await runBenchmarkSuite({ copilotId, suiteId: benchSuiteId, adapter: greenAdapter })
    ok(benchRun.status === 'completed', `6. benchmark via runBenchmarkSuite: status=${benchRun.status} — persisted by the runner`)

    // 7) Verify the persisted rows are labelled deterministic-fixture (provenance).
    const runs = await pgrest<Record<string, unknown>[]>('GET', `test_runs?${eq('copilot_id', copilotId)}&select=id,execution_mode`)
    const allFixture = runs.length > 0 && runs.every((r) => r.execution_mode === 'deterministic-fixture')
    ok(allFixture, `7. all ${runs.length} persisted test_runs are labelled 'deterministic-fixture' (never confused with a billed run)`)

    // 8) Even the GREEN fixture evidence does not promote — only real evidence would.
    const gateAfterGreen = await evaluateReleaseGate(copilotId, versionId)
    ok(gateAfterGreen?.promotable === false, `8. GREEN fixture evidence STILL does not satisfy the production gate (only 'live' evidence can) — point 6 proven end-to-end`)

    console.log('\n=== SUMMARY: deterministic evidence flows through the OFFICIAL runners, no direct result writes, and NEVER satisfies a production promotion. ===')
  } finally {
    if (copilotId && !KEEP) {
      const deleted = await deleteCopilotCascade(copilotId)
      ok(deleted, `9. cleanup: cascade-deleted ${copilotId}`)
    } else if (copilotId) {
      ok(true, `9. --keep set: left ${copilotId} in the DB`)
    }
  }
}

main().catch((err) => {
  console.error('\n✗ PROOF ABORTED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
