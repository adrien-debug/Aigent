/**
 * Shared health-metric color semantics for copilot health surfaces.
 * (Formatting itself lives in `@/lib/agent-mission-control/format` — the
 * single source for percent/USD/duration/timestamp shapes.)
 */

/**
 * Monochrome pass-rate ink — "no news is good news": only problems glow accent,
 * a healthy rate stays calm neutral. This gives a clear 3-way separation on a
 * single hue (the value itself is always shown next to it):
 *   failing  (< 75%)  → bright accent + bold  (draws the eye)
 *   attention(75–90%) → accent
 *   healthy  (>= 90%) → neutral zinc          (recedes)
 */
export function passRateClassName(rate: number): string {
  if (rate < 0.75) return 'font-semibold text-accent-600 dark:text-accent-400'
  if (rate < 0.9) return 'text-accent-700 dark:text-accent-500'
  return 'text-zinc-700 dark:text-zinc-300'
}
