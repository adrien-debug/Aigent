export const IMPROVEMENT_MIN_BENCHMARK_SCORE = 90
export const IMPROVEMENT_MIN_BENCHMARK_ACCURACY = 0.9

type BenchmarkSignalLike = {
  lastRun: {
    score: number | null
    accuracy: number | null
  } | null
}

export function hasBenchmarkBelowImproveTarget(benchmarks: BenchmarkSignalLike[]): boolean {
  return benchmarks.some(
    (b) =>
      b.lastRun !== null &&
      ((b.lastRun.score !== null && b.lastRun.score < IMPROVEMENT_MIN_BENCHMARK_SCORE) ||
        (b.lastRun.accuracy !== null && b.lastRun.accuracy < IMPROVEMENT_MIN_BENCHMARK_ACCURACY))
  )
}

/**
 * Minimum terminal-run sample before a deployed-runtime failure rate is
 * trusted as a real signal — a handful of started/failed pings from a
 * freshly-deployed agent must not trip the loop on noise.
 */
export const IMPROVEMENT_MIN_TELEMETRY_TERMINAL_RUNS = 5
export const IMPROVEMENT_MAX_TELEMETRY_FAILURE_RATE = 0.1

type RuntimeTelemetryLike = {
  completedRuns: number
  failedRuns: number
  failureRate: number | null
} | undefined

/**
 * True when the DEPLOYED agent's own runtime telemetry (real production pings,
 * not tests/benchmarks) shows a failure rate above target on enough terminal
 * runs to be meaningful. This is what keeps a copilot that passes every test
 * and benchmark from being reported "nothing to improve" while it is visibly
 * failing for real users — the signal was already being loaded into
 * `ImprovementSignals.runtimeTelemetry` but never consulted by the "is there
 * anything to improve" gate, so a healthy-looking test suite could mask a
 * broken deployment.
 */
export function hasRuntimeTelemetryBelowImproveTarget(telemetry: RuntimeTelemetryLike): boolean {
  if (!telemetry) return false
  const terminalRuns = telemetry.completedRuns + telemetry.failedRuns
  if (terminalRuns < IMPROVEMENT_MIN_TELEMETRY_TERMINAL_RUNS) return false
  if (telemetry.failureRate === null) return false
  return telemetry.failureRate > IMPROVEMENT_MAX_TELEMETRY_FAILURE_RATE
}
