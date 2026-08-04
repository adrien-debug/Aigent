/**
 * Agent Mission Control — ReplayComparison runtime (server only).
 *
 * AIGENT-RUNTIME-PROMOTION-001, Phase 4. Replays a persisted corpus of inputs
 * on the REFERENCE (production) version and the CANDIDATE version, compares them
 * per-case, and returns a functional verdict BETTER | EQUIVALENT | WORSE |
 * INCONCLUSIVE. INCONCLUSIVE can never satisfy a mandatory replay (enforced by
 * the promotion gate).
 *
 * Determinism: when the injected runners are deterministic (the fixture path, or
 * a fully local tool chain), the comparison is deterministic and non-determinism
 * is impossible. When a case's two runs disagree in a way that is not a real
 * regression but a non-deterministic wobble, it is LABELLED `nondeterministic`,
 * never silently hidden — an honest INCONCLUSIVE beats a fabricated pass.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { pgrest } from './postgrest'
import type { IsoTimestamp } from './types'

/** The comparable outcome of running one input on one version. */
export interface ReplayOutcome {
  ok: boolean
  /** Stable shape signature of the output (e.g. sorted keys) — compared, not the raw value. */
  outputShape: string
  /** Evaluation score in [0,1], or null when not scored. */
  score: number | null
  toolsCalled: string[]
  unsafeActions: number
  latencyMs: number
  /** null when runtime usage could not be measured; never coerced to free. */
  costUsd: number | null
}

/** Runs one input on one version, side-effect free. Injected (fixture/local). */
export type ReplayRunner = (input: unknown) => Promise<ReplayOutcome>

export type CaseComparison = 'better' | 'equivalent' | 'worse' | 'nondeterministic'

export interface ReplayCaseDiff {
  input: unknown
  comparison: CaseComparison
  reference: ReplayOutcome
  candidate: ReplayOutcome
  /** Human-readable note on what differed. */
  note: string
}

export type ReplayVerdict = 'BETTER' | 'EQUIVALENT' | 'WORSE' | 'INCONCLUSIVE'

export interface ReplayComparisonRecord {
  id: string
  copilotId: string
  referenceVersionId: string
  candidateVersionId: string
  caseCount: number
  verdict: ReplayVerdict
  cases: ReplayCaseDiff[]
  createdAt: IsoTimestamp
}

/** Compare one case's two outcomes. Functional regression rules, explicit. */
function compareCase(ref: ReplayOutcome, cand: ReplayOutcome): { comparison: CaseComparison; note: string } {
  // A candidate that fails where reference succeeded is a hard regression.
  if (ref.ok && !cand.ok) return { comparison: 'worse', note: 'candidate failed where reference succeeded' }
  if (!ref.ok && cand.ok) return { comparison: 'better', note: 'candidate succeeded where reference failed' }

  // Unsafe actions: any increase is worse.
  if (cand.unsafeActions > ref.unsafeActions) return { comparison: 'worse', note: `unsafe actions ${ref.unsafeActions}→${cand.unsafeActions}` }
  if (cand.unsafeActions < ref.unsafeActions) return { comparison: 'better', note: `unsafe actions ${ref.unsafeActions}→${cand.unsafeActions}` }

  // Output shape divergence with equal scores → non-deterministic wobble, labelled.
  const shapeDiffers = ref.outputShape !== cand.outputShape

  // Score comparison when both scored.
  if (ref.score !== null && cand.score !== null) {
    if (cand.score > ref.score) return { comparison: 'better', note: `score ${ref.score}→${cand.score}` }
    if (cand.score < ref.score) return { comparison: 'worse', note: `score ${ref.score}→${cand.score}` }
  }

  if (shapeDiffers) return { comparison: 'nondeterministic', note: 'output shape differs with no score/ok/safety change' }
  return { comparison: 'equivalent', note: 'no functional difference' }
}

/**
 * Roll per-case comparisons into a verdict.
 *   - any 'worse'            → WORSE.
 *   - any 'nondeterministic' → INCONCLUSIVE (never hidden).
 *   - ≥1 'better', rest 'equivalent' → BETTER.
 *   - all 'equivalent'       → EQUIVALENT.
 *   - no cases               → INCONCLUSIVE.
 */
function rollupVerdict(cases: ReplayCaseDiff[]): ReplayVerdict {
  if (cases.length === 0) return 'INCONCLUSIVE'
  if (cases.some((c) => c.comparison === 'worse')) return 'WORSE'
  if (cases.some((c) => c.comparison === 'nondeterministic')) return 'INCONCLUSIVE'
  if (cases.some((c) => c.comparison === 'better')) return 'BETTER'
  return 'EQUIVALENT'
}

/**
 * Replay `inputs` on both versions via the injected runners and compare. Pure of
 * Date except the injected `now`. Deterministic when the runners are.
 */
export async function runReplayComparison(args: {
  copilotId: string
  referenceVersionId: string
  candidateVersionId: string
  inputs: ReadonlyArray<unknown>
  runReference: ReplayRunner
  runCandidate: ReplayRunner
  now?: () => Date
}): Promise<ReplayComparisonRecord> {
  const now = args.now ?? (() => new Date())
  const cases: ReplayCaseDiff[] = []
  for (const input of args.inputs) {
    const [reference, candidate] = await Promise.all([args.runReference(input), args.runCandidate(input)])
    const { comparison, note } = compareCase(reference, candidate)
    cases.push({ input, comparison, reference, candidate, note })
  }
  return {
    id: `replay-${randomUUID()}`,
    copilotId: args.copilotId,
    referenceVersionId: args.referenceVersionId,
    candidateVersionId: args.candidateVersionId,
    caseCount: cases.length,
    verdict: rollupVerdict(cases),
    cases,
    createdAt: now().toISOString(),
  }
}

/** Map the functional verdict to the persisted table's `status` enum. */
export function verdictToStatus(v: ReplayVerdict): 'matched' | 'diverged' | 'ready' | 'draft' {
  if (v === 'EQUIVALENT') return 'matched'
  if (v === 'WORSE' || v === 'INCONCLUSIVE') return 'diverged'
  return 'ready' // BETTER
}

/** Persist a replay comparison. Returns the row id. */
export async function persistReplayComparison(rec: ReplayComparisonRecord): Promise<string> {
  await pgrest('POST', 'replay_comparisons', {
    id: rec.id,
    copilot_id: rec.copilotId,
    source_run_id: rec.referenceVersionId,
    // The candidate this replay proves. Without it the promotion gate can only
    // read "the latest replay for the copilot" and a replay produced for
    // version A would satisfy a required replay for version B (evidence↔candidate
    // link broken). Migration 0030 adds the column; the gate filters on it.
    candidate_version_id: rec.candidateVersionId,
    created_at: rec.createdAt,
    status: verdictToStatus(rec.verdict),
    case_count: rec.caseCount,
    verdict: rec.verdict,
    candidates: rec.cases.map((c) => ({ comparison: c.comparison, note: c.note })),
  })
  return rec.id
}
