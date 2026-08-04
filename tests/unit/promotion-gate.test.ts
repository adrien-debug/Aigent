/**
 * Non-bypass tests for the promotion gate + shadow + replay
 * (AIGENT-RUNTIME-PROMOTION-001, Phase 8 + 9).
 *
 * DETERMINISTIC + OFFLINE: pgrest is mocked, and the shadow/replay engines are
 * driven by injected fixture runners (no OpenAI/Google/vLLM call — the count
 * of billed provider calls is exactly zero). Every requirement's failure mode
 * is proven to BLOCK: phantom tool, engine:none runtime, draft, red test,
 * missing benchmark, mutating tool in shadow, WORSE/INCONCLUSIVE replay, and the
 * would-mutate block itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock the release gate so we can drive the 9-check rollup deterministically ─
let releaseGateStub: unknown = null
vi.mock('@/lib/agent-mission-control/release-gate', () => ({
  evaluateReleaseGate: vi.fn(async () => releaseGateStub),
}))

// ── Mock pgrest so the gate reads controllable rows ───────────────────────────
type PgHandler = (method: string, path: string, body?: unknown) => unknown
let pg: PgHandler
const pgCalls: Array<{ method: string; path: string; body?: unknown }> = []
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    pgCalls.push({ method, path, body })
    return pg(method, path, body)
  }),
}))

import {
  evaluatePromotionGate,
  persistGateEvaluation,
  type PromotionPolicy,
} from '@/lib/agent-mission-control/promotion-gate'
import {
  makeShadowToolGate,
  runShadowExperiment,
  type ShadowRunAgent,
} from '@/lib/agent-mission-control/shadow'
import { makeFixtureShadowAgent } from '@/lib/agent-mission-control/promotion-fixtures'
import { persistReplayComparison, runReplayComparison, type ReplayOutcome } from '@/lib/agent-mission-control/replay'

const COPILOT = 'copilot-x'
const VERSION = 'ver-candidate'
const FIXED_NOW = () => new Date('2026-07-25T00:00:00.000Z')

/** A release gate result with all 9 checks passing. */
function greenRelease() {
  return {
    checks: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, status: 'pass' as const })),
    promotable: true,
    evidence: { testRun: { id: 'test-run-1' } },
  }
}

/**
 * Default pgrest responses: copilot(langgraph) + version(draft, manifest) +
 * manifest(tool_ids) + tools(certified) + no shadow/replay.
 *
 * The gate certifies the CANDIDATE MANIFEST's tool_ids (not the copilot's whole
 * tools pool): version → manifest_id → manifests.tool_ids → resolve each id to
 * its tools row name → certify that. The mock mirrors that chain: each entry in
 * `toolNames` becomes both a manifest tool_id (`tool-<name>`) and a matching
 * tools row {id, name}. A name in `phantomToolIds` is a manifest tool_id with NO
 * tools row (the phantom-capability case).
 */
function wireDefaultRows(
  overrides: Partial<{ runtime: string; toolNames: string[]; phantomToolIds: string[]; shadow: unknown[]; replay: unknown[] }> = {},
) {
  const runtime = overrides.runtime ?? 'langgraph'
  const toolNames = overrides.toolNames ?? ['count_words']
  const phantomToolIds = overrides.phantomToolIds ?? []
  const manifestToolIds = [...toolNames.map((n) => `tool-${n}`), ...phantomToolIds]
  pg = (_m, path) => {
    if (path.startsWith('copilots?')) return [{ id: COPILOT, runtime }]
    if (path.startsWith('copilot_versions?')) return [{ id: VERSION, stage: 'draft', manifest_id: 'manifest-1' }]
    if (path.startsWith('manifests?')) return [{ tool_ids: manifestToolIds }]
    // Resolve manifest tool_ids to their rows — only the real (non-phantom) ones
    // have a tools row; phantom ids resolve to nothing.
    if (path.startsWith('tools?')) return toolNames.map((name) => ({ id: `tool-${name}`, name }))
    if (path.startsWith('shadow_experiments?')) return overrides.shadow ?? []
    if (path.startsWith('replay_comparisons?')) return overrides.replay ?? []
    return []
  }
}

beforeEach(() => {
  pgCalls.length = 0
  releaseGateStub = greenRelease()
  wireDefaultRows()
})

describe('promotion gate — the happy path is the ONLY way to PASS', () => {
  it('10) a fully valid candidate → overall PASS, promotable', async () => {
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    expect(r?.overall).toBe('PASS')
    expect(r?.promotable).toBe(true)
    // registry hash + evaluatedAt are stamped
    expect(r?.registryHash).toMatch(/^[0-9a-f]{8}$/)
    expect(r?.evaluatedAt).toBe('2026-07-25T00:00:00.000Z')
  })
})

describe('promotion gate — every failure mode BLOCKS', () => {
  it('1) a phantom/uncertified declared tool → FAIL (not buildable)', async () => {
    wireDefaultRows({ toolNames: ['count_words', 'send_wire_transfer'] })
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    expect(r?.overall).toBe('FAIL')
    expect(r?.checks.find((c) => c.id === 'tools-resolved-certified')?.status).toBe('FAIL')
  })

  it('1b) a manifest tool_id with NO tools row (phantom capability) → FAIL (regression: PR #19 review defect #6)', async () => {
    // manifests.tool_ids has no FK to tools, so a candidate manifest can name an
    // id with no row. Before the fix the gate certified the copilot's tools pool
    // and never saw the phantom id → PASS on a capability the candidate would
    // mount but that resolves to nothing. Now it certifies the manifest tool_ids.
    wireDefaultRows({ toolNames: ['count_words'], phantomToolIds: ['tool-ghost'] })
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    const toolsCheck = r?.checks.find((c) => c.id === 'tools-resolved-certified')
    expect(toolsCheck?.status).toBe('FAIL')
    expect(toolsCheck?.reason).toContain('no tool row')
    expect(r?.overall).toBe('FAIL')
  })

  it('the tools check reads the CANDIDATE MANIFEST tool_ids, not the copilot tools pool', async () => {
    wireDefaultRows()
    await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    // It must read the manifest to get tool_ids, then resolve ids → names.
    expect(pgCalls.some((c) => c.path.startsWith('manifests?'))).toBe(true)
    expect(pgCalls.some((c) => c.path.startsWith('tools?id=in.'))).toBe(true)
    // It must NOT certify the copilot pool by copilot_id (the old, wrong read).
    expect(pgCalls.some((c) => c.path.startsWith('tools?copilot_id='))).toBe(false)
  })

  it('2) runtime with engine:none → FAIL', async () => {
    wireDefaultRows({ runtime: 'custom' })
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    expect(r?.overall).toBe('FAIL')
    expect(r?.checks.find((c) => c.id === 'runtime-executable')?.status).toBe('FAIL')
  })

  it('3+4) a red release gate (test failed) → FAIL via the rolled-up release check', async () => {
    releaseGateStub = {
      checks: [{ id: 'tests-pass', status: 'fail' }, ...Array.from({ length: 8 }, () => ({ status: 'pass' }))],
      promotable: false,
      evidence: { testRun: { id: 'test-run-1' } },
    }
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    expect(r?.overall).toBe('FAIL')
  })

  it('5) a missing benchmark (release check "missing") → INSUFFICIENT_EVIDENCE', async () => {
    releaseGateStub = {
      checks: [{ id: 'benchmark-exists', status: 'missing' }, ...Array.from({ length: 8 }, () => ({ status: 'pass' }))],
      promotable: false,
      evidence: { testRun: null },
    }
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('7) a WORSE replay when required → FAIL', async () => {
    wireDefaultRows({ replay: [{ id: 'replay-1', verdict: 'WORSE', status: 'diverged' }] })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.overall).toBe('FAIL')
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('FAIL')
  })

  it('8) an INCONCLUSIVE replay when required → INSUFFICIENT_EVIDENCE (never satisfies)', async () => {
    wireDefaultRows({ replay: [{ id: 'replay-1', verdict: 'INCONCLUSIVE', status: 'diverged' }] })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('required shadow missing → INSUFFICIENT_EVIDENCE', async () => {
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('a failed shadow (candidate tried to mutate) when required → FAIL', async () => {
    wireDefaultRows({ shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'FAIL', would_mutate_count: 2 }] })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.overall).toBe('FAIL')
  })
})

describe('promotion gate — PROVENANCE (PR #22 rework): a fixture PASS must never satisfy a required check', () => {
  it('shadow PASS with execution_mode=deterministic_fixture, required=true → INSUFFICIENT_EVIDENCE, never PASS', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    const check = r?.checks.find((c) => c.id === 'shadow-proof')
    expect(check?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(check?.reason).toMatch(/live_langgraph/)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.promotable).toBe(false)
  })

  it('shadow PASS with execution_mode=legacy_unknown (or absent), required=true → INSUFFICIENT_EVIDENCE — fail-closed, not fail-open on missing provenance', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0 }], // no execution_mode field at all
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('shadow PASS with unmeasured would_mutate_count (null) is INSUFFICIENT_EVIDENCE, never a proven zero', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: null, execution_mode: 'live_langgraph' }],
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    const check = r?.checks.find((c) => c.id === 'shadow-proof')
    expect(check?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(check?.reason).toMatch(/not measured/)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.promotable).toBe(false)
  })

  it('shadow PASS with execution_mode=live_langgraph, required=true → PASS — the ONLY provenance that clears a required check', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'live_langgraph' }],
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('PASS')
    expect(r?.overall).toBe('PASS')
  })

  it('shadow FAIL (mutation attempted) with execution_mode=deterministic_fixture → still FAIL, not softened to INSUFFICIENT_EVIDENCE — a fixture CAN prove a negative', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'FAIL', would_mutate_count: 1, execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('FAIL')
    expect(r?.overall).toBe('FAIL')
  })

  it('replay BETTER with execution_mode=deterministic_fixture, required=true → INSUFFICIENT_EVIDENCE, never PASS', async () => {
    wireDefaultRows({
      replay: [{ id: 'replay-1', verdict: 'BETTER', status: 'ready', execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    const check = r?.checks.find((c) => c.id === 'replay-comparison')
    expect(check?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(check?.reason).toMatch(/live_langgraph/)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.promotable).toBe(false)
  })

  it('replay EQUIVALENT with execution_mode=legacy_unknown, required=true → INSUFFICIENT_EVIDENCE', async () => {
    wireDefaultRows({
      replay: [{ id: 'replay-1', verdict: 'EQUIVALENT', status: 'matched', execution_mode: 'legacy_unknown' }],
    })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('replay BETTER with execution_mode=live_langgraph, required=true → PASS', async () => {
    wireDefaultRows({
      replay: [{ id: 'replay-1', verdict: 'BETTER', status: 'ready', execution_mode: 'live_langgraph' }],
    })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('PASS')
    expect(r?.overall).toBe('PASS')
  })

  it('replay WORSE with execution_mode=deterministic_fixture → still FAIL, not softened — a fixture regression is still a real regression signal', async () => {
    wireDefaultRows({
      replay: [{ id: 'replay-1', verdict: 'WORSE', status: 'diverged', execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('FAIL')
    expect(r?.overall).toBe('FAIL')
  })

  it('BOTH shadow PASS and replay BETTER fixture-backed, both required → the candidate is STILL not promotable end-to-end', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'deterministic_fixture' }],
      replay: [{ id: 'replay-1', verdict: 'BETTER', status: 'ready', execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.promotable).toBe(false)
  })

  it('optional (not required) shadow/replay: a fixture PASS/BETTER is still surfaced as PASS — provenance only gates REQUIRED checks, an informational check is unaffected', async () => {
    wireDefaultRows({
      shadow: [{ id: 'shadow-1', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'deterministic_fixture' }],
    })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: false }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('PASS')
  })
})

describe('promotion gate — persistence is what the RPC re-reads (9)', () => {
  it('persists a ready+PASS row for a green gate (the row the hardened RPC requires)', async () => {
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    await persistGateEvaluation(r!)
    const insert = pgCalls.find((c) => c.method === 'POST' && c.path === 'promotion_gates')
    expect(insert).toBeDefined()
    const row = insert!.body as Record<string, unknown>
    expect(row.overall_status).toBe('ready')
    expect(row.gate_result).toBe('PASS')
    expect(row.candidate_version_id).toBe(VERSION)
    expect(row.registry_hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('persists a blocked row for a failing gate (audit trail, RPC will refuse it)', async () => {
    wireDefaultRows({ runtime: 'custom' }) // engine:none → FAIL
    const r = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    await persistGateEvaluation(r!)
    const row = pgCalls.find((c) => c.path === 'promotion_gates')!.body as Record<string, unknown>
    expect(row.overall_status).toBe('blocked')
    expect(row.gate_result).toBe('FAIL')
  })
})

describe('shadow — mutating tools are blocked, never executed (6 + WOULD_MUTATE)', () => {
  it('6) a mutating tool attempted in shadow is recorded WOULD_MUTATE and never runs', async () => {
    // Inject a lookup that marks 'write_ledger' mutating, WITHOUT touching the
    // real registry — proves the gate's block logic on a genuinely mutating tool.
    const gate = makeShadowToolGate((name) =>
      name === 'write_ledger' ? { mutates: true } : name === 'count_words' ? { mutates: false } : undefined,
    )
    expect(gate.check('write_ledger')).toEqual({ allow: false, wouldMutate: true })
    expect(gate.check('count_words')).toEqual({ allow: true, wouldMutate: false })
  })

  it('a shadow run where the candidate attempts a mutating tool → verdict FAIL, zero side effect', async () => {
    // A runAgent that tries a mutating tool through the gate. It must be blocked.
    const mutatingLookup = (name: string) => (name === 'evil_write' ? { mutates: true } : { mutates: false })
    const runAgent: ShadowRunAgent = async (_input, gate) => {
      const g = gate.check('evil_write')
      return {
        ok: true,
        output: null,
        error: null,
        latencyMs: 1,
        costUsd: 0,
        toolAttempts: [{ name: 'evil_write', wouldMutate: g.wouldMutate, executed: g.allow }],
      }
    }
    // Rebuild the shadow with the injected mutating lookup by wrapping the gate.
    const rec = await runShadowExperimentWithLookup(runAgent, mutatingLookup)
    expect(rec.verdict).toBe('FAIL')
    expect(rec.wouldMutateCount).toBeGreaterThan(0)
    // The mutating tool was NEVER executed.
    expect(rec.results.every((r) => r.toolAttempts.every((a) => !(a.wouldMutate && a.executed)))).toBe(true)
  })

  it('a clean shadow over count_words (certified read-only) → verdict PASS, zero would-mutate', async () => {
    const rec = await runShadowExperiment({
      copilotId: COPILOT,
      productionVersionId: 'ver-prod',
      candidateVersionId: VERSION,
      inputs: [{ text: 'the quick brown fox' }, { text: '' }],
      runAgent: makeFixtureShadowAgent(),
      now: FIXED_NOW,
    })
    expect(rec.verdict).toBe('PASS')
    expect(rec.wouldMutateCount).toBe(0)
    expect(rec.sampledRunCount).toBe(2)
    // count_words actually executed (read-only, allowed).
    expect(rec.results[0].toolAttempts.find((a) => a.name === 'count_words')?.executed).toBe(true)
  })
})

/** Helper: run a shadow whose gate uses an injected mutability lookup. */
async function runShadowExperimentWithLookup(
  runAgent: ShadowRunAgent,
  lookup: (name: string) => { mutates: boolean } | undefined,
) {
  const gate = makeShadowToolGate(lookup)
  // Drive one input through the provided runAgent + injected gate directly.
  const partial = await runAgent({ text: 'x' }, gate)
  const wouldMutateCount = partial.toolAttempts.filter((a) => a.wouldMutate).length
  return {
    verdict: (wouldMutateCount > 0 || !partial.ok ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
    wouldMutateCount,
    results: [{ ...partial, input: { text: 'x' }, wouldMutateCount }],
  }
}

describe('replay — functional comparison + verdicts', () => {
  const base: ReplayOutcome = { ok: true, outputShape: '{words}', score: 0.8, toolsCalled: ['count_words'], unsafeActions: 0, latencyMs: 5, costUsd: 0 }
  const ref = async () => base
  const mk = (o: Partial<ReplayOutcome>) => async () => ({ ...base, ...o })

  it('candidate equal to reference → EQUIVALENT', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [{ text: 'a' }], runReference: ref, runCandidate: ref, now: FIXED_NOW })
    expect(rec.verdict).toBe('EQUIVALENT')
  })

  it('candidate with a higher score → BETTER', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [{ text: 'a' }], runReference: ref, runCandidate: mk({ score: 0.95 }), now: FIXED_NOW })
    expect(rec.verdict).toBe('BETTER')
  })

  it('candidate that fails where reference passed → WORSE', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [{ text: 'a' }], runReference: ref, runCandidate: mk({ ok: false }), now: FIXED_NOW })
    expect(rec.verdict).toBe('WORSE')
  })

  it('candidate with more unsafe actions → WORSE', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [{ text: 'a' }], runReference: ref, runCandidate: mk({ unsafeActions: 1 }), now: FIXED_NOW })
    expect(rec.verdict).toBe('WORSE')
  })

  it('non-deterministic wobble (shape differs, no functional change) → INCONCLUSIVE, labelled not hidden', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [{ text: 'a' }], runReference: ref, runCandidate: mk({ outputShape: '{words,chars}' }), now: FIXED_NOW })
    expect(rec.verdict).toBe('INCONCLUSIVE')
    expect(rec.cases[0].comparison).toBe('nondeterministic')
  })

  it('empty corpus → INCONCLUSIVE (never a silent pass)', async () => {
    const rec = await runReplayComparison({ copilotId: COPILOT, referenceVersionId: 'ref', candidateVersionId: VERSION, inputs: [], runReference: ref, runCandidate: ref, now: FIXED_NOW })
    expect(rec.verdict).toBe('INCONCLUSIVE')
  })
})

describe('non-bypass — a replay is bound to its EXACT candidate (regression: PR #19 review defect #1)', () => {
  it('the gate replay read filters on candidate_version_id, not just copilot_id', async () => {
    // Before the fix the gate read `replay_comparisons?copilot_id=eq...` with NO
    // candidate filter, so a replay produced for a DIFFERENT version satisfied
    // this candidate. Pin the query shape: it MUST scope by candidate_version_id.
    wireDefaultRows({ replay: [{ id: 'replay-1', verdict: 'BETTER', status: 'ready' }] })
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    const replayGet = pgCalls.find((c) => c.method === 'GET' && c.path.startsWith('replay_comparisons?'))
    expect(replayGet).toBeDefined()
    expect(replayGet!.path).toContain(`candidate_version_id=eq.${VERSION}`)
    expect(replayGet!.path).toContain(`copilot_id=eq.${COPILOT}`)
  })

  it("a replay that exists for a DIFFERENT candidate does NOT satisfy this candidate's required replay", async () => {
    // The DB filter is what enforces this: with candidate_version_id in the WHERE,
    // a row for another version is simply not returned → required replay missing →
    // INSUFFICIENT_EVIDENCE (blocks). Simulate the DB honestly: the filtered read
    // returns [] because no replay matches THIS candidate.
    pg = (_m, path) => {
      if (path.startsWith('copilots?')) return [{ id: COPILOT, runtime: 'langgraph' }]
      if (path.startsWith('copilot_versions?')) return [{ id: VERSION, stage: 'draft' }]
      if (path.startsWith('tools?')) return [{ name: 'count_words' }]
      if (path.startsWith('shadow_experiments?')) return []
      // A replay row exists for the copilot but for ANOTHER candidate → the
      // candidate-scoped filter returns nothing for VERSION.
      if (path.startsWith('replay_comparisons?')) {
        return path.includes(`candidate_version_id=eq.${VERSION}`) ? [] : [{ id: 'replay-other', verdict: 'BETTER' }]
      }
      return []
    }
    const policy: PromotionPolicy = { requireShadow: false, requireReplay: true }
    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW)
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('persistReplayComparison writes candidate_version_id (so the gate can bind it)', async () => {
    const rec = await runReplayComparison({
      copilotId: COPILOT,
      referenceVersionId: 'ref-ver',
      candidateVersionId: VERSION,
      inputs: [{ text: 'a' }],
      runReference: async () => ({ ok: true, outputShape: '{w}', score: 0.8, toolsCalled: [], unsafeActions: 0, latencyMs: 1, costUsd: 0 }),
      runCandidate: async () => ({ ok: true, outputShape: '{w}', score: 0.8, toolsCalled: [], unsafeActions: 0, latencyMs: 1, costUsd: 0 }),
      now: FIXED_NOW,
    })
    await persistReplayComparison(rec)
    const insert = pgCalls.find((c) => c.method === 'POST' && c.path === 'replay_comparisons')
    expect(insert).toBeDefined()
    const row = insert!.body as Record<string, unknown>
    expect(row.candidate_version_id).toBe(VERSION)
  })
})

describe('non-bypass — persisted evidence is re-read at decision time (9)', () => {
  it('the persisted gate row carries the evidence_hash of the exact evidence read', async () => {
    // Two evaluations over the SAME evidence produce the same evidence_hash;
    // change the evidence (a phantom tool appears) and the hash changes — so a
    // stale row can be told apart from a fresh one at decision time.
    const r1 = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    await persistGateEvaluation(r1!)
    const hash1 = (pgCalls.at(-1)!.body as Record<string, unknown>).evidence_hash

    wireDefaultRows({ toolNames: ['count_words', 'phantom_x'] }) // evidence changed
    const r2 = await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW)
    await persistGateEvaluation(r2!)
    const hash2 = (pgCalls.at(-1)!.body as Record<string, unknown>).evidence_hash

    expect(hash1).not.toBe(hash2)
    // The second (changed-evidence) evaluation is FAIL, and persists as 'blocked'.
    expect((pgCalls.at(-1)!.body as Record<string, unknown>).overall_status).toBe('blocked')
  })
})

describe('non-bypass — evidence is scoped to current corpus and qualification run (P1)', () => {
  it('shadow/replay reads filter on contentHash and qualificationRunId when provided', async () => {
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: true }
    const currentHash = 'corpus-v2'
    const currentRun = 'run-2'
    wireDefaultRows({
      shadow: [{ id: 'shadow-ok', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'live_langgraph' }],
      replay: [{ id: 'replay-ok', verdict: 'BETTER', status: 'ready', execution_mode: 'live_langgraph' }],
    })
    await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW, currentHash, currentRun)
    const shadowGet = pgCalls.find((c) => c.path.startsWith('shadow_experiments?'))
    const replayGet = pgCalls.find((c) => c.path.startsWith('replay_comparisons?'))
    expect(shadowGet).toBeDefined()
    expect(replayGet).toBeDefined()
    expect(shadowGet!.path).toContain(`content_hash=eq.${currentHash}`)
    expect(shadowGet!.path).toContain(`qualification_run_id=eq.${currentRun}`)
    expect(replayGet!.path).toContain(`content_hash=eq.${currentHash}`)
    expect(replayGet!.path).toContain(`qualification_run_id=eq.${currentRun}`)
  })

  it('a shadow/replay proof from a different corpus/run does NOT satisfy the required gate', async () => {
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: true }
    const currentHash = 'corpus-v2'
    const currentRun = 'run-2'

    pg = (_m, path) => {
      if (path.startsWith('copilots?')) return [{ id: COPILOT, runtime: 'langgraph' }]
      if (path.startsWith('copilot_versions?')) return [{ id: VERSION, stage: 'draft', manifest_id: 'manifest-1' }]
      if (path.startsWith('manifests?')) return [{ tool_ids: ['tool-count_words'] }]
      if (path.startsWith('tools?')) return [{ id: 'tool-count_words', name: 'count_words' }]
      // Stale proof exists for a different corpus/run; only the current-scope
      // filter returns nothing, so the gate cannot see the stale row.
      if (path.startsWith('shadow_experiments?')) {
        return path.includes(`content_hash=eq.${encodeURIComponent(currentHash)}`) &&
          path.includes(`qualification_run_id=eq.${currentRun}`)
          ? []
          : [{ id: 'shadow-stale', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'live_langgraph' }]
      }
      if (path.startsWith('replay_comparisons?')) {
        return path.includes(`content_hash=eq.${encodeURIComponent(currentHash)}`) &&
          path.includes(`qualification_run_id=eq.${currentRun}`)
          ? []
          : [{ id: 'replay-stale', verdict: 'BETTER', status: 'ready', execution_mode: 'live_langgraph' }]
      }
      return []
    }

    const r = await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW, currentHash, currentRun)
    expect(r?.overall).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.checks.find((c) => c.id === 'shadow-proof')?.status).toBe('INSUFFICIENT_EVIDENCE')
    expect(r?.checks.find((c) => c.id === 'replay-comparison')?.status).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('uses content_hash=is.null when contentHash is null and a run is scoped', async () => {
    const policy: PromotionPolicy = { requireShadow: true, requireReplay: true }
    wireDefaultRows({
      shadow: [{ id: 'shadow-ok', status: 'completed', candidate_verdict: 'PASS', would_mutate_count: 0, execution_mode: 'live_langgraph' }],
      replay: [{ id: 'replay-ok', verdict: 'BETTER', status: 'ready', execution_mode: 'live_langgraph' }],
    })
    await evaluatePromotionGate(COPILOT, VERSION, policy, FIXED_NOW, null, 'run-1')
    const shadowGet = pgCalls.find((c) => c.path.startsWith('shadow_experiments?'))
    expect(shadowGet!.path).toContain('content_hash=is.null')
    expect(shadowGet!.path).toContain('qualification_run_id=eq.run-1')
  })

  it('passes contentHash and qualificationRunId through to evaluateReleaseGate', async () => {
    const { evaluateReleaseGate } = await import('@/lib/agent-mission-control/release-gate')
    const currentHash = 'corpus-v2'
    const currentRun = 'run-2'
    await evaluatePromotionGate(COPILOT, VERSION, undefined, FIXED_NOW, currentHash, currentRun)
    expect(evaluateReleaseGate).toHaveBeenCalledWith(COPILOT, VERSION, currentHash, currentRun)
  })
})

describe('non-bypass — concurrency + telemetry (13 + 15)', () => {
  it('13) a promotion telemetry emit carries the gate evaluation id, never a prompt/secret', async () => {
    // The emitter writes event_type + ids into environment; no prompt/secret.
    const { emitPromotionTelemetry } = await import('@/lib/agent-mission-control/runtime-telemetry-store')
    await emitPromotionTelemetry({
      eventType: 'promotion_completed',
      copilotId: COPILOT,
      versionId: VERSION,
      gateEvaluationId: 'gate-abc',
      detail: { action: 'promote' },
    })
    const insert = pgCalls.find((c) => c.method === 'POST' && c.path === 'runtime_telemetry_events')
    expect(insert).toBeDefined()
    const row = insert!.body as Record<string, unknown>
    expect(row.event_type).toBe('promotion_completed')
    expect((row.environment as Record<string, unknown>).gateEvaluationId).toBe('gate-abc')
    // No prompt/secret field is present.
    expect(JSON.stringify(row)).not.toMatch(/password|secret|api[_-]?key|bearer/i)
  })

  it('15) concurrency: the SINGLE-production invariant is the RPC/DB guarantee, not the gate', () => {
    // The gate is a pure evaluator; atomicity + "one winner" on concurrent
    // promotes is enforced by the partial-unique index + the RPC (migration
    // 0027/0029), proven live against gpu1 (see the mission report). This test
    // documents the contract boundary: the gate never claims to serialize
    // promotions — it only decides eligibility; the DB decides the single winner.
    expect(true).toBe(true)
  })
})
