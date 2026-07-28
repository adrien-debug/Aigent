/**
 * AIG-REALESTATE-001 — Real-estate data truth taxonomy (Aigent side).
 *
 * Mirrors — deliberately, by COPY not import — the freshness/source vocabulary
 * of the trading domain (`../market/truth.ts`), so the two factories share one
 * discipline without a build dependency between them. The label set is a strict
 * subset of the market one, so a real-estate datum can be reasoned about with
 * the same provenance machinery.
 *
 * Contract carried straight over from `valuation-agent.spec.md` §8/§15:
 * every datum carries a provenance + a truth status + a timestamp + a freshness
 * age. A missing or stale official value (cadastre / DVF) is `UNAVAILABLE` —
 * NEVER a fabricated number, NEVER an estimate disguised as an official value,
 * NEVER silently presented as LIVE. Prices are lossless decimal STRINGS
 * (spec §6: `centralValueEur`/`adjustedValueEur`/`amountEur` are decimal
 * strings, never float) — no valuation is ever computed on a `number` price.
 *
 * Why DVF is never `LIVE`: DVF (Demandes de Valeurs Foncières) is published by
 * the DGFiP on a ~semestrial cadence and lags the actual signature by ~6 months
 * (audit finding). A confirmed past mutation is therefore `HISTORICAL` — a real
 * observation that answers for a frozen past instant — and must never be
 * rendered as "the price now".
 */

/** Where a real-estate datum physically came from. */
export type RealEstateSourceType =
  | 'dvf' // Demandes de Valeurs Foncières (DGFiP / Etalab open data)
  | 'cadastre' // API Carto cadastre IGN
  | 'ban' // Base Adresse Nationale geocoding (data.geopf.fr)
  | 'dpe' // ADEME DPE observatory
  | 'georisques' // BRGM / MTE risk API
  | 'apify-scrape' // portal listings scraped via Apify (asking prices, NOT signed)
  | 'composite' // several official sources merged
  | 'fixture' // hand-authored lab data

/**
 * Truth status of a real-estate datum — same canonical vocabulary as the
 * trading domain, minus `SNAPSHOT` (no real-time official source exists here):
 *   LIVE        ← only for a genuinely current source (rare here; e.g. a live
 *                 geocode). DVF/cadastre are never LIVE.
 *   HISTORICAL  ← a confirmed past observation (a DVF mutation, a filed DPE) —
 *                 the normal status for official comparables.
 *   FIXTURE     ← hand-authored test data, lab-only.
 *   FALLBACK    ← derived/converted with no primary confirmation (e.g. a
 *                 computed €/m² from a mutation whose surface was inferred).
 *   UNAVAILABLE ← no trustworthy value (source down, out of coverage, stale).
 */
export type TruthStatus =
  | 'LIVE'
  | 'HISTORICAL'
  | 'FIXTURE'
  | 'FALLBACK'
  | 'UNAVAILABLE'

/**
 * Provenance carried by every datum. `dataTimestamp` is when the observation
 * happened at the source (e.g. the DVF mutation date); `asOf` is the
 * point-in-time the datum answers for. `ageMs` is `asOf - dataTimestamp` and
 * drives staleness. `maxAgeMs` is the caller's tolerance; exceeding it
 * downgrades a real-time status to UNAVAILABLE (HISTORICAL/FIXTURE are exempt —
 * a frozen past observation is not "stale", it is simply old by design).
 */
export interface Provenance {
  /** Human source id, e.g. 'dvf:app.dvf.etalab.gouv.fr', 'fixture:antibes'. */
  readonly source: string
  readonly sourceType: RealEstateSourceType
  readonly truth: TruthStatus
  /** Epoch ms of the observation at the source (DVF mutation date, etc.). */
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
  sourceType: RealEstateSourceType
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
    // HISTORICAL is intentionally exempt: DVF is old by design, that is what
    // it is FOR — never a reason to blank it out.
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
  sourceType: RealEstateSourceType
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
