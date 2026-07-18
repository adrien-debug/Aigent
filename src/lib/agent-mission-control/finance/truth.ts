/**
 * AIG-FIN-001 — Finance data truth taxonomy (Accounting Agent Factory).
 *
 * This mirrors — deliberately, by COPY not import — the provenance/freshness
 * vocabulary of `market/truth.ts` (AIG-TRADE-001). The finance layer must never
 * take a build dependency on the trading layer: the two factories evolve
 * independently, so the contract is restated here with the SAME six truth
 * labels. A datum produced by any accounting agent carries a provenance + a
 * truth status + a timestamp + a freshness age.
 *
 * INVARIANTS (spec gelée AIG-FIN-001, règles dures) :
 *   - Amounts are lossless decimal strings (`DecimalString`), NEVER floats.
 *     All arithmetic on money happens on strings via scaled BigInt — no
 *     `number` ever touches a monetary value.
 *   - A missing or stale datum is `UNAVAILABLE` with a reason — NEVER a
 *     fabricated zero, NEVER silently presented as LIVE.
 *   - Everything here is pure and deterministic: no network, no LLM, no
 *     secret, no ERP write path.
 */

import { z } from 'zod'

/** Where a finance datum physically came from. */
export type FinanceSourceType =
  | 'erp'
  | 'bank-feed'
  | 'document-ingest'
  | 'email-ingest'
  | 'csv-import'
  | 'db-snapshot'
  | 'composite'
  | 'fixture'

export const FINANCE_SOURCE_TYPES: readonly FinanceSourceType[] = [
  'erp',
  'bank-feed',
  'document-ingest',
  'email-ingest',
  'csv-import',
  'db-snapshot',
  'composite',
  'fixture',
]

/**
 * Truth status of a datum — the mission's canonical vocabulary, identical to
 * the trading factory so downstream tooling (delivery, benchmarks) reads both:
 *   LIVE        — confirmed observation answering for "now" (fresh ERP/bank read)
 *   SNAPSHOT    — confirmed-but-delayed observation (last successful sync)
 *   HISTORICAL  — frozen past observation used for evaluation, never as "now"
 *   FIXTURE     — hand-authored test data, lab-only
 *   FALLBACK    — derived/converted value with no primary confirmation
 *   UNAVAILABLE — no trustworthy value (missing, stale, or errored)
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

/** Truth statuses that represent a trustworthy, usable observation. */
export const USABLE_TRUTH: readonly TruthStatus[] = ['LIVE', 'SNAPSHOT']

/** A HISTORICAL datum is trustworthy for EVALUATION only, never as "now". */
export function isUsableNow(t: TruthStatus): boolean {
  return USABLE_TRUTH.includes(t)
}

/**
 * Provenance carried by every datum. `dataTimestamp` is when the observation
 * happened at the source; `asOf` is the point-in-time the datum answers for
 * (equal to now for LIVE, a frozen past instant for HISTORICAL). `ageMs` is
 * `asOf - dataTimestamp` and drives staleness. `maxAgeMs` is the caller's
 * tolerance; exceeding it downgrades the status to UNAVAILABLE upstream.
 */
export interface Provenance {
  /** Human source id, e.g. 'erp:xero:invoices', 'fixture:ap-baseline'. */
  readonly source: string
  readonly sourceType: FinanceSourceType
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
  sourceType: FinanceSourceType
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
  sourceType: FinanceSourceType
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

/**
 * A value bound to its provenance — the finance equivalent of the per-block
 * `SnapshotSource` pattern in `market/snapshot.ts`, usable for a single datum.
 * `value === null` ⇔ the datum is UNAVAILABLE (the provenance says why).
 */
export interface Truthed<T> {
  readonly value: T | null
  readonly provenance: Provenance
}

/** Wrap an available value with its provenance. */
export function truthed<T>(value: T, provenance: Provenance): Truthed<T> {
  return { value, provenance }
}

/** Build an explicitly UNAVAILABLE `Truthed<T>` (never a fabricated value). */
export function unavailable<T>(input: {
  source: string
  sourceType: FinanceSourceType
  asOf: number
  reason: string
}): Truthed<T> {
  return { value: null, provenance: unavailableProvenance(input) }
}

/** True when the datum is present AND its truth status is not UNAVAILABLE. */
export function isAvailable<T>(t: Truthed<T>): t is Truthed<T> & { value: T } {
  return t.value !== null && t.provenance.truth !== 'UNAVAILABLE'
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

// Lossless decimal amounts ----------------------------------------------------

/**
 * A monetary/quantity amount as a lossless decimal string: optional minus sign,
 * integer digits, optional fraction ("1250.00", "-3.145"). NEVER a float —
 * every arithmetic helper below operates on scaled BigInt, so "0.1" + "0.2" is
 * exactly "0.3".
 */
export type DecimalString = string

export const DECIMAL_STRING_REGEX = /^-?\d+(\.\d+)?$/

export function isDecimalString(s: string): boolean {
  return DECIMAL_STRING_REGEX.test(s)
}

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL_STRING_REGEX, 'must be a lossless decimal string, not a float')

function assertDecimal(s: string): void {
  if (!DECIMAL_STRING_REGEX.test(s)) {
    throw new TypeError(`invalid DecimalString: "${s}"`)
  }
}

/** Number of fraction digits of a decimal string. */
function fractionDigits(s: DecimalString): number {
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/** Convert to a BigInt scaled to `scale` fraction digits (lossless). */
function toScaledBigInt(s: DecimalString, scale: number): bigint {
  const negative = s.startsWith('-')
  const body = negative ? s.slice(1) : s
  const dot = body.indexOf('.')
  const intPart = dot === -1 ? body : body.slice(0, dot)
  const fracPart = dot === -1 ? '' : body.slice(dot + 1)
  const digits = intPart + fracPart.padEnd(scale, '0')
  const value = BigInt(digits)
  return negative ? -value : value
}

/** Format a scaled BigInt back to a canonical decimal string. */
function fromScaledBigInt(v: bigint, scale: number): DecimalString {
  const negative = v < BigInt(0)
  const abs = (negative ? -v : v).toString().padStart(scale + 1, '0')
  const intPart = abs.slice(0, abs.length - scale)
  const fracPart = scale > 0 ? abs.slice(abs.length - scale).replace(/0+$/, '') : ''
  const out = fracPart ? `${intPart}.${fracPart}` : intPart
  // Canonical form: trailing fraction zeros trimmed, "-0" normalized to "0".
  return negative && out !== '0' ? `-${out}` : out
}

/**
 * Lossless comparison of two decimal strings ("1.50" equals "1.5").
 * Returns -1, 0 or 1.
 */
export function compareDecimal(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  assertDecimal(a)
  assertDecimal(b)
  const scale = Math.max(fractionDigits(a), fractionDigits(b))
  const av = toScaledBigInt(a, scale)
  const bv = toScaledBigInt(b, scale)
  if (av < bv) return -1
  if (av > bv) return 1
  return 0
}

/** Lossless equality ("1.50" === "1.5" → true). */
export function decimalEquals(a: DecimalString, b: DecimalString): boolean {
  return compareDecimal(a, b) === 0
}

/** True when the amount is exactly zero (any representation of it). */
export function isZeroDecimal(a: DecimalString): boolean {
  return compareDecimal(a, '0') === 0
}

/**
 * Lossless string addition — the core of every balance check. No float is ever
 * produced: both operands are scaled to a common fraction length, added as
 * BigInt, and formatted back canonically.
 */
export function addDecimal(a: DecimalString, b: DecimalString): DecimalString {
  assertDecimal(a)
  assertDecimal(b)
  const scale = Math.max(fractionDigits(a), fractionDigits(b))
  return fromScaledBigInt(toScaledBigInt(a, scale) + toScaledBigInt(b, scale), scale)
}

/** Lossless subtraction: a - b. */
export function subtractDecimal(a: DecimalString, b: DecimalString): DecimalString {
  return addDecimal(a, negateDecimal(b))
}

/** Lossless negation (canonical: "-0" stays "0"). */
export function negateDecimal(a: DecimalString): DecimalString {
  assertDecimal(a)
  if (isZeroDecimal(a)) return '0'
  return a.startsWith('-') ? a.slice(1) : `-${a}`
}

/** Lossless sum of a list of decimal strings. Empty list → "0". */
export function sumDecimal(values: readonly DecimalString[]): DecimalString {
  let acc: DecimalString = '0'
  for (const v of values) acc = addDecimal(acc, v)
  return acc
}

// Currency codes --------------------------------------------------------------

/** ISO 4217 alphabetic currency code ("EUR", "USD", "GBP", "AED"…). */
export type CurrencyCode = string

export const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/

export function isCurrencyCode(s: string): boolean {
  return CURRENCY_CODE_REGEX.test(s)
}

export const currencyCodeSchema = z
  .string()
  .regex(CURRENCY_CODE_REGEX, 'must be an ISO 4217 alphabetic code, e.g. "EUR"')

// Accounting periods ----------------------------------------------------------

/** Accounting period as "YYYY-MM" ("2026-07"). Lexicographic order = time order. */
export type Period = string

export const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

export function isPeriod(s: string): boolean {
  return PERIOD_REGEX.test(s)
}

export const periodSchema = z
  .string()
  .regex(PERIOD_REGEX, 'must be an accounting period "YYYY-MM"')

/** Build a period from a year + a 1-based month. Throws on out-of-range input. */
export function makePeriod(year: number, month: number): Period {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new TypeError(`invalid period year: ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError(`invalid period month: ${month}`)
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Compare two periods chronologically. Returns -1, 0 or 1. */
export function comparePeriods(a: Period, b: Period): -1 | 0 | 1 {
  if (!isPeriod(a) || !isPeriod(b)) {
    throw new TypeError(`invalid Period: "${!isPeriod(a) ? a : b}"`)
  }
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// Calendar dates --------------------------------------------------------------

/**
 * Calendar date as "YYYY-MM-DD". Accounting dates are calendar facts (issue
 * date, due date, booking date), not instants — epoch ms stays reserved for
 * observation timestamps in `Provenance`. Lexicographic order = time order.
 */
export type IsoDateString = string

export const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isIsoDate(s: string): boolean {
  return ISO_DATE_REGEX.test(s)
}

export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_REGEX, 'must be a calendar date "YYYY-MM-DD"')

/** The accounting period a calendar date falls in. */
export function periodOfDate(date: IsoDateString): Period {
  if (!isIsoDate(date)) throw new TypeError(`invalid IsoDateString: "${date}"`)
  return date.slice(0, 7)
}
