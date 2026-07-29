/**
 * Canonical formatters for Agent Mission Control — the ONLY place display
 * formatting lives. Never fork a local copy in a page or component.
 *
 * One shape per concept, everywhere:
 * - percent     → `formatPercent`    → "92.7%" (0..1 ratio in, one decimal)
 * - USD         → `formatUsd`        → "$18.42"
 *
 * Deterministic: parsed straight from the ISO string in UTC — no `Date.now()`,
 * no locale, safe in render paths on both server and client.
 */

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

/** Collapse whitespace and truncate to a single-line summary (for *_summary columns). */
export function summarize(text: string, maxLen = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat
}
