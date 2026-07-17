/**
 * AIG-TRADE-001 — Trading Council (Lot 8).
 *
 * The COMPOSITION CONTRACT that assembles the six trading copilots' reports into
 * a single council reading. It is NOT a seventh commercial agent, NOT a model,
 * NOT connected to any execution: `composeCouncil` is a PURE function of the six
 * reports (each one of the contracts.ts output shapes) and does nothing but read
 * them and fold them into a `CouncilResult`.
 *
 * The theoretical flow is a review pipeline:
 *   Atlas (structure) → Vector (robustness) → Meridian (context)
 *   → Pulse (execution) → Sentinel (risk verdict) → Sage (explanation)
 *
 * HARD RULES ENCODED HERE (and asserted in tests):
 *
 *   1. DIVERGENCES ARE CONSERVED, NEVER SMOOTHED. The council does NOT fabricate
 *      consensus. Every disagreement between members is LISTED in `divergences`.
 *      A unanimous read yields an empty `divergences`; any opposition keeps both
 *      sides on the record.
 *
 *   2. SENTINEL CAN BLOCK, AND A BLOCK IS TERMINAL. If Sentinel's verdict is
 *      'BLOCKED', the council's `finalStance` is 'BLOCKED' no matter how bullish
 *      every other member is. NO MAJORITY OVERRIDES A SAFETY RULE — there is no
 *      code path that lets Atlas/Vector/Pulse/Sage outvote a Sentinel BLOCK.
 *      (Invariant #12/#13: safety is not a vote.)
 *
 *   3. SAFETY-BY-ABSENCE. If Sentinel is absent (no risk verdict at all), the
 *      council cannot clear a trade: `finalStance` is 'INSUFFICIENT'. Silence on
 *      risk is never read as approval.
 *
 * This module imports ONLY the contract types (pure Zod-inferred shapes). It has
 * no server import, no execution, no network — reusable anywhere.
 */

import type {
  TechnicalAnalysisReport,
  QuantRegimeReport,
  MacroContextReport,
  ExecutionAssessment,
  RiskAssessment,
  EducationalLesson,
} from './contracts'

/** The six council seats, in pipeline order. */
export const COUNCIL_SEATS = [
  'atlas',
  'vector',
  'meridian',
  'pulse',
  'sentinel',
  'sage',
] as const

export type CouncilSeat = (typeof COUNCIL_SEATS)[number]

/**
 * The reports fed to the council — each an output contract from contracts.ts.
 * Every seat is optional: a member may not have reported (unavailability is
 * legitimate and must be handled, never faked).
 */
export interface CouncilReports {
  atlas?: TechnicalAnalysisReport
  vector?: QuantRegimeReport
  meridian?: MacroContextReport
  pulse?: ExecutionAssessment
  sentinel?: RiskAssessment
  sage?: EducationalLesson
}

/** Describes the fixed composition contract (documentation surface). */
export interface CouncilComposition {
  readonly seats: readonly CouncilSeat[]
  /** Pipeline order the seats are read in. */
  readonly order: readonly CouncilSeat[]
  /** Seat whose verdict is terminal and cannot be overridden by a majority. */
  readonly safetySeat: 'sentinel'
  readonly description: string
}

export const COUNCIL_COMPOSITION: CouncilComposition = {
  seats: COUNCIL_SEATS,
  order: COUNCIL_SEATS,
  safetySeat: 'sentinel',
  description:
    'Atlas→Vector→Meridian→Pulse→Sentinel→Sage. Divergences conserved; Sentinel BLOCKED is terminal; no majority overrides a safety rule.',
}

/** A recorded disagreement between two members. Never smoothed away. */
export interface CouncilDivergence {
  /** The two seats that disagree. */
  readonly between: [CouncilSeat, CouncilSeat]
  /** What they disagree about (a comparable dimension). */
  readonly dimension: string
  /** The two opposing positions, verbatim, kept on the record. */
  readonly positions: [string, string]
}

/** The final council stance. Mirrors RiskAssessment verdict + an abstain state. */
export type CouncilStance = 'ALLOWED' | 'REDUCE' | 'BLOCKED' | 'INSUFFICIENT'

export interface CouncilResult {
  readonly composition: CouncilComposition
  /** Seats that actually reported. */
  readonly present: CouncilSeat[]
  /** Seats that did NOT report — surfaced, never hidden. */
  readonly missing: CouncilSeat[]
  /** Every disagreement, listed. Empty ⇒ genuine unanimity (not fabricated). */
  readonly divergences: CouncilDivergence[]
  /** Sentinel's verdict, or null if Sentinel did not report. */
  readonly sentinelVerdict: RiskAssessment['verdict'] | null
  /** Terminal stance. BLOCKED wins over everything; INSUFFICIENT if no Sentinel. */
  readonly finalStance: CouncilStance
  /** Human-readable rationale for the final stance (audit trail). */
  readonly rationale: string
}

/** Map a directional report to a coarse lean for divergence detection. */
function leanOf(
  r: TechnicalAnalysisReport | QuantRegimeReport,
): 'bullish' | 'bearish' | 'neutral' | 'none' {
  return r.conclusion.lean
}

/**
 * Detect directional disagreements between the directional members. This does
 * NOT resolve them — it records both sides. Opposing leans (bullish vs bearish)
 * are always a divergence; a directional lean vs a Sentinel BLOCK/REDUCE is also
 * recorded so the tension is visible.
 */
function collectDivergences(reports: CouncilReports): CouncilDivergence[] {
  const out: CouncilDivergence[] = []

  const directional: Array<{ seat: CouncilSeat; lean: string; note: string }> = []
  if (reports.atlas) {
    directional.push({
      seat: 'atlas',
      lean: leanOf(reports.atlas),
      note: `atlas lean=${leanOf(reports.atlas)} (${reports.atlas.primaryScenario})`,
    })
  }
  if (reports.vector) {
    directional.push({
      seat: 'vector',
      lean: leanOf(reports.vector),
      note: `vector lean=${leanOf(reports.vector)} (confluence=${reports.vector.confluence})`,
    })
  }

  const opposed = (a: string, b: string) =>
    (a === 'bullish' && b === 'bearish') || (a === 'bearish' && b === 'bullish')

  for (let i = 0; i < directional.length; i++) {
    for (let j = i + 1; j < directional.length; j++) {
      const A = directional[i]
      const B = directional[j]
      if (opposed(A.lean, B.lean)) {
        out.push({
          between: [A.seat, B.seat],
          dimension: 'direction',
          positions: [A.note, B.note],
        })
      }
    }
  }

  // Directional bullishness vs Sentinel restraint is a divergence worth keeping.
  if (reports.sentinel && (reports.sentinel.verdict === 'BLOCKED' || reports.sentinel.verdict === 'REDUCE')) {
    for (const d of directional) {
      if (d.lean === 'bullish') {
        out.push({
          between: [d.seat, 'sentinel'],
          dimension: 'risk-vs-direction',
          positions: [
            d.note,
            `sentinel verdict=${reports.sentinel.verdict} (${reports.sentinel.justification})`,
          ],
        })
      }
    }
  }

  return out
}

/**
 * Compose the six reports into a single council result. PURE — reads the reports
 * and folds them. Never mutates, never executes, never contacts a market.
 *
 * Terminal-safety rule: `sentinel.verdict === 'BLOCKED'` ⇒ `finalStance` is
 * 'BLOCKED' regardless of every other member. No Sentinel ⇒ 'INSUFFICIENT'.
 */
export function composeCouncil(reports: CouncilReports): CouncilResult {
  const present: CouncilSeat[] = []
  const missing: CouncilSeat[] = []
  for (const seat of COUNCIL_SEATS) {
    if (reports[seat]) present.push(seat)
    else missing.push(seat)
  }

  const divergences = collectDivergences(reports)
  const sentinelVerdict = reports.sentinel ? reports.sentinel.verdict : null

  let finalStance: CouncilStance
  let rationale: string

  if (!reports.sentinel) {
    // Safety-by-absence: no risk verdict ⇒ we cannot clear a trade.
    finalStance = 'INSUFFICIENT'
    rationale =
      'No Sentinel risk verdict present — silence on risk is never read as approval; council abstains (INSUFFICIENT).'
  } else if (reports.sentinel.verdict === 'BLOCKED') {
    // TERMINAL. No majority overrides a safety BLOCK.
    finalStance = 'BLOCKED'
    rationale = `Sentinel BLOCKED (${reports.sentinel.justification}) — terminal; no member majority can override a safety rule.`
  } else if (reports.sentinel.verdict === 'UNAVAILABLE') {
    finalStance = 'INSUFFICIENT'
    rationale =
      'Sentinel risk assessment UNAVAILABLE — no trustworthy risk verdict; council abstains (INSUFFICIENT).'
  } else if (reports.sentinel.verdict === 'REDUCE') {
    finalStance = 'REDUCE'
    rationale = `Sentinel requires REDUCE (${reports.sentinel.justification}); divergences (${divergences.length}) preserved on the record.`
  } else {
    // Sentinel ALLOWED — the trade is permitted by risk, divergences still kept.
    finalStance = 'ALLOWED'
    rationale = `Sentinel ALLOWED; ${divergences.length} divergence(s) conserved (consensus is never fabricated).`
  }

  return {
    composition: COUNCIL_COMPOSITION,
    present,
    missing,
    divergences,
    sentinelVerdict,
    finalStance,
    rationale,
  }
}
