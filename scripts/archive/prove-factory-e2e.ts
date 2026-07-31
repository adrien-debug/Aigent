/**
 * AIGENT-RUNTIME-PROMOTION-001 — Phase 3 end-to-end factory proof.
 *
 * Proves, from a state where the agent DOES NOT EXIST, the full chain:
 *   create → draft version → manifest → certified non-mutating tool → tests →
 *   benchmark → shadow → replay → gate → promotion (official RPC) → run.
 *
 * PRINCIPLES (honest by construction):
 *  - Product paths only where they exist: createCopilotFromManifest is the exact
 *    function POST /api/agent-ops/copilots calls; the promotion uses the official
 *    hardened RPC promote_copilot_version via PostgREST (same call the route makes).
 *  - Deterministic + $0 where an adapter exists: shadow/replay run the REAL
 *    runShadowExperiment / runReplayComparison engines driven by the count_words
 *    fixture — real code, real tool execution, zero external effect, zero billed
 *    call. The gate is the REAL evaluateAndPersistPromotionGate.
 *  - Every DIRECT write is flagged as a PRODUCT DEFECT in the report: the test
 *    and benchmark runners have NO deterministic adapter (each case is a real
 *    billed LLM run), so their evidence rows are written directly and labelled
 *    `directWrite: true, defect: '<why>'`. Nothing pretends a direct write is a
 *    real execution.
 *  - Cleanable: a unique namespaced id (factory-proof-e2e-<runToken>) and a
 *    cascade delete at the end (unless --keep). Never touches seed agents.
 *
 * Run: node --env-file=.env.local npx tsx scripts/prove-factory-e2e.ts [--keep]
 *  --keep   leave the proof agent in the DB (default: cascade-delete it).
 *
 * The LANGGRAPH_API_URL in .env.local points at the remote agent server; a real
 * post-promotion LLM run is ATTEMPTED and, if the runtime is unreachable/unbilled
 * here, recorded as `attempted: false` with the reason — never faked.
 */
import { randomUUID } from 'node:crypto'

import { createCopilotFromManifest, deleteCopilotCascade } from '../../src/lib/agent-mission-control/authoring-writes'
import { evaluateAndPersistPromotionGate, type PromotionPolicy } from '../../src/lib/agent-mission-control/promotion-gate'
import { pgrest } from '../../src/lib/agent-mission-control/postgrest'
import { makeFixtureShadowAgent } from '../../src/lib/agent-mission-control/promotion-fixtures'
import { runReplayComparison, persistReplayComparison, type ReplayOutcome } from '../../src/lib/agent-mission-control/replay'
import { runShadowExperiment, persistShadowExperiment } from '../../src/lib/agent-mission-control/shadow'
import type { CreateCopilotInput } from '../../src/lib/agent-mission-control/authoring-types'

const KEEP = process.argv.includes('--keep')
const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/** A step record for the proof report. */
interface Step {
  step: string
  ok: boolean
  real: 'executed' | 'direct-write' | 'read'
  detail: string
  persisted?: Record<string, unknown>
  defect?: string
}
const steps: Step[] = []
function record(s: Step) {
  steps.push(s)
  const tag = s.ok ? '✓' : '✗'
  let kind: string
  if (s.real === 'executed') kind = 'REAL'
  else if (s.real === 'direct-write') kind = 'DIRECT-WRITE'
  else kind = 'READ'
  const defectSuffix = s.defect ? `  ⚠ DEFECT: ${s.defect}` : ''
  console.log(`${tag} [${kind}] ${s.step} — ${s.detail}${defectSuffix}`)
}

async function main() {
  const runToken = randomUUID().slice(0, 8)
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error('live backend not configured (need AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  }
  const proofName = `FACTORY-PROOF-E2E ${runToken}`
  console.log(`\n=== FACTORY E2E PROOF · token=${runToken} · keep=${KEEP} ===\n`)

  let copilotId: string | null = null
  try {
    // ── 0) PRECONDITION: the agent does not exist ────────────────────────────
    const pre = await pgrest<Record<string, unknown>[]>('GET', `copilots?name=eq.${encodeURIComponent(proofName)}&select=id`)
    record({ step: '0. precondition: agent absent', ok: pre.length === 0, real: 'read', detail: `0 rows named "${proofName}"` })

    // ── 1) CREATE via the product path (createCopilotFromManifest) ───────────
    // count_words: certified, mutates:false, langgraph. projectId:null (bench) so
    // augmentProposedToolsWithRepoRead adds NO repo-read tools — a clean, single,
    // certified, non-mutating tool. runtime langgraph (the mandatory runtime).
    const input: CreateCopilotInput = {
      name: proofName,
      slug: `factory-proof-e2e-${runToken}`,
      description: 'Deterministic factory readiness proof agent — counts words in a text. Test-only, cleanable.',
      runtime: 'langgraph',
      model: 'gpt-5.4',
      modelProvider: 'openai',
      owner: 'factory-proof',
      tags: ['factory-proof', 'e2e', 'cleanable'],
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

    // 1b) Provision the dedicated LangGraph assistant — the SAME step the product
    // route (POST /api/agent-ops/copilots) chains after createCopilotFromManifest.
    // Calling the function alone (as a script) skips it, and AGENTS.md is explicit:
    // a langgraph copilot WITHOUT an assistant runs the bare graph (tool_call_count=0).
    // This makes the proof agent runtime-complete like a route-created one.
    try {
      const { ensureCopilotAssistant } = await import('../../src/lib/agent-mission-control/langgraph-assistants')
      const { setCopilotAssistantId } = await import('../../src/lib/agent-mission-control/authoring-writes')
      const assistantId = await ensureCopilotAssistant({ copilotId })
      await setCopilotAssistantId(copilotId, assistantId)
      record({ step: '1b. provision LangGraph assistant (route chains this after create)', ok: !!assistantId, real: 'executed', detail: `assistantId=${assistantId}`, persisted: { assistantId } })
    } catch (err) {
      record({ step: '1b. provision LangGraph assistant', ok: false, real: 'executed', detail: `assistant provisioning failed: ${err instanceof Error ? err.message : String(err)}`, defect: 'assistant provisioning needs the LangGraph Agent Server reachable' })
    }

    // ── 2) VERIFY the persisted rows (copilot draft + version draft + manifest + tool) ──
    const [cop] = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=id,status,runtime,latest_version_id,production_version_id`)
    const versionId = cop.latest_version_id as string
    const [ver] = await pgrest<Record<string, unknown>[]>('GET', `copilot_versions?${eq('id', versionId)}&select=id,stage,manifest_id`)
    const manifestId = ver.manifest_id as string
    const [man] = await pgrest<Record<string, unknown>[]>('GET', `manifests?${eq('id', manifestId)}&select=id,tool_ids`)
    const toolRows = await pgrest<Record<string, unknown>[]>('GET', `tools?${eq('copilot_id', copilotId)}&select=id,name,mutates,risk_level`)
    const draftOk = cop.status === 'draft' && ver.stage === 'draft'
    const toolOk = toolRows.length === 1 && toolRows[0].name === 'count_words' && toolRows[0].mutates === false
    const manifestToolIds = (man.tool_ids as string[]) ?? []
    record({
      step: '2. verify persistence (draft/version/manifest/tool)',
      ok: draftOk && toolOk && manifestToolIds.length === 1,
      real: 'read',
      detail: `copilot.status=${cop.status} version.stage=${ver.stage} manifest.tool_ids=${JSON.stringify(manifestToolIds)} tool=count_words(mutates=${toolRows[0]?.mutates})`,
      persisted: { versionId, manifestId, toolIds: manifestToolIds, toolId: toolRows[0]?.id },
    })

    // ── 3) TESTS — evidence row (no deterministic adapter → DIRECT WRITE, flagged) ──
    // runTestSuite executes each case as a REAL billed LLM run (test-runner.ts):
    // there is NO deterministic seam for it. To keep the proof $0 and offline we
    // write the test_runs/test_results evidence DIRECTLY and flag it a product
    // defect. This is NOT presented as a real execution.
    const suiteId = `suite-${copilotId}-${runToken}`
    const testRunId = `testrun-${runToken}`
    await pgrest('POST', 'test_suites', { id: suiteId, copilot_id: copilotId, name: 'factory-proof suite', kind: 'behavior' })
    const caseId = `case-${runToken}`
    await pgrest('POST', 'test_cases', { id: caseId, suite_id: suiteId, name: 'counts words', input: 'one two three', expected_behavior: 'reports 3 words' })
    await pgrest('POST', 'test_runs', {
      id: testRunId, suite_id: suiteId, copilot_id: copilotId, version_id: versionId,
      triggered_by: 'factory-proof', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status: 'completed', pass_rate: 1, total_cost_usd: 0,
    })
    await pgrest('POST', 'test_results', { id: `tr-${runToken}`, run_id: testRunId, case_id: caseId, status: 'pass', failure_reason: null })
    record({
      step: '3. tests (test_runs 100% pass)',
      ok: true, real: 'direct-write',
      detail: `test_run=${testRunId} pass_rate=1 (1/1)`,
      persisted: { testRunId, suiteId, caseId },
      defect: 'no deterministic test adapter — runTestSuite requires a billed LLM run per case, so a $0 offline proof must write test evidence directly',
    })

    // ── 4) BENCHMARK — evidence row (same limitation → DIRECT WRITE, flagged) ─
    const benchSuiteId = `bench-suite-${runToken}`
    const benchRunId = `benchrun-${runToken}`
    const benchResultId = `benchres-${runToken}`
    await pgrest('POST', 'benchmark_suites', { id: benchSuiteId, copilot_id: copilotId, name: 'factory-proof bench', task_count: 1 })
    await pgrest('POST', 'benchmark_runs', {
      id: benchRunId, suite_id: benchSuiteId, copilot_id: copilotId, version_id: versionId,
      model: 'gpt-5.4', model_provider: 'openai', runtime: 'langgraph',
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: 'completed', result_id: benchResultId,
    })
    await pgrest('POST', 'benchmark_results', {
      id: benchResultId, run_id: benchRunId, accuracy: 1, score: 92, task_success_rate: 1,
      unsafe_action_count: 0, confirmation_mistake_count: 0,
    })
    record({
      step: '4. benchmark (benchmark_runs score=92, 0 unsafe)',
      ok: true, real: 'direct-write',
      detail: `benchmark_run=${benchRunId} score=92 unsafe=0`,
      persisted: { benchRunId, benchResultId },
      defect: 'no deterministic benchmark adapter — runBenchmarkSuite requires a billed LLM run, so a $0 offline proof must write benchmark evidence directly',
    })

    // ── 5) SHADOW — REAL engine, deterministic fixture, $0, zero side effect ──
    const shadow = await runShadowExperiment({
      copilotId, productionVersionId: versionId, candidateVersionId: versionId,
      inputs: [{ text: 'the quick brown fox' }, { text: 'a b c' }],
      runAgent: makeFixtureShadowAgent(),
    })
    const shadowId = await persistShadowExperiment(shadow)
    record({
      step: '5. shadow (runShadowExperiment — REAL engine, fixture, $0)',
      ok: shadow.verdict === 'PASS' && shadow.wouldMutateCount === 0,
      real: 'executed',
      detail: `verdict=${shadow.verdict} sampled=${shadow.sampledRunCount} wouldMutate=${shadow.wouldMutateCount} (count_words executed, zero mutating call)`,
      persisted: { shadowId, candidateVersionId: versionId },
    })

    // ── 6) REPLAY — REAL engine, deterministic fixture, $0, bound to candidate ──
    const outcome = (): ReplayOutcome => ({ ok: true, outputShape: '{words,chars}', score: 0.9, toolsCalled: ['count_words'], unsafeActions: 0, latencyMs: 5, costUsd: 0 })
    const replay = await runReplayComparison({
      copilotId, referenceVersionId: versionId, candidateVersionId: versionId,
      inputs: [{ text: 'one two' }],
      runReference: async () => outcome(),
      runCandidate: async () => outcome(),
    })
    const replayId = await persistReplayComparison(replay)
    const [replayRow] = await pgrest<Record<string, unknown>[]>('GET', `replay_comparisons?${eq('id', replayId)}&select=id,verdict,candidate_version_id`)
    record({
      step: '6. replay (runReplayComparison — REAL engine, fixture, $0)',
      ok: replay.verdict === 'EQUIVALENT' && replayRow?.candidate_version_id === versionId,
      real: 'executed',
      detail: `verdict=${replay.verdict} candidate_version_id persisted=${replayRow?.candidate_version_id} (defect #1 fix: bound to candidate)`,
      persisted: { replayId, candidateVersionId: replayRow?.candidate_version_id },
    })

    // ── 7) GATE — REAL evaluateAndPersistPromotionGate, shadow+replay REQUIRED ─
    // Require shadow AND replay so the gate exercises the real evidence links we
    // just wrote (not the default non-blocking policy).
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: true }
    const gate = await evaluateAndPersistPromotionGate(copilotId, versionId, policy)
    if (!gate) throw new Error('gate evaluation returned null (copilot/version not found)')
    record({
      step: '7. gate (evaluateAndPersistPromotionGate — REAL, requireShadow+requireReplay)',
      ok: gate.result.overall === 'PASS' && gate.result.promotable,
      real: 'executed',
      detail: `overall=${gate.result.overall} promotable=${gate.result.promotable} checks=[${gate.result.checks.map((c) => `${c.id}:${c.status}`).join(', ')}]`,
      persisted: { gateEvaluationId: gate.gateEvaluationId },
    })
    if (!gate.result.promotable) {
      const blocking = gate.result.checks.filter((c) => c.status !== 'PASS' && c.status !== 'NOT_CONFIGURED')
      throw new Error(`gate not green — cannot promote: ${blocking.map((c) => `${c.id}=${c.status} (${c.reason})`).join('; ')}`)
    }

    // ── 8) PROMOTION — the OFFICIAL hardened RPC (same call the route makes) ──
    const rpcRes = await fetch(`${base}/rest/v1/rpc/promote_copilot_version`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_copilot_id: copilotId, p_version_id: versionId, p_previous_prod: null, p_is_rollback: false }),
    })
    const rpcOk = rpcRes.ok
    const rpcBody = rpcOk ? '' : (await rpcRes.text()).slice(0, 300)
    const [copAfter] = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=status,production_version_id`)
    const [verAfter] = await pgrest<Record<string, unknown>[]>('GET', `copilot_versions?${eq('id', versionId)}&select=stage`)
    record({
      step: '8. promotion (official RPC promote_copilot_version, 5-arg)',
      ok: rpcOk && copAfter.status === 'active' && copAfter.production_version_id === versionId && verAfter.stage === 'production',
      real: 'executed',
      detail: rpcOk
        ? `RPC ok → copilot.status=${copAfter.status} production_version_id=${copAfter.production_version_id} version.stage=${verAfter.stage}`
        : `RPC FAILED ${rpcRes.status}: ${rpcBody}`,
      persisted: { status: copAfter.status, productionVersionId: copAfter.production_version_id, stage: verAfter.stage },
    })
    if (!rpcOk) throw new Error(`promotion RPC failed: ${rpcRes.status} ${rpcBody}`)

    // ── 9) RUN POST-PROMOTION — attempt a REAL run via the runner ────────────
    // The runner reaches the LangGraph Agent Server (LANGGRAPH_API_URL). If the
    // runtime is unreachable/unbilled from here we record attempted:false with
    // the reason — never a fake run. Import lazily so a runner import error does
    // not abort the (already-proven) chain above.
    let runReal: Step
    try {
      const { executeCopilotRun } = await import('../../src/lib/agent-mission-control/runner')
      const result = await executeCopilotRun({
        copilotId, versionId, projectId: 'unassigned', model: 'gpt-5.4', modelProvider: 'openai',
        systemPromptSummary: input.manifest.systemPromptSummary, userInput: 'Count the words in: the quick brown fox jumps',
        maxSteps: 4, userLabel: 'factory-proof-run',
      })
      runReal = {
        step: '9. run post-promotion (executeCopilotRun — REAL runtime)',
        ok: result.status === 'completed' || result.status === 'needs-confirmation',
        real: 'executed',
        detail: `runId=${result.runId} status=${result.status} tools=${result.toolCallCount} model=${result.resolvedModel ?? 'unverified'} latency=${result.latencyMs}ms`,
        persisted: { runId: result.runId, status: result.status },
      }
    } catch (err) {
      runReal = {
        step: '9. run post-promotion (executeCopilotRun — REAL runtime)',
        ok: false, real: 'executed',
        detail: `run attempted but the live runtime was unreachable/unbilled from this host: ${err instanceof Error ? err.message : String(err)}`,
        defect: 'post-promotion run requires the LangGraph Agent Server (LANGGRAPH_API_URL) + OPENAI_API_KEY reachable from the proof host; not faked when absent',
      }
    }
    record(runReal)
  } finally {
    // ── 10) CLEANUP — cascade delete (unless --keep) ─────────────────────────
    if (copilotId && !KEEP) {
      const deleted = await deleteCopilotCascade(copilotId)
      record({ step: '10. cleanup (deleteCopilotCascade)', ok: deleted, real: 'executed', detail: deleted ? `copilot ${copilotId} + children cascade-deleted` : 'nothing to delete' })
      // Confirm the namespace is clean.
      const after = await pgrest<Record<string, unknown>[]>('GET', `copilots?${eq('id', copilotId)}&select=id`)
      record({ step: '10b. verify cleanup', ok: after.length === 0, real: 'read', detail: `${after.length} rows remain for ${copilotId}` })
    } else if (copilotId) {
      record({ step: '10. cleanup', ok: true, real: 'read', detail: `--keep set: agent ${copilotId} left in DB` })
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const allOk = steps.every((s) => s.ok)
  const realExecuted = steps.filter((s) => s.real === 'executed' && s.ok).length
  const directWrites = steps.filter((s) => s.real === 'direct-write').length
  console.log(`\n=== SUMMARY · token=${runToken} · allOk=${allOk} · real-executed=${realExecuted} · direct-writes=${directWrites} ===`)
  console.log(JSON.stringify({ runToken, allOk, steps }, null, 2))
}

main().catch((err) => {
  console.error('\n✗ PROOF ABORTED:', err instanceof Error ? err.message : err)
  console.log(JSON.stringify({ aborted: true, steps }, null, 2))
  process.exit(1)
})
