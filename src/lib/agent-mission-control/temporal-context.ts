/**
 * Agent Mission Control — temporal anchoring for run prompts.
 *
 * A model with no explicit clock silently falls back to its training-data
 * intuition of "now" (observed in production: a model asserting it was
 * November in the middle of May). Any reasoning about "this quarter", "next
 * month" or a deadline is then wrong in a way that reads as confident.
 *
 * This module builds a short, neutral, provider-agnostic block prepended to
 * the system prompt of the direct model-router path. Deliberately domain-free:
 * no commercial calendar, no locale-specific events — only the date facts.
 *
 * MIRRORED IN `src/langgraph/temporal-context.mjs` — the LangGraph Agent Server
 * is a separate Node process that cannot import this `server-only` lib tree, so
 * the builder is duplicated there (precedent: `pgrest.mjs`, `draft-spec.mjs`).
 * THE TWO MUST PRODUCE IDENTICAL OUTPUT: change one, change the other.
 *
 * PURE + DETERMINISTIC: the reference date is a parameter, never `new Date()`
 * inside the builder, so the output is fully testable. All fields are read in
 * UTC so the block does not drift with the server's timezone.
 */

/** Marker used to detect an already-injected block (idempotent injection). */
export const TEMPORAL_CONTEXT_MARKER = '## Temporal context'

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * Build the temporal context block for `now`.
 *
 * @param now Reference instant. Callers pass `new Date()`; tests pass a fixed
 *            date. Throws on an invalid Date rather than emitting "NaN" facts.
 */
export function buildTemporalContext(now: Date): string {
  const ms = now.getTime()
  if (!Number.isFinite(ms)) {
    throw new Error('buildTemporalContext: invalid reference date')
  }

  const iso = now.toISOString()
  const isoDate = iso.slice(0, 10)
  const weekday = WEEKDAYS[now.getUTCDay()]
  const month = MONTHS[now.getUTCMonth()]
  const year = now.getUTCFullYear()
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1

  return [
    TEMPORAL_CONTEXT_MARKER,
    `Current date: ${isoDate} (${weekday}, ${month} ${now.getUTCDate()}, ${year}), UTC.`,
    `Current month: ${month} ${year}. Current quarter: Q${quarter} ${year}.`,
    `Full timestamp: ${iso}`,
    'Treat this as the single source of truth for "now". Never assume a different date, month, quarter or year from your training data. If a task depends on a date you have not been given, say so instead of guessing.',
  ].join('\n')
}

/**
 * Prepend the temporal block to a system prompt, unless one is already there.
 * Idempotent: repeated calls (or a prompt authored with its own block) never
 * stack two clocks, which would be ambiguous for the model.
 */
export function withTemporalContext(systemPrompt: string, now: Date): string {
  if (systemPrompt.includes(TEMPORAL_CONTEXT_MARKER)) return systemPrompt
  return `${buildTemporalContext(now)}\n\n${systemPrompt}`
}
