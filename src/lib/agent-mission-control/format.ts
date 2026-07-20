import type { IsoTimestamp } from '@/lib/agent-mission-control/types'

/**
 * Canonical formatters for Agent Mission Control — the ONLY place display
 * formatting lives. Never fork a local copy in a page or component.
 *
 * One shape per concept, everywhere:
 * - event time  → `formatTimestamp`  → "Jul 9, 07:12 UTC"
 * - date only   → `formatDate`       → "Jul 9, 2026"
 * - relative    → `formatRelative`   → "2h ago" (against an explicit reference)
 * - percent     → `formatPercent`    → "92.7%" (0..1 ratio in, one decimal)
 * - USD         → `formatUsd`        → "$18.42"
 * - duration    → `formatDurationMs` → "640ms" / "2.4s" / "1m 12s"
 *
 * Deterministic: parsed straight from the ISO string in UTC — no `Date.now()`,
 * no locale, safe in render paths on both server and client.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function parseIsoParts(iso: IsoTimestamp): { year: string; monthLabel: string; day: number; time: string } {
  const [date, time = ''] = iso.split('T')
  const [year, month, day] = date.split('-')
  return {
    year,
    monthLabel: MONTHS[Number(month) - 1] ?? month,
    day: Number(day),
    time: time.slice(0, 5),
  }
}

/** "2026-07-09T07:12:00Z" → "Jul 9, 07:12 UTC" — the canonical event-time shape. */
export function formatTimestamp(iso: IsoTimestamp): string {
  const { monthLabel, day, time } = parseIsoParts(iso)
  return `${monthLabel} ${day}, ${time} UTC`
}

/** "2026-07-09T07:12:00Z" → "Jul 9, 2026" — the canonical date-only shape. */
export function formatDate(iso: IsoTimestamp): string {
  const { year, monthLabel, day } = parseIsoParts(iso)
  return `${monthLabel} ${day}, ${year}`
}

/**
 * Relative time against an EXPLICIT reference timestamp (never `Date.now()`).
 * "2026-07-09T05:12:00Z" vs "2026-07-09T07:12:00Z" → "2h ago".
 */
export function formatRelative(iso: IsoTimestamp, referenceIso: IsoTimestamp): string {
  const deltaMs = Date.parse(referenceIso) - Date.parse(iso)
  const future = deltaMs < 0
  const seconds = Math.round(Math.abs(deltaMs) / 1000)

  let label: string
  if (seconds < 60) label = 'less than a minute'
  else if (seconds < 3600) label = `${Math.round(seconds / 60)}m`
  else if (seconds < 86400) label = `${Math.round(seconds / 3600)}h`
  else label = `${Math.round(seconds / 86400)}d`

  return future ? `in ${label}` : `${label} ago`
}

/**
 * 0..1 ratio → percent with fixed decimals (default 1), e.g. 0.927 → "92.7%".
 * Pass `digits: 0` only for coarse thresholds (e.g. "≥ 95%").
 */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

/**
 * USD amount → "$18.42". Pass `digits: 3` for sub-cent per-case costs.
 * `null`/`undefined` = cost not measured (e.g. a LangGraph run with no readable
 * usage) → renders "—", never "$0.00" (a fabricated free run).
 */
export function formatUsd(amount: number | null | undefined, digits = 2): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  return `$${amount.toFixed(digits)}`
}

/** Canonical duration/latency: "640ms" / "2.4s" / "1m 12s". */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/** Collapse whitespace and truncate to a single-line summary (for *_summary columns). */
export function summarize(text: string, maxLen = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat
}
