/**
 * AIG-TRADE-001 — Shadow mode (Lot 7).
 *
 * A shadow experiment runs N trading agents over ONE explicitly-identified,
 * FROZEN market input and records what each agent WOULD have produced — WITHOUT
 * ever touching a market, an order, or an account. It is the observation-only
 * mirror of `ShadowExperiment` (types.ts): same intent (compare candidates on
 * the same reality), but proven on SNAPSHOTS, never LIVE.
 *
 * HARD SAFETY CONTRACT (documented, and structurally true of this module):
 *
 *   - THIS IS NOT AN EXECUTION PATH. There is no method here that writes, sends,
 *     mutates, or proposes an order. The module exposes exactly three pure-ish
 *     functions (run / replay / compare) and a set of read-only record types.
 *     No `execute`, no `order`, no `submit`, no `place` — by design and asserted
 *     in tests. An agent's textual output may DESCRIBE a trade idea, but this
 *     harness never acts on it.
 *
 *   - EVIDENCE IS ALWAYS 'SNAPSHOT', NEVER 'LIVE'. The input is a frozen
 *     `ShadowInput` carrying its own truth (SNAPSHOT | HISTORICAL | FIXTURE —
 *     never LIVE). Every record stamps `evidenceLevel: 'SNAPSHOT'` so a consumer
 *     can never mistake a lab observation for a live one (invariant #7/#8).
 *
 *   - THE INPUT IS FROZEN AND REPLAYABLE. The same `ShadowInput` (same `inputId`
 *     + `asOf` + payload) re-runs identically: `replayShadow` reproduces the
 *     exact frozen input a record was built from, so a run is auditable and
 *     reproducible with no temporal leak (invariant #9).
 *
 *   - UNAVAILABILITY IS PROPAGATED, NEVER HIDDEN. If the injected `runAgent`
 *     throws or reports an outage, the record is stamped `unavailable` with a
 *     stated reason — never a fabricated success (invariant #8).
 *
 * The module takes an INJECTED execution function `runAgent(input) => output`
 * so it is fully testable offline: no OpenAI, no LangGraph, no network here.
 */

import type { TruthStatus } from './truth'

/** Truth statuses a shadow input may legitimately carry. NEVER 'LIVE'. */
const SHADOW_INPUT_TRUTHS: readonly TruthStatus[] = [
  'SNAPSHOT',
  'HISTORICAL',
  'FIXTURE',
]

export type ShadowInputTruth = 'SNAPSHOT' | 'HISTORICAL' | 'FIXTURE'

/**
 * An explicitly-identified, frozen input a shadow experiment runs against.
 * `truth` is asserted at construction to never be 'LIVE'. `payload` is the
 * opaque frozen market context handed to each agent (e.g. a MarketSnapshot,
 * a fixture id, a bundle of reports) — the harness does not interpret it.
 */
export interface ShadowInput<P = unknown> {
  /** Stable id of the frozen input; identical id ⇒ identical intended input. */
  readonly inputId: string
  /** Truth of the input. Guaranteed SNAPSHOT | HISTORICAL | FIXTURE, never LIVE. */
  readonly truth: ShadowInputTruth
  /** Point-in-time the input answers for (epoch ms). Frozen, never "now". */
  readonly asOf: number
  /** The frozen market context each agent sees. Opaque to the harness. */
  readonly payload: P
  /** Optional human note (scenario id, dataset label, …). */
  readonly label?: string
}

/** Identity of the agent that produced a shadow output. */
export interface ShadowAgentRef {
  readonly agentSlug: string
  readonly version: string
  readonly model: string
}

/**
 * The injected, side-effect-free execution of ONE agent over the frozen input.
 * Returns the agent's output plus its own accounting. It MUST NOT perform any
 * market action; the harness cannot enforce that inside an injected function,
 * but it never provides an order-capable surface and never acts on the output.
 */
export interface ShadowRunOutput {
  /** The agent's produced output (report, text, structured verdict…). Opaque. */
  readonly output: unknown
  /** Tool names the agent used (read-only market tools). */
  readonly toolsUsed: string[]
  readonly costUsd: number
  readonly latencyMs: number
  /** Set when the agent could not produce a trustworthy output. */
  readonly unavailable?: { reason: string }
}

export type RunAgentFn<P = unknown> = (
  agent: ShadowAgentRef,
  input: ShadowInput<P>,
) => Promise<ShadowRunOutput> | ShadowRunOutput

/** The proof level of a shadow record. Frozen to 'SNAPSHOT' — never 'LIVE'. */
export type ShadowEvidenceLevel = 'SNAPSHOT'

/**
 * One recorded shadow run: what an agent produced over the frozen input, with
 * full accounting and the frozen input echoed back so the run is replayable and
 * auditable. Read-only — there is no field here that can drive an order.
 */
export interface ShadowRecord<P = unknown> {
  readonly recordId: string
  readonly agentSlug: string
  readonly version: string
  readonly model: string
  readonly toolsUsed: string[]
  readonly costUsd: number
  readonly latencyMs: number
  readonly output: unknown
  /** Truth of the INPUT this record was produced from (never LIVE). */
  readonly inputTruth: ShadowInputTruth
  /** Proof level of THIS observation. Always 'SNAPSHOT'. */
  readonly evidenceLevel: ShadowEvidenceLevel
  /** The frozen input, echoed for replay + audit (no temporal leak). */
  readonly input: ShadowInput<P>
  /** Present iff the agent was unavailable; propagated, never hidden. */
  readonly unavailable?: { reason: string }
}

export interface ShadowExperimentResult<P = unknown> {
  readonly experimentId: string
  readonly inputId: string
  readonly inputTruth: ShadowInputTruth
  readonly asOf: number
  readonly evidenceLevel: ShadowEvidenceLevel
  readonly records: ShadowRecord<P>[]
  /** Slugs whose agent reported/threw an unavailability. Surfaced, not hidden. */
  readonly unavailableAgents: string[]
}

function assertNotLive(truth: TruthStatus): asserts truth is ShadowInputTruth {
  if (truth === 'LIVE') {
    throw new Error(
      'shadow: input truth cannot be LIVE — shadow mode observes SNAPSHOT/HISTORICAL/FIXTURE only',
    )
  }
  if (!SHADOW_INPUT_TRUTHS.includes(truth)) {
    throw new Error(`shadow: unsupported input truth "${truth}"`)
  }
}

/**
 * Build a frozen shadow input, refusing a LIVE truth. Prefer this over a raw
 * object literal so the never-LIVE invariant is enforced at the boundary.
 */
export function makeShadowInput<P>(input: {
  inputId: string
  truth: TruthStatus
  asOf: number
  payload: P
  label?: string
}): ShadowInput<P> {
  assertNotLive(input.truth)
  return {
    inputId: input.inputId,
    truth: input.truth,
    asOf: input.asOf,
    payload: input.payload,
    ...(input.label ? { label: input.label } : {}),
  }
}

let recordSeq = 0
function nextRecordId(agentSlug: string): string {
  recordSeq += 1
  return `shadow-rec-${agentSlug}-${recordSeq}`
}

/**
 * Run a shadow experiment: execute every agent over the SAME frozen input via
 * the injected `runAgent`, recording each run with SNAPSHOT evidence. No agent
 * output is ever acted upon. Unavailability (thrown or reported) is captured on
 * the record and surfaced in `unavailableAgents`, never swallowed.
 */
export async function runShadowExperiment<P>(args: {
  input: ShadowInput<P>
  agents: ShadowAgentRef[]
  runAgent: RunAgentFn<P>
  experimentId?: string
}): Promise<ShadowExperimentResult<P>> {
  const { input, agents, runAgent } = args
  // Defensive: refuse to run a LIVE-marked input even if constructed raw.
  assertNotLive(input.truth)

  const experimentId =
    args.experimentId ?? `shadow-exp-${input.inputId}-${input.asOf}`
  const records: ShadowRecord<P>[] = []
  const unavailableAgents: string[] = []

  for (const agent of agents) {
    let out: ShadowRunOutput
    try {
      out = await runAgent(agent, input)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      out = {
        output: null,
        toolsUsed: [],
        costUsd: 0,
        latencyMs: 0,
        unavailable: { reason: `runAgent threw: ${reason}` },
      }
    }

    if (out.unavailable) unavailableAgents.push(agent.agentSlug)

    records.push({
      recordId: nextRecordId(agent.agentSlug),
      agentSlug: agent.agentSlug,
      version: agent.version,
      model: agent.model,
      toolsUsed: [...out.toolsUsed],
      costUsd: out.costUsd,
      latencyMs: out.latencyMs,
      output: out.output,
      inputTruth: input.truth,
      evidenceLevel: 'SNAPSHOT',
      input,
      ...(out.unavailable ? { unavailable: out.unavailable } : {}),
    })
  }

  return {
    experimentId,
    inputId: input.inputId,
    inputTruth: input.truth,
    asOf: input.asOf,
    evidenceLevel: 'SNAPSHOT',
    records,
    unavailableAgents,
  }
}

/**
 * Reproduce the exact frozen input a record was built from. Because the input
 * is stored on the record verbatim, replay is deterministic and leak-free: the
 * same `inputId` + `asOf` come back untouched, ready to be re-run through any
 * `runAgent`. This does NOT re-execute — it returns the frozen input so a caller
 * can re-run it identically.
 */
export function replayShadow<P>(record: ShadowRecord<P>): ShadowInput<P> {
  return record.input
}

/** A per-agent view aligned on ONE input, for side-by-side comparison. */
export interface ComparedAgentOutput {
  readonly agentSlug: string
  readonly version: string
  readonly model: string
  readonly output: unknown
  readonly toolsUsed: string[]
  readonly costUsd: number
  readonly latencyMs: number
  readonly unavailable?: { reason: string }
}

export interface ShadowComparison {
  readonly inputId: string
  readonly inputTruth: ShadowInputTruth
  readonly asOf: number
  readonly evidenceLevel: ShadowEvidenceLevel
  readonly agents: ComparedAgentOutput[]
  /** True iff every compared record shares the same frozen input identity. */
  readonly sameInput: boolean
}

/**
 * Compare several agents that ran over the SAME frozen input, side by side.
 * Refuses to align records from different inputs — mixing inputs would fake a
 * comparison. `sameInput` is asserted (inputId + asOf must match across all).
 */
export function compareOnSameInput<P>(
  records: ShadowRecord<P>[],
): ShadowComparison {
  if (records.length === 0) {
    throw new Error('compareOnSameInput: no records to compare')
  }
  const first = records[0]
  const sameInput = records.every(
    (r) => r.input.inputId === first.input.inputId && r.input.asOf === first.input.asOf,
  )
  if (!sameInput) {
    throw new Error(
      'compareOnSameInput: records span different inputs — cannot compare agents on unequal ground',
    )
  }
  return {
    inputId: first.input.inputId,
    inputTruth: first.inputTruth,
    asOf: first.input.asOf,
    evidenceLevel: 'SNAPSHOT',
    sameInput: true,
    agents: records.map((r) => ({
      agentSlug: r.agentSlug,
      version: r.version,
      model: r.model,
      output: r.output,
      toolsUsed: [...r.toolsUsed],
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      ...(r.unavailable ? { unavailable: r.unavailable } : {}),
    })),
  }
}
