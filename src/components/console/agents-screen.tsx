import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { AvailableAgent, AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import that crosses into a sub-directory matches neither.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
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
} from './screen-primitives'

/**
 * The runtime catalogue: every persisted agent, its real status, and the
 * concrete reason each one that cannot run is blocked.
 *
 * SERVER COMPONENT. Everything here is markup over the `AvailableAgent[]` the
 * route already resolved; the two gauges are hand-written SVG. Nothing hydrates.
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
export function agentStatusTone(status: AvailableAgentStatus, lifecycleStatus?: string): StatusDotTone {
  if (status === 'active') return 'positive'
  if (status === 'degraded') return 'negative'
  if (status === 'unavailable') return lifecycleStatus === 'archived' ? 'neutral' : 'negative'
  return 'neutral'
}

/**
 * ISO instant → `2026-07-29 08:14 UTC`, or `null` when the string is not a
 * parseable instant.
 *
 * UTC and locale-free on purpose: `toLocaleString()` renders differently per
 * server locale, and these screens are server-rendered. Lives here rather than
 * in `src/lib/agent-mission-control/format.ts` only because this mission does not
 * own that file — it is the formatter's natural home and should move there.
 */
const pad2 = (value: number) => String(value).padStart(2, '0')

export function formatUtcTimestamp(iso: string | null): string | null {
  if (iso === null) return null
  const epoch = Date.parse(iso)
  if (!Number.isFinite(epoch)) return null
  const date = new Date(epoch)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`
}

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
 * Why the run gate would refuse this agent, in the contract's own terms.
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
          description="Lifecycle and execution truth stay separate — an agent is legitimately draft and inactive at once"
          actions={
            <span className="shrink-0 text-[11px]/4 tabular-nums text-zinc-500">
              {unread ? UNAVAILABLE_LABEL : `${total} rows`}
            </span>
          }
          scroll="lg"
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
            /* One table language for the whole console (`screen-primitives`):
               no `dense` — it collides with TABLE_SHELL's row padding at equal
               specificity — and `TABLE_ROW` on every row, header included,
               because nothing here is clickable except the Inspect button. */
            <Table caption="Runtime agent catalogue" className={TABLE_SHELL}>
              <TableHead className={TABLE_HEAD}>
                <TableRow className={TABLE_ROW}>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Agent</TableHeader>
                  <TableHeader>Lifecycle</TableHeader>
                  <TableHeader>Runtime</TableHeader>
                  <TableHeader>Provider · model</TableHeader>
                  <TableHeader className={TABLE_NUM}>Tools</TableHeader>
                  <TableHeader>Last run</TableHeader>
                  <TableHeader className={TABLE_NUM}>Last cost</TableHeader>
                  <TableHeader>
                    <span className="sr-only">Inspect</span>
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody className={TABLE_BODY}>
                {agents.map((agent) => {
                  const lastRunAt = formatUtcTimestamp(agent.lastRunAt)
                  return (
                    <TableRow key={agent.copilotId} className={TABLE_ROW}>
                      <TableCell>
                        <StatusDot tone={agentStatusTone(agent.status, agent.lifecycleStatus)}>
                          {agent.status}
                        </StatusDot>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate text-white">{agent.name}</p>
                        <p className="max-w-56 truncate font-mono text-[10px]/4 text-zinc-600">
                          {agent.copilotId}
                        </p>
                      </TableCell>
                      <TableCell className="text-zinc-400">{agent.lifecycleStatus}</TableCell>
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
                            half answers for its OWN absence. A lone `·` used to
                            occupy the missing side and read like a value. */}
                        {agent.provider === null && agent.configuredModel === null ? (
                          <Unavailable />
                        ) : (
                          <p className="max-w-52 truncate text-zinc-400">
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
                          <span className="tabular-nums text-zinc-400">{lastRunAt}</span>
                        )}
                      </TableCell>
                      <TableCell className={TABLE_NUM}>
                        {agent.lastRunCostUsd === null ? (
                          <Unavailable />
                        ) : (
                          <span className="text-white">{formatUsd(agent.lastRunCostUsd, 4)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button href={`/admin/agents/${agent.copilotId}`} plain>
                          Inspect <ArrowRightIcon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      {/* ── ROW 3 · blocked agents · last run per agent ───────────────────── */}
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
