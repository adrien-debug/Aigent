/**
 * LangGraph-process port of `src/lib/agent-mission-control/temporal-context.ts`.
 *
 * DUPLICATION IS DELIBERATE. The LangGraph Agent Server (`langgraphjs dev`) is a
 * SEPARATE Node process: it cannot import the `.ts` module, which is part of the
 * `server-only` lib tree. Same established precedent as `pgrest.mjs` and
 * `draft-spec.mjs`.
 *
 * THE TWO VERSIONS MUST STAY BYTE-IDENTICAL IN OUTPUT. Editing one without the
 * other means the two execution paths would anchor the model on two different
 * "now" strings. `tests/unit/langgraph-cost-ceiling.test.ts` asserts the two
 * builders agree on a fixed date.
 *
 * PURE + DETERMINISTIC: the reference date is a parameter, never `new Date()`
 * inside the builder. All fields are read in UTC.
 */

/** Marker used to detect an already-injected block (idempotent injection). */
export const TEMPORAL_CONTEXT_MARKER = '## Temporal context'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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
]

/**
 * Build the temporal context block for `now`.
 * @param {Date} now Reference instant. Throws on an invalid Date rather than
 *                   emitting "NaN" facts.
 * @returns {string}
 */
export function buildTemporalContext(now) {
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
 * Idempotent: repeated calls never stack two clocks.
 * @param {string} systemPrompt
 * @param {Date} now
 * @returns {string}
 */
export function withTemporalContext(systemPrompt, now) {
  if (systemPrompt.includes(TEMPORAL_CONTEXT_MARKER)) return systemPrompt
  return `${buildTemporalContext(now)}\n\n${systemPrompt}`
}
