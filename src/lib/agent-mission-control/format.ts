/**
 * Canonical formatters for Agent Mission Control — the ONLY place display
 * formatting lives. Never fork a local copy in a page or component.
 *
 * One shape per concept, everywhere:
 * - percent     → `formatPercent`    → "92.7%" (0..1 ratio in, one decimal)
 * - USD         → `formatUsd`        → "$18.42", or `Indisponible` when absent
 * - absence     → `UNAVAILABLE_LABEL` → the one word, spelled once
 *
 * Deterministic: parsed straight from the ISO string in UTC — no `Date.now()`,
 * no locale, safe in render paths on both server and client.
 *
 * NEUTRAL MODULE — this file imports NOTHING. No `server-only`, no React, no
 * I/O. That is load-bearing: `screen-primitives.tsx` and the SVG gauges import
 * `UNAVAILABLE_LABEL` from here, and a component test that reached a
 * `server-only` module would die with "This module cannot be imported from a
 * Client Component". Keep it importless.
 */

/**
 * THE word this product renders for a measurement that was never taken.
 *
 * ONE spelling, one place. It is rendered as HTML by `<Unavailable />`
 * (`src/components/console/screen-primitives.tsx`), as raw SVG `<text>` by the
 * gauges (`charts/ring-gauge.tsx` re-exports it as `UNAVAILABLE`, because an
 * SVG `<text>` cannot host a React element), and as a plain string by
 * `formatUsd` below. Those three layers cannot share a component, so they share
 * this constant instead — never a second literal.
 *
 * IT MEANS "NOT MEASURED", nothing else. A measured zero is a real `0` /
 * `$0.00`. A cell that is structurally not applicable is a different statement
 * and must not borrow this word.
 */
export const UNAVAILABLE_LABEL = 'Indisponible'

/**
 * 0..1 ratio → percent with fixed decimals (default 1), e.g. 0.927 → "92.7%".
 * Pass `digits: 0` only for coarse thresholds (e.g. "≥ 95%").
 */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

/**
 * USD amount → "$18.42". Pass `digits: 3` for sub-cent per-case costs.
 *
 * `null`/`undefined`/non-finite = cost NOT MEASURED (e.g. a LangGraph run with
 * no readable provider usage) → returns `UNAVAILABLE_LABEL`, never "$0.00" (a
 * fabricated free run) and no longer "—" (punctuation the reader cannot tell
 * apart from a layout artefact, while every screen around it spells the word).
 * A measured `0` still returns a real "$0.00".
 *
 * CONSEQUENCE FOR CALLERS: the return is display text, not a number and not
 * always a currency. Never do arithmetic on it, never parse it, and never
 * concatenate it into a sentence that presumes a "$" ("…{formatUsd(x)} / run"
 * would read "…Indisponible / run"). A caller that needs the two cases styled
 * differently must narrow the null itself and render `<Unavailable />`.
 *
 * A POSITIVE AMOUNT NEVER PRINTS AS "$0.00". `digits` is a FLOOR, not a fixed
 * width: an amount that would round away to zero gets enough decimals to show
 * its leading significant digit instead.
 *
 * This is the same lie as the fabricated `$0.00` this module already refuses,
 * arriving by rounding instead of by coalescing — and it was not theoretical:
 * measured against live `agent_runs`, 5 of the 21 most recently priced runs are
 * positive yet round to `$0.00` at two decimals (0.003135 read "$0.00" on
 * /admin/runs while the same run read "$0.0031" on /admin/agents/[id] — the
 * same field, two screens, two different claims).
 *
 * Escalating here rather than raising every caller's `digits` keeps ordinary
 * amounts at their intended width — only the values that would otherwise read
 * as zero get wider, which is exactly when the extra characters are earning
 * their place. The cap keeps a denormal from producing an absurd string.
 */
const USD_MAX_DIGITS = 8

export function formatUsd(amount: number | null | undefined, digits = 2): string {
  if (amount == null || !Number.isFinite(amount)) return UNAVAILABLE_LABEL
  let precision = digits
  if (amount !== 0) {
    for (; precision < USD_MAX_DIGITS; precision += 1) {
      if (Number(amount.toFixed(precision)) !== 0) break
    }
  }
  return `$${amount.toFixed(precision)}`
}

/** Collapse whitespace and truncate to a single-line summary (for *_summary columns). */
export function summarize(text: string, maxLen = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat
}
