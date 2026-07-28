import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { formatPercent, type RunsMetrics } from '@/lib/runs-console/runs-metrics'

const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The 1/3 surface of the top row: success rate over runs that actually
 * finished.
 *
 * A rate needs a denominator. When no run reached a terminal state
 * (`metrics.successRate === null`) the ring is NOT drawn at 0% — the card says
 * "Not measured" and explains why, because an empty arc reads as total failure
 * to anyone glancing at it.
 *
 * The arc is literal geometry (one circle, one dash offset), not a plotted
 * series, so the Recharts rule for charts does not apply — same exemption the
 * doctrine already grants an HTML progress bar.
 */
export function RunsSuccessRing({ metrics }: { metrics: RunsMetrics }) {
  const rate = metrics.successRate

  return (
    <section className="flex flex-col rounded-2xl bg-surface-raised p-6" aria-labelledby="success-heading">
      <Subheading id="success-heading" level={2}>
        Success rate
      </Subheading>
      <Text size="xs" className="mt-1">
        Completed vs finished runs
      </Text>

      <div className="flex flex-1 flex-col items-center justify-center py-6">
        {rate === null ? (
          <>
            <div
              className="flex size-34 items-center justify-center rounded-full ring-1 ring-[var(--surface-border-strong)] ring-inset"
              aria-hidden="true"
            >
              <span className="text-sm text-zinc-400">—</span>
            </div>
            <p className="mt-4 text-sm font-medium text-white">Not measured</p>
            <Text size="2xs" className="mt-1 max-w-60 text-center">
              No run in this view has finished yet, so there is no denominator to compute a rate
              from.
            </Text>
          </>
        ) : (
          <>
            <div className="relative size-34">
              <svg
                viewBox="0 0 136 136"
                className="size-full -rotate-90"
                role="img"
                aria-label={`Success rate ${formatPercent(rate)}, ${metrics.completed} completed of ${metrics.terminal} finished runs`}
              >
                <circle
                  cx="68"
                  cy="68"
                  r={RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  className="text-zinc-800"
                />
                <circle
                  cx="68"
                  cy="68"
                  r={RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - rate)}
                  className="text-accent-500"
                />
              </svg>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-white tabular-nums"
              >
                {formatPercent(rate)}
              </span>
            </div>
            <Text size="2xs" className="mt-4">
              {metrics.completed} completed · {metrics.terminal} finished
            </Text>
          </>
        )}
      </div>

      {metrics.running > 0 ? (
        <Text size="2xs" className="text-center">
          {metrics.running} still running — excluded from the rate
        </Text>
      ) : null}
    </section>
  )
}
