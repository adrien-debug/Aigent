'use client'

import { Fragment, useMemo, useState } from 'react'

import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { AvailableAgent, AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import that crosses into a sub-directory matches neither.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { BarBreakdown, type BarBreakdownRow } from '@/components/console/charts/bar-breakdown'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import {
  EmptyState,
  ErrorState,
  KpiCard,
  PanelRow,
  ScreenHeader,
  Section,
  TABLE_BODY,
  TABLE_HEAD,
  TABLE_NUM,
  TABLE_ROW,
  TABLE_SHELL,
  Unavailable,
  agentStatusTone,
  formatUtcTimestamp,
} from './screen-primitives'

/**
 * The runtime catalogue: every persisted agent, its real status, and the
 * concrete reason each one that cannot run is blocked.
 *
 * CLIENT COMPONENT — the one exception in this console's table screens.
 * `agents`/`agentsErrorDetail` are still resolved server-side by
 * `src/app/admin/agents/page.tsx` and passed in as plain, already-serialised
 * props; nothing here fetches. `'use client'` exists ONLY to hold the fleet
 * table's search/filter/sort/group state — the KPI band, the composition
 * panel, the analytics row and the two side panels below are markup over
 * those same props and would be exactly this same JSX as a server component.
 * Splitting them into a second file was rejected: this mission's perimeter is
 * `agents-screen.tsx` and `charts/`, not a new shared component.
 *
 * TRUTH. `AvailableAgent` says "not measured" with `null` (and names the field
 * in `unavailableFields`), so a null renders the word `Indisponible`
 * (`<Unavailable />`) — never 0, never `$0.00`, never a gauge arc drawn at zero
 * length. No `?? 0` on a measurement lives in this file. The counters below are
 * filters over the SAME array the table renders, so a KPI and the list it
 * summarises are structurally incapable of disagreeing.
 *
 * THE CATALOGUE ITSELF HAS THREE STATES, AND ALL THREE ARE VISIBLE.
 * `agents` is `AvailableAgent[] | null`:
 *   · `[…]`  — read OK, agents persisted. Every figure is measured.
 *   · `[]`   — read OK and the environment holds nothing. A MEASURED emptiness:
 *              the counts read `0`, the gauges are not drawn (a ratio over an
 *              empty set is undefined, not zero), and every panel shows its calm
 *              `EmptyState`.
 *   · `null` — the read FAILED. Every figure says `Indisponible`, an
 *              `ErrorState` in the danger role names the failure with its
 *              PostgREST detail, and every panel wears the failure rather than
 *              an empty state. An unread catalogue is NEVER drawn as an empty
 *              fleet: "0 persisted agents" on a dead backend is precisely the
 *              calm, healthy-looking lie this console exists to refuse.
 *
 * STATUS VOCABULARY. The words rendered for a status are the ENUM VALUES
 * themselves (`active`, `degraded`, …), lower-case, exactly as `runs-screen.tsx`
 * and `overview-screen.tsx` already render `run.status`. They are DATA, not a
 * display vocabulary invented here — which is why no capitalised status literal
 * appears anywhere in this console and `scripts/check-status-truth.mjs` stays
 * green. `src/lib/agent-mission-control/labels.ts`, which that guard names as the
 * owner of any display-cased word, does NOT exist yet; the day it does, the tone
 * map and the timestamp formatter below are what should move into it.
 *
 * EXECUTABILITY — ONE RULE, NOT TWO. `agent.executable` is not re-derived here:
 * it is written by `available-agents.ts` from the exact same predicate as
 * `runtime-catalogue.isExecutable` (status active, zero unresolved tools,
 * runtime langgraph — see that file's comment on the field). That module is
 * `import 'server-only'`, so it cannot be imported into this client component
 * directly; the field it already computed is read instead, which is the same
 * fact, not a second one. `blockingReasons` below states WHY in words, from the
 * identical inputs, and is the module `agent-detail.ts`'s own (private,
 * unexported) `computeBlockers` mirrors — this file already carried that
 * mirror before this mission and it is kept as the one place both the fleet
 * list and the blocked-agents panel read from.
 *
 * DATA REFUSED FOR THIS MISSION. "Delivered version" distinct from "production
 * version", telemetry-received, improvement state and consumer status were all
 * requested. None is refused out of laziness: `getAvailableAgents()` resolves
 * exactly ONE version per copilot (`production_version_id ?? latest_version_id`,
 * see that file), so a genuine "production vs. delivered" split needs a SECOND,
 * currently un-batched read; telemetry/improvement/consumer facts live in
 * `agent-lifecycle-trace.ts`, built PER AGENT from delivery events, telemetry
 * events and improvement proposals — wiring it into this list would fan out N
 * extra reads per row on every catalogue load, which is a new feature for the
 * loader's owner, not a remount of something already read. `versionStage`
 * (below) is the one exception: `copilot_versions.stage` is a column the
 * existing query already selects and simply never returned.
 */

/* ------------------------------------------------------- shared vocabulary */

/** Runtime statuses in the order the composition panel lists them. */
export const AGENT_STATUS_ORDER: readonly AvailableAgentStatus[] = [
  'active',
  'inactive',
  'degraded',
  'unavailable',
]

/**
 * Status → dot role, spelled ONCE for the whole console (imported by
 * `agent-detail-screen.tsx`; never re-derived there).
 *
 * `active` is the only status that earns the accent. `degraded` is a real
 * breakage and wears the danger role. `unavailable` splits on the LIFECYCLE
 * column, because the contract folds two different facts into one word: an
 * `archived` agent was deliberately retired (neutral — a decision, not a
 * fault), while any other `unavailable` agent is missing a hard requirement and
 * is genuinely blocked (danger).
 */
/* ----------------------------------------------------------------- helpers */

/** `Indisponible` sized for the big KPI figure slot (a 12-glyph word does not
 *  survive `text-2xl`). Same rung the four sibling screens use. */
const unavailableFigure = <Unavailable className="text-base/7" />

/**
 * The dot role for one line of the AGGREGATE composition legend.
 *
 * `agentStatusTone` splits `unavailable` on the LIFECYCLE column, because the
 * contract folds two facts into one word: an `archived` agent was deliberately
 * retired (neutral), any other is missing a hard requirement (danger). A legend
 * row is a COUNT, so it has no single lifecycle to pass — and calling
 * `agentStatusTone(status)` with the argument omitted resolved
 * `undefined !== 'archived'` to `'negative'` every time. The result was one
 * screen, one word, two roles: the legend painted `unavailable` in the danger
 * role while the table two panels away painted the same agent neutral because
 * it was archived on purpose. A danger role spent on a deliberate retirement
 * can no longer warn about anything.
 *
 * So the row is judged on the POPULATION it counts: danger as soon as at least
 * one of those agents is genuinely blocked, neutral when every one of them was
 * retired on purpose. An unread catalogue counts nobody and claims nothing.
 */
function legendTone(
  status: AvailableAgentStatus,
  agents: AvailableAgent[] | null
): StatusDotTone {
  if (status !== 'unavailable') return agentStatusTone(status)
  const rows = (agents ?? []).filter((agent) => agent.status === 'unavailable')
  return rows.some((agent) => agent.lifecycleStatus !== 'archived') ? 'negative' : 'neutral'
}

/**
 * The LAST RUN's status → dot role. `AvailableAgent.lastRunStatus` is a free
 * string copied from `agent_runs.status`, so an unknown value stays neutral
 * rather than being guessed into an outcome.
 */
function lastRunTone(status: string): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

/** Sort key for "most recently active first". `null` ⇒ never ran ⇒ sorts last. */
function lastRunEpoch(agent: AvailableAgent): number | null {
  if (agent.lastRunAt === null) return null
  const epoch = Date.parse(agent.lastRunAt)
  return Number.isFinite(epoch) ? epoch : null
}

/**
 * Why the run gate would refuse this agent, in the contract's own terms —
 * mirrors `agent-detail.ts`'s private `computeBlockers` and
 * `runtime-catalogue.isExecutable`. THE reason this table's "blocked" column
 * exists: reading it here is the operational gain over opening the detail page.
 *
 * Every entry is read from a persisted fact (`unresolvedToolIds`,
 * `unavailableFields`, the `runtime` column) — nothing is inferred, and an empty
 * result means the agent really is launchable.
 */
export function blockingReasons(agent: AvailableAgent): string[] {
  const reasons: string[] = []

  if (agent.unresolvedToolIds.length > 0) {
    const count = agent.unresolvedToolIds.length
    reasons.push(`${count} declared tool${count > 1 ? 's' : ''} the runner cannot execute`)
  }

  for (const field of ['projectId', 'provider', 'configuredModel', 'version', 'tools'] as const) {
    if (agent.unavailableFields.includes(field)) reasons.push(`no ${field} resolved`)
  }

  // `langgraph` is the only executable product runtime (AGENTS.md); the contract
  // encodes the same rule in `AvailableAgent.executable`.
  if (agent.runtime === null) reasons.push('runtime column is empty')
  else if (agent.runtime !== 'langgraph') reasons.push(`runtime is ${agent.runtime}`)

  if (reasons.length === 0 && agent.status !== 'active') {
    reasons.push(`runtime status is ${agent.status}, not active`)
  }

  return reasons
}

/* ------------------------------------------------------------ fleet table */

type SortKey = 'name' | 'lastRun' | 'tools' | 'cost'
type ExecFilter = 'all' | 'executable' | 'blocked'

/** One bucket count with a stable, deterministic label — never invented, only
 *  ever a raw value already present on `AvailableAgent`, or `Indisponible`. */
function tally(agents: AvailableAgent[], keyOf: (agent: AvailableAgent) => string | null): BarBreakdownRow[] {
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const key = keyOf(agent) ?? UNAVAILABLE_LABEL
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }))
}

/** Freshness bucket for a last-run timestamp, relative to the render instant. */
function proofFreshness(agent: AvailableAgent, nowMs: number): string {
  if (agent.lastRunAt === null) return 'no proof yet'
  const epoch = Date.parse(agent.lastRunAt)
  if (!Number.isFinite(epoch)) return UNAVAILABLE_LABEL
  const ageMs = nowMs - epoch
  if (ageMs < 0) return 'proof within 24h'
  const hours = ageMs / 3_600_000
  if (hours <= 24) return 'proof within 24h'
  if (hours <= 24 * 7) return 'proof within 7d'
  if (hours <= 24 * 30) return 'proof within 30d'
  return 'proof over 30d old'
}

function FleetTable({ agents }: { agents: AvailableAgent[] }) {
  const [query, setQuery] = useState('')
  const [execFilter, setExecFilter] = useState<ExecFilter>('all')
  const [lifecycleFilter, setLifecycleFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('lastRun')
  const [groupByLifecycle, setGroupByLifecycle] = useState(false)

  const lifecycleValues = useMemo(
    () => [...new Set(agents.map((a) => a.lifecycleStatus))].sort(),
    [agents]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      if (needle.length > 0) {
        const haystack = `${agent.name} ${agent.copilotId}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (execFilter === 'executable' && !agent.executable) return false
      if (execFilter === 'blocked' && agent.executable) return false
      if (lifecycleFilter !== 'all' && agent.lifecycleStatus !== lifecycleFilter) return false
      return true
    })
  }, [agents, query, execFilter, lifecycleFilter])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'tools':
          return b.tools.length - a.tools.length
        case 'cost': {
          const left = a.lastRunCostUsd
          const right = b.lastRunCostUsd
          if (left === right) return a.name.localeCompare(b.name)
          if (left === null) return 1
          if (right === null) return -1
          return right - left
        }
        case 'lastRun':
        default: {
          const left = lastRunEpoch(a)
          const right = lastRunEpoch(b)
          if (left === right) return a.name.localeCompare(b.name)
          if (left === null) return 1
          if (right === null) return -1
          return right - left
        }
      }
    })
    return rows
  }, [filtered, sortKey])

  const groups: { key: string; rows: AvailableAgent[] }[] = groupByLifecycle
    ? lifecycleValues
        .map((lifecycle) => ({ key: lifecycle, rows: sorted.filter((a) => a.lifecycleStatus === lifecycle) }))
        .filter((group) => group.rows.length > 0)
    : [{ key: '', rows: sorted }]

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            placeholder="Search name or id…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search agents by name or id"
          />
        </div>
        <select
          value={execFilter}
          onChange={(event) => setExecFilter(event.target.value as ExecFilter)}
          aria-label="Filter by executability"
          className="rounded-md border border-line bg-surface-sunken px-2 py-1.5 text-xs text-zinc-300"
        >
          <option value="all">Executable · all</option>
          <option value="executable">Executable only</option>
          <option value="blocked">Blocked only</option>
        </select>
        <select
          value={lifecycleFilter}
          onChange={(event) => setLifecycleFilter(event.target.value)}
          aria-label="Filter by lifecycle status"
          className="rounded-md border border-line bg-surface-sunken px-2 py-1.5 text-xs text-zinc-300"
        >
          <option value="all">Lifecycle · all</option>
          {lifecycleValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          aria-label="Sort rows by"
          className="rounded-md border border-line bg-surface-sunken px-2 py-1.5 text-xs text-zinc-300"
        >
          <option value="lastRun">Sort · last run</option>
          <option value="name">Sort · name</option>
          <option value="tools">Sort · tools</option>
          <option value="cost">Sort · last cost</option>
        </select>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px]/4 text-zinc-400">
          <input
            type="checkbox"
            checked={groupByLifecycle}
            onChange={(event) => setGroupByLifecycle(event.target.checked)}
            className="size-3.5 rounded border-line accent-[var(--accent-500)]"
          />
          Group by lifecycle
        </label>
        <span className="ml-auto shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
          {sorted.length} / {agents.length} rows
        </span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No agent matches these filters."
          description="Clear the search or the filters to see the full catalogue again."
        />
      ) : (
        // Bounded height, sticky header: the box is fixed, the data scrolls
        // inside it — a growing fleet never grows this panel.
        <div className="max-h-[30rem] overflow-auto">
          <Table caption="Runtime agent catalogue" className={TABLE_SHELL}>
            <TableHead className={`${TABLE_HEAD} sticky top-0 z-10`}>
              <TableRow className={TABLE_ROW}>
                <TableHeader>Status</TableHeader>
                <TableHeader>Agent</TableHeader>
                <TableHeader>Lifecycle</TableHeader>
                <TableHeader>Runtime</TableHeader>
                <TableHeader>Provider · model</TableHeader>
                <TableHeader className={TABLE_NUM}>Tools</TableHeader>
                <TableHeader>Last run</TableHeader>
                <TableHeader className={TABLE_NUM}>Last cost</TableHeader>
                <TableHeader>Blocked because</TableHeader>
                {/* Sticky right so the row action never scrolls out of the
                    viewport under a wide table — the operational requirement
                    driving this rebuild. */}
                <TableHeader className="sticky right-0 bg-surface-sunken">
                  <span className="sr-only">Inspect</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className={TABLE_BODY}>
              {groups.map((group) => (
                <Fragment key={group.key || 'ungrouped'}>
                  {group.key ? (
                    <TableRow key={`group-${group.key}`} className={`${TABLE_ROW} bg-surface-sunken`}>
                      <TableCell colSpan={10} className="text-[10px] tracking-widest text-zinc-400 uppercase">
                        {group.key} · {group.rows.length}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {group.rows.map((agent) => {
                    const lastRunAt = formatUtcTimestamp(agent.lastRunAt)
                    const reasons = agent.executable ? [] : blockingReasons(agent)
                    return (
                      <TableRow key={agent.copilotId} className={TABLE_ROW}>
                        <TableCell>
                          <span title={`Runtime status: ${agent.status}`}>
                            <StatusDot tone={agentStatusTone(agent.status, agent.lifecycleStatus)}>
                              {agent.status}
                            </StatusDot>
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* Contrast fix: the id used to sit at `zinc-600`
                              (~2.8:1 on the sunken row background, under the AA
                              floor for any text size) — bumped to `zinc-500`
                              (~4.1:1) so the identifier stays legible instead of
                              reading as decoration. */}
                          <p className="max-w-56 truncate text-white">{agent.name}</p>
                          <p className="max-w-56 truncate font-mono text-[10px]/4 text-zinc-500">
                            {agent.copilotId}
                            {/* `versionStage` — the stage of the ONE version the
                                catalogue resolves (`production_version_id ??
                                latest_version_id`), read from a column the
                                loader already selected but never returned.
                                Not "delivered version": see the file docblock
                                for why that split is refused this mission. */}
                            {agent.version !== null ? (
                              <span className="text-zinc-600">
                                {' '}
                                · {agent.version}
                                {agent.versionStage !== null ? ` (${agent.versionStage})` : ''}
                              </span>
                            ) : null}
                          </p>
                        </TableCell>
                        <TableCell className="text-zinc-300">{agent.lifecycleStatus}</TableCell>
                        <TableCell>
                          {agent.runtime === null ? (
                            <Unavailable />
                          ) : (
                            <span className="text-zinc-300">{agent.runtime}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* The dot is a SEPARATOR between two facts, never a
                              stand-in for one: `provider` and `configuredModel`
                              are independently nullable in the contract, so each
                              half answers for its OWN absence. */}
                          {agent.provider === null && agent.configuredModel === null ? (
                            <Unavailable />
                          ) : (
                            <p className="max-w-52 truncate text-zinc-300">
                              {agent.provider ?? <Unavailable />} ·{' '}
                              {agent.configuredModel ?? <Unavailable />}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className={`${TABLE_NUM} text-white`}>{agent.tools.length}</TableCell>
                        <TableCell>
                          {lastRunAt === null ? (
                            <Unavailable />
                          ) : (
                            <span className="tabular-nums text-zinc-300">{lastRunAt}</span>
                          )}
                        </TableCell>
                        <TableCell className={TABLE_NUM}>
                          {agent.lastRunCostUsd === null ? (
                            <Unavailable />
                          ) : (
                            <span className="text-white">{formatUsd(agent.lastRunCostUsd, 4)}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-64">
                          {/* THE operational payoff of this rebuild: the refusal
                              reason is readable right here, no click required. */}
                          {agent.executable ? (
                            <span className="text-zinc-500">—</span>
                          ) : (
                            <p
                              className="truncate text-[11px]/4 text-[var(--state-danger-text)]"
                              title={reasons.join(' · ')}
                            >
                              {reasons.join(' · ')}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-surface-raised text-right">
                          <Button href={`/admin/agents/${agent.copilotId}`} plain>
                            Inspect <ArrowRightIcon />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

/* --------------------------------------------------------------- component */

export function AgentsScreen({
  agents,
  agentsErrorDetail = null,
}: {
  /** `null` ⇒ the catalogue read FAILED. Never `[]` — see the file docblock. */
  agents: AvailableAgent[] | null
  /** The PostgREST detail of that failure, when the route could extract one. */
  agentsErrorDetail?: string | null
}) {
  // The read failed ⇒ NOTHING was counted. Every figure below is `null`, which
  // the JSX renders as the word `Indisponible`; none of them is allowed to fall
  // back to a confident 0. `rows` is the empty array only so the table and the
  // panels have something to map over — they are gated on `unread` first, so an
  // unread catalogue never reaches an EmptyState.
  const unread = agents === null
  const rows = agents ?? []

  const total = unread ? null : rows.length
  const executable = unread ? null : rows.filter((agent) => agent.executable).length
  const countOf = (status: AvailableAgentStatus) =>
    unread ? null : rows.filter((agent) => agent.status === status).length
  const needsAttention = unread
    ? null
    : rows.filter((agent) => agent.status === 'degraded' || agent.status === 'unavailable').length
  // NOT "verified agents": this counts the agents whose LAST RUN proved the
  // model it executed. Every other agent is unproven, which is a different claim.
  const modelProven = unread ? null : rows.filter((agent) => agent.executedModel !== null).length
  const mountedTools = unread ? null : rows.reduce((sum, agent) => sum + agent.tools.length, 0)

  const blocked = rows.filter((agent) => !agent.executable)
  const byLastRun = rows.toSorted((a, b) => {
    const left = lastRunEpoch(a)
    const right = lastRunEpoch(b)
    if (left === right) return a.name.localeCompare(b.name)
    if (left === null) return 1
    if (right === null) return -1
    return right - left
  })

  // ── Fleet analytics — every bucket is a plain tally over the same `rows`
  // the table renders. Real sources only, named per row in the file docblock.
  // `Date.now()` is an impure read (react-hooks/purity forbids calling it bare
  // during render), so it is captured ONCE via `useState`'s lazy initialiser —
  // the reference instant for "how old is this proof" is fixed for the life of
  // the mount, exactly like a server-rendered page's implicit render time.
  const [now] = useState(() => Date.now())
  const lifecycleBreakdown = unread ? [] : tally(rows, (a) => a.lifecycleStatus)
  const runtimeStatusBreakdown = unread ? [] : tally(rows, (a) => a.status)
  const executabilityBreakdown = unread
    ? []
    : [
        { label: 'executable', count: rows.filter((a) => a.executable).length },
        { label: 'not executable', count: rows.filter((a) => !a.executable).length, danger: true },
      ]
  const modelBreakdown = unread ? [] : tally(rows, (a) => a.configuredModel)
  const providerBreakdown = unread ? [] : tally(rows, (a) => a.provider)
  const toolCoverageBreakdown = unread
    ? []
    : [
        { label: 'all tools resolved', count: rows.filter((a) => a.unresolvedToolIds.length === 0).length },
        {
          label: 'some unresolved',
          count: rows.filter((a) => a.unresolvedToolIds.length > 0).length,
          danger: true,
        },
      ]
  const proofFreshnessBreakdown = unread ? [] : tally(rows, (a) => proofFreshness(a, now))

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Agents"
        description="Canonical runtime catalogue — persisted agents only."
        actions={
          <>
            <Button href="/admin" outline>
              Back to overview
            </Button>
            <Button href="/admin/runs" outline>
              Run activity <ArrowRightIcon />
            </Button>
          </>
        }
      />

      {/* The failure is STATED, in the danger role, above everything it invalidates.
          Without it an unread catalogue and an empty one would render the same
          calm screen — the one lie this console is built to refuse. */}
      {unread ? (
        <ErrorState
          title="Agent catalogue could not be read"
          description={
            agentsErrorDetail
              ? `Every figure on this page is unavailable for this read. ${agentsErrorDetail}`
              : 'Every figure on this page is unavailable for this read.'
          }
        />
      ) : null}

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────── */}
      {/* THREE ACROSS, not six. Measured at 1280 a six-up band leaves ~123px of
          inner width per card, where the 16px absence rung (`Indisponible`,
          ~85px) sits beside a 72px gauge and truncates. `lg:grid-cols-3` is the
          rung `overview-screen` already settled on for six cards, and the two
          gauges are passed `size={56}` for the same measured reason as
          `runs-screen` / `projects-screen`. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Persisted agents"
          value={total ?? unavailableFigure}
          detail={unread ? 'The catalogue could not be read' : 'Rows in the runtime catalogue'}
        />

        <KpiCard
          label="Executable now"
          value={unread ? unavailableFigure : `${executable} / ${total}`}
          detail={unread ? 'The catalogue could not be read' : 'Would pass the run gate'}
          aside={
            total !== null && total > 0 ? (
              <ArcGauge
                value={executable}
                max={total}
                size={56}
                ariaLabel={`Executable agents: ${executable} of ${total}.`}
              />
            ) : undefined
          }
        />

        <KpiCard
          label="Serving"
          value={countOf('active') ?? unavailableFigure}
          detail={unread ? 'The catalogue could not be read' : 'Runtime status active'}
        />

        <KpiCard
          label="Needs attention"
          value={
            needsAttention === null ? (
              unavailableFigure
            ) : needsAttention > 0 ? (
              <span className="text-[var(--state-danger-text)]">{needsAttention}</span>
            ) : (
              needsAttention
            )
          }
          detail={unread ? 'The catalogue could not be read' : 'Degraded or unavailable'}
        />

        <KpiCard
          label="Model proven"
          value={unread ? unavailableFigure : `${modelProven} / ${total}`}
          detail={unread ? 'The catalogue could not be read' : 'Last run verified the model'}
          aside={
            total !== null && total > 0 ? (
              <ArcGauge
                value={modelProven}
                max={total}
                size={56}
                ariaLabel={`Agents whose last run proved its model: ${modelProven} of ${total}.`}
              />
            ) : undefined
          }
        />

        <KpiCard
          label="Mounted tools"
          value={mountedTools ?? unavailableFigure}
          detail={unread ? 'The catalogue could not be read' : 'Resolved tool definitions'}
        />
      </div>

      {/* ── ROW 2 · fleet composition · the catalogue itself ──────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,2.15fr)]">
        <Section title="Fleet composition" description="Executability and the runtime status split">
          <div className="flex flex-col items-center px-4 pt-4 pb-3">
            {/* An empty catalogue has no ratio to draw: `max = 0` makes the ring
                render "Indisponible" rather than a fabricated full circle. */}
            <RingGauge
              value={total !== null && total > 0 ? executable : null}
              max={total ?? 0}
              label="Executable agents"
              caption={total !== null && total > 0 ? `of ${total}` : undefined}
              size={168}
            />
            <p className="mt-2 text-center text-[11px]/4 text-zinc-500">
              {unread
                ? 'The agent catalogue could not be read'
                : total !== null && total > 0
                  ? `${executable} of ${total} agents would be accepted for a run right now`
                  : 'No persisted agent to measure'}
            </p>
          </div>
          <dl className="border-t border-line">
            {AGENT_STATUS_ORDER.map((status) => {
              const count = countOf(status)
              return (
                <div
                  key={status}
                  className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5 last:border-b-0"
                >
                  <dt className="min-w-0">
                    {/* `legendTone`, NOT `agentStatusTone(status)`: a legend row is
                        a COUNT and has no lifecycle to pass, and the bare call
                        resolved `unavailable` to the danger role even when every
                        agent it counted was archived on purpose. */}
                    <StatusDot tone={legendTone(status, agents)}>{status}</StatusDot>
                  </dt>
                  <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                    {count ?? <Unavailable className="text-[13px]/5" />}
                  </dd>
                </div>
              )
            })}
          </dl>
        </Section>

        <Section
          title="Runtime catalogue"
          description="Search, filter, sort and group — lifecycle and execution truth stay separate"
          actions={
            <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
              {unread ? UNAVAILABLE_LABEL : `${total} rows`}
            </span>
          }
        >
          {unread ? (
            <ErrorState
              title="Runtime catalogue unavailable"
              description="The agent registry could not be read for this request. No row is shown, because none was read."
              className="m-4"
            />
          ) : total === 0 ? (
            <EmptyState
              title="No persisted agent is available."
              description="The catalogue reads live rows only — an empty environment shows nothing."
            />
          ) : (
            <FleetTable agents={rows} />
          )}
        </Section>
      </div>

      {/* ── ROW 3 · fleet analytics ─────────────────────────────────────────
          Every panel is a distribution over `rows` — the SAME array the table
          above renders — never a sparkline, never inline in a card or a table
          cell (see `BarBreakdown`'s own docblock). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Section title="By lifecycle" description="copilots.status">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={lifecycleBreakdown} total={total ?? 0} ariaLabel="Agents by lifecycle status" />
          )}
        </Section>
        <Section title="By runtime status" description="Derived executability status">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={runtimeStatusBreakdown} total={total ?? 0} ariaLabel="Agents by runtime status" />
          )}
        </Section>
        <Section title="Executability" description="Would pass the run gate right now">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={executabilityBreakdown} total={total ?? 0} ariaLabel="Agents by executability" />
          )}
        </Section>
        <Section title="By provider" description="copilots.model_provider">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={providerBreakdown} total={total ?? 0} ariaLabel="Agents by provider" />
          )}
        </Section>
        <Section title="By model" description="copilots.model" className="sm:col-span-2">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={modelBreakdown} total={total ?? 0} ariaLabel="Agents by configured model" />
          )}
        </Section>
        <Section title="Tool coverage" description="Declared tools that resolve to a registered handler">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={toolCoverageBreakdown} total={total ?? 0} ariaLabel="Agents by tool coverage" />
          )}
        </Section>
        <Section title="Proof freshness" description="Age of the last recorded run, if any">
          {unread ? (
            <ErrorState title="Not read" description="Catalogue unread." className="m-4" />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent." />
          ) : (
            <BarBreakdown rows={proofFreshnessBreakdown} total={total ?? 0} ariaLabel="Agents by proof freshness" />
          )}
        </Section>
      </div>

      {/* ── ROW 4 · blocked agents · last run per agent ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          title="Blocked from running"
          description="The same refusals the run endpoint enforces"
          actions={
            <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
              {unread ? UNAVAILABLE_LABEL : blocked.length}
            </span>
          }
          scroll="md"
        >
          {unread ? (
            <ErrorState
              title="Blocked agents unavailable"
              description="Nothing was read, so nothing can be declared launchable either."
              className="m-4"
            />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent is available." />
          ) : blocked.length === 0 ? (
            <EmptyState
              title="Every persisted agent would be accepted for a run."
              description="No unresolved tool, no missing requirement, every runtime wired."
            />
          ) : (
            blocked.map((agent) => (
              <PanelRow
                key={agent.copilotId}
                href={`/admin/agents/${agent.copilotId}`}
                title={agent.name}
                subtitle={blockingReasons(agent).join(' · ')}
                trailing={
                  <StatusDot
                    tone={agentStatusTone(agent.status, agent.lifecycleStatus)}
                    className="max-w-28"
                  >
                    {agent.status}
                  </StatusDot>
                }
              />
            ))
          )}
        </Section>

        <Section
          title="Last run per agent"
          description="Most recently active first; agents that never ran sort last"
          scroll="md"
        >
          {unread ? (
            <ErrorState
              title="Run history per agent unavailable"
              description="The agent registry could not be read for this request."
              className="m-4"
            />
          ) : total === 0 ? (
            <EmptyState title="No persisted agent is available." />
          ) : (
            byLastRun.map((agent) => {
              const lastRunAt = formatUtcTimestamp(agent.lastRunAt)
              return (
                <PanelRow
                  key={agent.copilotId}
                  href={`/admin/agents/${agent.copilotId}`}
                  title={agent.name}
                  subtitle={lastRunAt ?? <Unavailable className="text-[11px]/4" />}
                  values={[
                    {
                      label: 'cost',
                      value:
                        agent.lastRunCostUsd === null ? (
                          <Unavailable className="text-[11px]/5" />
                        ) : (
                          formatUsd(agent.lastRunCostUsd, 4)
                        ),
                    },
                  ]}
                  trailing={
                    agent.lastRunStatus === null ? (
                      <Unavailable className="text-[11px]/4" />
                    ) : (
                      <StatusDot tone={lastRunTone(agent.lastRunStatus)} className="max-w-28">
                        {agent.lastRunStatus}
                      </StatusDot>
                    )
                  }
                />
              )
            })
          )}
        </Section>
      </div>
    </div>
  )
}
