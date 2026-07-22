/**
 * AIG-TRADE-001 — Trading data truth taxonomy (Aigent side).
 *
 * This mirrors — deliberately, by COPY not import — the freshness/source
 * vocabulary that the TradeAgent repo already defines in
 * `src/lib/market-data/types.ts`. The two repos are separate git trees; Aigent
 * must never take a build dependency on TradeAgent's source. So we restate the
 * contract here, keeping the label set a strict SUPERSET-compatible subset:
 * every value below maps 1:1 onto a TradeAgent `Freshness`/`SourceType`, so a
 * snapshot produced here can be handed to TradeAgent (Lot 10 delivery) without
 * translation.
 *
 * INVARIANT #7/#8 (PRODUCT-TRUTH): every datum carries a provenance + a truth
 * status + a timestamp + a freshness age. A datum that is missing or stale is
 * `UNAVAILABLE` / `STALE` — NEVER a fabricated zero, NEVER silently presented
 * as LIVE. No financial decision is ever taken on a `number` price; prices are
 * lossless decimal strings.
 */

/** Where a datum physically came from. Mirrors TradeAgent `SourceType`. */
export type MarketSourceType =
  | 'binance'
  | 'the-graph'
  | 'rpc'
  | 'db-snapshot'
  | 'composite'
  | 'fixture'

/**
 * Truth status of a datum — the mission's canonical vocabulary (prompt §7).
 * These map onto TradeAgent's finer `Freshness` set:
 *   LIVE        ← LIVE
 *   SNAPSHOT    ← INDEXED | CACHED (a confirmed-but-delayed observation)
 *   HISTORICAL  ← a frozen past observation used for evaluation (never "now")
 *   FIXTURE     ← SIMULATED (hand-authored test data, lab-only)
 *   FALLBACK    ← ESTIMATED (derived/converted, no primary confirmation)
 *   UNAVAILABLE ← UNAVAILABLE | ERROR | STALE (no trustworthy value)
 */
export type TruthStatus =
  | 'LIVE'
  | 'SNAPSHOT'
  | 'HISTORICAL'
  | 'FIXTURE'
  | 'FALLBACK'
  | 'UNAVAILABLE'

export const TRUTH_STATUSES: readonly TruthStatus[] = [
  'LIVE',
  'SNAPSHOT',
  'HISTORICAL',
  'FIXTURE',
  'FALLBACK',
  'UNAVAILABLE',
]

/** TradeAgent freshness labels, restated for lossless mapping at delivery. */
export type TradeAgentFreshness =
  | 'LIVE'
  | 'INDEXED'
  | 'CACHED'
  | 'ESTIMATED'
  | 'SIMULATED'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'ERROR'

/**
 * Provenance carried by every datum. `dataTimestamp` is when the observation
 * happened at the source; `asOf` is the point-in-time the datum answers for
 * (equal to now for LIVE, a frozen past instant for HISTORICAL). `ageMs` is
 * `asOf - dataTimestamp` and drives staleness. `maxAgeMs` is the caller's
 * tolerance; exceeding it downgrades the status to UNAVAILABLE upstream.
 */
export interface Provenance {
  /** Human source id, e.g. 'tradeagent:/api/market/candles', 'fixture:trend-up'. */
  readonly source: string
  readonly sourceType: MarketSourceType
  readonly truth: TruthStatus
  /** Epoch ms of the observation at the source. */
  readonly dataTimestamp: number
  /** Epoch ms the datum answers for (now for LIVE, frozen for HISTORICAL). */
  readonly asOf: number
  /** asOf - dataTimestamp, clamped to >= 0. */
  readonly ageMs: number
  /** Caller-declared max acceptable age; null = no bound. */
  readonly maxAgeMs: number | null
  /** Source-declared confidence in [0,1]. Missing data → 0. */
  readonly confidence: number
  /** Only set when truth === 'UNAVAILABLE': why. */
  readonly unavailableReason?: string
}

/** Build a provenance for an available datum, computing age + staleness. */
export function makeProvenance(input: {
  source: string
  sourceType: MarketSourceType
  truth: TruthStatus
  dataTimestamp: number
  asOf: number
  maxAgeMs: number | null
  confidence: number
}): Provenance {
  const ageMs = Math.max(0, input.asOf - input.dataTimestamp)
  let truth = input.truth
  let unavailableReason: string | undefined
  if (
    input.maxAgeMs !== null &&
    ageMs > input.maxAgeMs &&
    truth !== 'HISTORICAL' &&
    truth !== 'FIXTURE'
  ) {
    // A real-time datum older than tolerance is not trustworthy as "now".
    truth = 'UNAVAILABLE'
    unavailableReason = `stale: age ${ageMs}ms > maxAge ${input.maxAgeMs}ms`
  }
  return {
    source: input.source,
    sourceType: input.sourceType,
    truth,
    dataTimestamp: input.dataTimestamp,
    asOf: input.asOf,
    ageMs,
    maxAgeMs: input.maxAgeMs,
    confidence: truth === 'UNAVAILABLE' ? 0 : clamp01(input.confidence),
    ...(unavailableReason ? { unavailableReason } : {}),
  }
}

/** Build a provenance marking a datum explicitly UNAVAILABLE (never a fake 0). */
export function unavailableProvenance(input: {
  source: string
  sourceType: MarketSourceType
  asOf: number
  reason: string
}): Provenance {
  return {
    source: input.source,
    sourceType: input.sourceType,
    truth: 'UNAVAILABLE',
    dataTimestamp: input.asOf,
    asOf: input.asOf,
    ageMs: 0,
    maxAgeMs: null,
    confidence: 0,
    unavailableReason: input.reason,
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
