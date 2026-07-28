'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { RunsActivityPanel } from '@/components/aigent-v2/runs/runs-activity-panel'
import { RunsCardList } from '@/components/aigent-v2/runs/runs-card-list'
import { RunsEmptyState } from '@/components/aigent-v2/runs/runs-empty-state'
import { RunsFilters, type FilterOption } from '@/components/aigent-v2/runs/runs-filters'
import { RunsSummaryCard } from '@/components/aigent-v2/runs/runs-summary-card'
import { RunsSuccessRing } from '@/components/aigent-v2/runs/runs-success-ring'
import { RunsTable } from '@/components/aigent-v2/runs/runs-table'
import { toRunRowModel } from '@/components/aigent-v2/runs/run-row-model'
import { V2Sidebar } from '@/components/aigent-v2/shell/v2-sidebar'
import { V2Topbar } from '@/components/aigent-v2/shell/v2-topbar'
import { Panel } from '@/components/ui/panel'
import { SidebarLayout } from '@/components/ui/sidebar-layout'
import { Subheading } from '@/components/ui/heading'
import { deriveAgentActivity } from '@/lib/aigent-v2/runs-activity'
import {
  DEFAULT_RUNS_FILTERS,
  applyRunsFilters,
  hasActiveFilters,
  serializeRunsFilters,
  type RunsFilterState,
} from '@/lib/aigent-v2/runs-filters'
import { deriveRunsMetrics } from '@/lib/aigent-v2/runs-metrics'
import type { RunsPageData } from '@/lib/aigent-v2/runs-page-data'

/** Debounce only the URL write — filtering itself stays instant on every keystroke. */
const URL_SYNC_DELAY_MS = 250

export function RunsView({
  data,
  initialFilters,
}: {
  data: RunsPageData
  initialFilters: RunsFilterState
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [filters, setFilters] = useState<RunsFilterState>(initialFilters)

  /**
   * `syncedTo` is the querystring the URL currently reflects — STATE, not a
   * ref. It does two jobs at once:
   *
   *  - it debounces the WRITE, so a shared link reproduces the exact view
   *    without pushing one history entry per keystroke;
   *  - it makes the URL AUTHORITATIVE when it changes under us. A
   *    search-param-only navigation does not remount this component (Next keys
   *    the segment without search params), so from `?status=failed&q=timeout`,
   *    clicking the rail's "Runs" entry — which points at the bare route —
   *    cleaned the address bar while the table kept showing only failed runs.
   *    The address bar then advertised the whole fleet while the screen showed
   *    a filtered slice, and that link, sent to a colleague, rendered
   *    different numbers.
   *
   * Render-phase reset (React's documented "adjust state when a prop changes")
   * so no filtered frame is painted after the URL already said otherwise. It
   * has to be state rather than a ref: writing a ref during render is exactly
   * what `react-hooks/refs` forbids, and the value genuinely participates in
   * rendering the next frame.
   */
  const incoming = serializeRunsFilters(initialFilters)
  const [syncedTo, setSyncedTo] = useState(incoming)

  /**
   * Adopt the URL only when the PROP ITSELF changes — compared against its own
   * previous value, never against `syncedTo`.
   *
   * Comparing against `syncedTo` looked equivalent and was not: every time the
   * component wrote the URL, `syncedTo` moved while `initialFilters` still held
   * the value the server last rendered, so the very next render saw a
   * difference and reset the user's filters back to the initial ones. The
   * filter would apply, the URL would update, and the selection would snap
   * back. Caught by the period test, which recorded one write instead of two.
   */
  const [lastIncoming, setLastIncoming] = useState(incoming)
  if (incoming !== lastIncoming) {
    setLastIncoming(incoming)
    setFilters(initialFilters)
    setSyncedTo(incoming)
  }

  useEffect(() => {
    const qs = serializeRunsFilters(filters)
    if (qs === syncedTo) return
    const timer = setTimeout(() => {
      setSyncedTo(qs)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, URL_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
  }, [filters, syncedTo, pathname, router])

  const filterContext = useMemo(
    () => ({
      agentNameById: data.agentNameById,
      projectNameById: data.projectNameById,
      nowMs: data.nowMs,
    }),
    [data.agentNameById, data.projectNameById, data.nowMs]
  )

  // ONE filtered array feeds the KPI cards, the ring, the table and the
  // activity panel — no surface recomputes its own idea of "the runs".
  const visibleRuns = useMemo(
    () => applyRunsFilters(data.runs, filters, filterContext),
    [data.runs, filters, filterContext]
  )

  const metrics = useMemo(() => deriveRunsMetrics(visibleRuns), [visibleRuns])
  const activity = useMemo(
    () => deriveAgentActivity(visibleRuns, data.agentNameById),
    [visibleRuns, data.agentNameById]
  )
  const rows = useMemo(
    () => visibleRuns.map((run) => toRunRowModel(run, data.agentNameById, data.projectNameById)),
    [visibleRuns, data.agentNameById, data.projectNameById]
  )

  // Options come from the LOADED runs, so a filter can only offer values that
  // actually occur — never a catalogue entry with zero runs behind it.
  const agentOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>()
    for (const run of data.runs) {
      seen.set(run.copilotId, data.agentNameById.get(run.copilotId) ?? run.copilotId)
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .toSorted((a, b) => a.label.localeCompare(b.label))
  }, [data.runs, data.agentNameById])

  const projectOptions = useMemo<FilterOption[]>(() => {
    const seen = new Map<string, string>()
    for (const run of data.runs) {
      if (!run.projectId) continue
      seen.set(run.projectId, data.projectNameById.get(run.projectId) ?? run.projectId)
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .toSorted((a, b) => a.label.localeCompare(b.label))
  }, [data.runs, data.projectNameById])

  const patchFilters = useCallback((patch: Partial<RunsFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const resetFilters = useCallback(() => setFilters({ ...DEFAULT_RUNS_FILTERS }), [])
  const filtersActive = hasActiveFilters(filters)

  return (
    // The topbar is rendered ONCE, inside the content column. Passing it to
    // SidebarLayout's `navbar` slot as well put a second copy in the DOM at
    // every width — two search fields and two account menus, one of them merely
    // hidden by CSS. The slot keeps only a spacer so the mobile header still
    // carries its burger button.
    <SidebarLayout navbar={<div className="min-w-0 flex-1" />} sidebar={<V2Sidebar />}>
      <div className="flex flex-col gap-4">
        <V2Topbar
          nowIso={data.nowIso}
          viewer={data.viewer}
          search={filters.q}
          onSearchChange={(q) => patchFilters({ q })}
        />

        {data.degraded.length > 0 ? (
          // A degraded read is not a failure of the run data, so it does NOT
          // wear the danger role — that one is reserved for real failures
          // (`check:danger`). It is a disclosure, in the neutral plane.
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl bg-surface-sunken px-4 py-3 ring-1 ring-[var(--surface-border-strong)]"
          >
            <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-zinc-300" aria-hidden="true" />
            <p className="text-xs/5 text-zinc-300">
              <span className="font-medium text-white">Partial data.</span> The runs below are real,
              but the {data.degraded.join(' and ')} catalogue could not be read, so some names fall
              back to raw ids.
              {data.degradedDetail ? (
                <span className="mt-0.5 block text-zinc-400">{data.degradedDetail}</span>
              ) : null}
            </p>
          </div>
        ) : null}

        {/* Top row keeps the reference's 2/3 + 1/3 from `lg` up: the ring is
            136px wide, so a third of a 1024px viewport is plenty. The FEED row
            below needs more — see its own breakpoint. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RunsSummaryCard
              metrics={metrics}
              period={filters.period}
              loadedCount={data.runs.length}
              windowRunCount={data.windowRunCount}
              windowTruncated={data.windowTruncated}
              windowMaxRows={data.windowMaxRows}
              tableRowCap={data.tableRowCap}
            />
          </div>
          <RunsSuccessRing metrics={metrics} />
        </div>

        {/* The feed splits 2/3 + 1/3 only from 1700px — an arbitrary breakpoint
            chosen by MEASUREMENT, not by picking the nearest Tailwind step.
            Catalyst's `TableCell` carries more horizontal padding than a
            hand-rolled cell, so the eight required columns need ~855px: they
            fit the full content column at 1440 (~1160px) but not a 2/3 slice of
            it (~722px), where Cost, Started and Trace fell behind a horizontal
            scrollbar. Below 1700 the feed takes the full width and the activity
            panel sits under it — every required column stays on screen, which
            outranks holding the reference's 2/3 ratio at every size. */}
        <div className="grid gap-4 min-[1700px]:grid-cols-3">
          <Panel inset="md" className="flex min-w-0 flex-col min-[1700px]:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Subheading level={2}>Run feed</Subheading>
              {/* Filtering swaps the result set with no focus change, so a
                  screen reader gets no signal that a search matched nothing
                  (WCAG 4.1.3). This counter already carries exactly the figure
                  that changed — announcing it is the whole fix. */}
              <p role="status" className="text-xs text-zinc-400 tabular-nums">
                {visibleRuns.length} of {data.runs.length} loaded
              </p>
            </div>

            <div className="mt-4">
              <RunsFilters
                state={filters}
                agentOptions={agentOptions}
                projectOptions={projectOptions}
                onChange={patchFilters}
                onReset={resetFilters}
                showReset={filtersActive}
              />
            </div>

            <div className="mt-4 min-w-0">
              {rows.length === 0 ? (
                <RunsEmptyState hasFilters={filtersActive} onReset={resetFilters} />
              ) : (
                <>
                  <RunsTable rows={rows} />
                  <RunsCardList rows={rows} />
                </>
              )}
            </div>
          </Panel>

          <RunsActivityPanel
            rows={activity}
            nowMs={data.nowMs}
            agentsDegraded={data.degraded.includes('agents')}
          />
        </div>
      </div>
    </SidebarLayout>
  )
}
