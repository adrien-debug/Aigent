/**
 * Shared health-metric color semantics for copilot health surfaces.
 * (Formatting itself lives in `@/lib/agent-mission-control/format` — the
 * single source for percent/USD/duration/timestamp shapes.)
 */

/**
 * Monochrome pass-rate ink: brightness on the single accent hue signals health.
 * Failing (< 75%) reads brightest/strongest, attention (75–90%) mid, healthy
 * (>= 90%) softest — the accompanying label always states the actual value.
 */
export function passRateClassName(rate: number): string {
  if (rate < 0.75) return 'text-accent-700 dark:text-accent-300'
  if (rate < 0.9) return 'text-accent-600 dark:text-accent-400'
  return 'text-accent-700 dark:text-accent-500'
}
