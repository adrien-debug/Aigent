/**
 * Shared health-metric color semantics for copilot health surfaces.
 * (Formatting itself lives in `@/lib/agent-mission-control/format` — the
 * single source for percent/USD/duration/timestamp shapes.)
 */

/**
 * Doctrine color semantics for a test pass rate:
 * green = healthy (>= 90%), amber = attention (75–90%), rose = failing (< 75%).
 */
export function passRateClassName(rate: number): string {
  if (rate < 0.75) return 'text-rose-600 dark:text-rose-400'
  if (rate < 0.9) return 'text-amber-600 dark:text-amber-400'
  return 'text-green-700 dark:text-green-400'
}
