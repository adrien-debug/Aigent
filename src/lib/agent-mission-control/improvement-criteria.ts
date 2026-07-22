export const IMPROVEMENT_MIN_BENCHMARK_SCORE = 90
export const IMPROVEMENT_MIN_BENCHMARK_ACCURACY = 0.9

type BenchmarkSignalLike = {
  lastRun: {
    score: number
    accuracy: number
  } | null
}

export function hasBenchmarkBelowImproveTarget(benchmarks: BenchmarkSignalLike[]): boolean {
  return benchmarks.some(
    (b) =>
      b.lastRun !== null &&
      (b.lastRun.score < IMPROVEMENT_MIN_BENCHMARK_SCORE || b.lastRun.accuracy < IMPROVEMENT_MIN_BENCHMARK_ACCURACY)
  )
}
