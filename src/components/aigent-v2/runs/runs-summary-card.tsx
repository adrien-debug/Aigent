import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { PERIOD_LABEL, type RunsPeriod } from '@/lib/aigent-v2/runs-filters'
import { formatUsd, type RunsMetrics } from '@/lib/aigent-v2/runs-metrics'

const NOT_MEASURED = 'Not measured'

/**
 * The 2/3 surface of the top row: what this view is, followed by the four KPI
 * figures the mission names. Every number comes from `deriveRunsMetrics` over
 * the SAME filtered array the table renders — the cards cannot drift from the
 * rows.
 */
export function RunsSummaryCard({
  metrics,
  period,
  loadedCount,
  windowRunCount,
  windowTruncated,
  windowMaxRows,
  tableRowCap,
}: {
  metrics: RunsMetrics
  period: RunsPeriod
  loadedCount: number
  windowRunCount: number
  windowTruncated: boolean
  windowMaxRows: number
  tableRowCap: number
}) {
  const cost = metrics.measuredCostUsd === null ? NOT_MEASURED : formatUsd(metrics.measuredCostUsd)

  // The loader caps what it hands over. When the 24h window held MORE runs than
  // the cap, `metrics.total` is the size of a subset — labelling it as the
  // period total would be a false number.
  const capped = windowRunCount > loadedCount

  const kpis = [
    {
      label: capped ? 'Runs shown' : 'Runs in period',
      value: capped ? `${metrics.total} of ${windowRunCount}` : String(metrics.total),
      note: capped ? `${PERIOD_LABEL[period]} — newest ${loadedCount} loaded` : PERIOD_LABEL[period],
    },
    {
      label: 'Completed',
      value: String(metrics.completed),
      note: metrics.running > 0 ? `${metrics.running} still running` : undefined,
      tone: 'accent' as const,
    },
    {
      label: 'Failed / blocked',
      value: String(metrics.failed + metrics.blocked),
      note:
        metrics.failed + metrics.blocked > 0
          ? `${metrics.failed} failed · ${metrics.blocked} blocked`
          : undefined,
      tone: (metrics.failed + metrics.blocked > 0 ? 'danger' : undefined) as 'danger' | undefined,
    },
    {
      label: 'Measured cost',
      value: cost,
      note:
        metrics.unmeasuredCostRuns > 0
          ? `${metrics.unmeasuredCostRuns} run${metrics.unmeasuredCostRuns > 1 ? 's' : ''} without a measured cost`
          : undefined,
      muted: metrics.measuredCostUsd === null,
    },
  ]

  return (
    <Panel inset="md" className="flex flex-col" role="region" aria-labelledby="v2-runs-heading">
      <Heading id="v2-runs-heading" level={1}>
        Runs
      </Heading>
      <Text size="xs" className="mt-1 max-w-2xl">
        Every operational run across all agents and projects. Evaluation runs (test cases and
        benchmark tasks) are excluded, the same contract the fleet health figures use.
      </Text>

      <dl className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl bg-surface-sunken p-4 ring-1 ring-[var(--surface-border)]">
            <dt className="text-xs font-medium text-zinc-400">{kpi.label}</dt>
            <dd
              className={[
                'mt-2 font-semibold tabular-nums',
                kpi.muted ? 'text-base text-zinc-400' : 'text-2xl',
                kpi.tone === 'accent' ? 'text-accent-300' : '',
                kpi.tone === 'danger' ? 'text-[var(--state-danger-text)]' : '',
                !kpi.tone && !kpi.muted ? 'text-white' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {kpi.value}
            </dd>
            {kpi.note ? <p className="mt-1 text-[11px]/4 text-zinc-400">{kpi.note}</p> : null}
          </div>
        ))}
      </dl>

      <Text size="2xs" className="mt-4">
        {capped
          ? `The last 24 hours hold ${windowRunCount} operational runs; the newest ${loadedCount} are loaded and every figure above covers that subset only.`
          : `All ${loadedCount} operational run${loadedCount === 1 ? '' : 's'} of the last 24 hours are loaded.`}
        {windowTruncated ? ` The window read itself stopped at ${windowMaxRows} rows.` : ''}
        {capped && loadedCount >= tableRowCap ? ` Table cap: ${tableRowCap} rows.` : ''} Filters
        apply to the loaded set.
      </Text>
    </Panel>
  )
}
