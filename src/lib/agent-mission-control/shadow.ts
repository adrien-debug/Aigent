/**
 * Agent Mission Control — generic ShadowExperiment runtime (server only).
 *
 * AIGENT-RUNTIME-PROMOTION-001, Phase 3. Runs a CANDIDATE version over allowed
 * inputs WITHOUT any external effect: every mutating tool call is refused and
 * recorded as WOULD_MUTATE, never executed. Results, errors, cost, latency and
 * steps are captured so a shadow can PROVE a candidate before it is ever allowed
 * near production — a shadow is never LIVE.
 *
 * Design follows market/shadow.ts's invariants (frozen input, INJECTED runAgent
 * that has no side effects, evidence-not-hidden) but is generic to any agent
 * version and PERSISTS to shadow_experiments (unlike the trading harness, which
 * is in-memory only). The mutating-tool gate is authoritative: it consults the
 * canonical registry's `mutates` field, so a tool the registry marks mutating
 * can never fire in a shadow, whatever the DB row says.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { pgrest } from './postgrest'
import { getTool } from './registry/tools'
import type { IsoTimestamp } from './types'

/** One tool the candidate tried to call during a shadow run. */
export interface ShadowToolAttempt {
  name: string
  /** True when the registry marks this tool mutating → it was BLOCKED, not run. */
  wouldMutate: boolean
  /** For a non-mutating (read-only) tool: whether it actually executed. */
  executed: boolean
}

/** The result of running the candidate on ONE input, side-effect free. */
export interface ShadowRunResult {
  input: unknown
  ok: boolean
  output: unknown
  error: string | null
  latencyMs: number
  costUsd: number
  toolAttempts: ShadowToolAttempt[]
  /** Count of mutating tools that WOULD have fired but were blocked. */
  wouldMutateCount: number
}

/**
 * The injected agent function a shadow drives. It MUST be side-effect free from
 * the caller's perspective: the caller supplies a run that goes through
 * `shadowToolGate` for every tool, so a mutating tool cannot fire. This is the
 * same "inject the runner" seam market/shadow.ts uses to stay offline-testable.
 */
export type ShadowRunAgent = (input: unknown, gate: ShadowToolGate) => Promise<Omit<ShadowRunResult, 'input' | 'wouldMutateCount'>>

/**
 * The gate a shadow hands to the run: call it BEFORE executing any tool. It
 * returns whether the tool may run. A mutating tool always returns
 * `{ allow: false, wouldMutate: true }` and the run must record it, never
 * execute it. This is the single chokepoint that guarantees no side effect.
 */
export interface ShadowToolGate {
  check(toolName: string): { allow: boolean; wouldMutate: boolean }
}

/** Minimal shape the gate needs from a tool: whether it mutates. */
export interface ToolMutabilityLookup {
  (toolName: string): { mutates: boolean } | undefined
}

/** The default lookup: the canonical registry is the authority on `mutates`. */
const registryMutabilityLookup: ToolMutabilityLookup = (name) => {
  const t = getTool(name)
  return t ? { mutates: t.mutates } : undefined
}

/**
 * Build the authoritative gate. By default the canonical registry decides
 * `mutates`. A `lookup` may be injected (tests use this to prove the
 * mutating-block path against a synthetic mutating tool WITHOUT adding one to
 * the real registry — the registry is the runtime authority, not a test
 * fixture). The block logic is identical either way.
 */
export function makeShadowToolGate(lookup: ToolMutabilityLookup = registryMutabilityLookup): ShadowToolGate {
  return {
    check(toolName: string) {
      const t = lookup(toolName)
      // Unknown tool → not runnable in shadow either (fail-closed), but it is
      // not a mutation; the run records it as blocked-non-mutating.
      if (!t) return { allow: false, wouldMutate: false }
      if (t.mutates) return { allow: false, wouldMutate: true }
      return { allow: true, wouldMutate: false }
    },
  }
}

export type ShadowVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE'

export interface ShadowExperimentRecord {
  id: string
  copilotId: string
  productionVersionId: string
  candidateVersionId: string
  status: 'running' | 'completed' | 'stopped'
  sampledRunCount: number
  wouldMutateCount: number
  verdict: ShadowVerdict
  results: ShadowRunResult[]
  startedAt: IsoTimestamp
  endsAt: IsoTimestamp | null
}

/**
 * Run a shadow experiment: drive `runAgent` over every input, through the gate,
 * with ZERO external effects. Deterministic given a deterministic `runAgent`
 * (the FixtureModelAdapter path) — no clock inside except the injected `now`.
 *
 * Success criterion (the candidate verdict):
 *   - PASS  → every input produced ok=true AND zero would-mutate breaches.
 *   - FAIL  → any input errored, or any mutating tool was attempted (a candidate
 *             that tries to mutate in shadow is not promotable).
 *   - INSUFFICIENT_EVIDENCE → no inputs to run over.
 */
export async function runShadowExperiment(args: {
  copilotId: string
  productionVersionId: string
  candidateVersionId: string
  inputs: ReadonlyArray<unknown>
  runAgent: ShadowRunAgent
  now?: () => Date
}): Promise<ShadowExperimentRecord> {
  const now = args.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const gate = makeShadowToolGate()

  const results: ShadowRunResult[] = []
  for (const input of args.inputs) {
    const partial = await args.runAgent(input, gate)
    const wouldMutateCount = partial.toolAttempts.filter((a) => a.wouldMutate).length
    results.push({ input, ...partial, wouldMutateCount })
  }

  const wouldMutateTotal = results.reduce((sum, r) => sum + r.wouldMutateCount, 0)
  const anyError = results.some((r) => !r.ok)

  let verdict: ShadowVerdict
  if (results.length === 0) verdict = 'INSUFFICIENT_EVIDENCE'
  else if (anyError || wouldMutateTotal > 0) verdict = 'FAIL'
  else verdict = 'PASS'

  return {
    id: `shadow-${randomUUID()}`,
    copilotId: args.copilotId,
    productionVersionId: args.productionVersionId,
    candidateVersionId: args.candidateVersionId,
    status: 'completed',
    sampledRunCount: results.length,
    wouldMutateCount: wouldMutateTotal,
    verdict,
    results,
    startedAt,
    endsAt: now().toISOString(),
  }
}

/** Persist a completed shadow experiment. Returns the row id. Fail-soft-agnostic. */
export async function persistShadowExperiment(rec: ShadowExperimentRecord): Promise<string> {
  await pgrest('POST', 'shadow_experiments', {
    id: rec.id,
    copilot_id: rec.copilotId,
    name: `shadow ${rec.candidateVersionId}`,
    production_version_id: rec.productionVersionId,
    candidate_version_id: rec.candidateVersionId,
    started_at: rec.startedAt,
    ends_at: rec.endsAt,
    status: rec.status,
    sampled_run_count: rec.sampledRunCount,
    agreement_rate: 0,
    agreement_threshold: 0.95,
    unsafe_proposal_count: 0,
    would_mutate_count: rec.wouldMutateCount,
    candidate_verdict: rec.verdict,
    // Store the per-run tool attempts as the mismatch/evidence payload.
    mismatches: rec.results.map((r) => ({ input: r.input, ok: r.ok, wouldMutate: r.wouldMutateCount, error: r.error })),
  })
  return rec.id
}
