import type { Metadata } from 'next'

import { AgentsScreen } from '@/components/console/agents-screen'
import { ConsoleShell } from '@/components/console/console-shell'
import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'
import { pgrestDetail } from '@/lib/agent-mission-control/postgrest'

export const metadata: Metadata = { title: 'Agents — Aigent' }

/** The catalogue is read live on every request (`pgrest` sends `no-store`);
 *  declared here so the route stays dynamic on its own, not by inheritance. */
export const dynamic = 'force-dynamic'

/**
 * THE READ IS SETTLED, NOT AWAITED BARE.
 *
 * `getAvailableAgents()` fans out over SIX tables (`copilots`, `tools`,
 * `copilot_versions`, `manifests`, `agent_runs`, `projects`) in one
 * `Promise.all`, and one of them — `projects?select=id` — decides nothing more
 * than whether a single fact renders an id or `Indisponible`. A bare `await`
 * made that label-grade read load-bearing for the ENTIRE screen: any rejection
 * escaped the page, and since `src/app/admin/error.tsx` is forbidden by
 * `scripts/check-no-legacy-front.mjs` (DELETED_ADMIN_ROUTES), the operator got
 * Next's unbranded 500 — no shell, no rail, no message naming what failed, no
 * retry. The same rejection is caught and degraded gracefully on `/admin`
 * (`dashboard-overview.ts`) and on `/admin/projects`: one dependency, two
 * opposite outcomes.
 *
 * So the read is settled here and the failure becomes DATA the screen can state:
 *  · fulfilled → the real catalogue.
 *  · rejected  → `null`, NEVER `[]`. An empty array would render a calm,
 *    healthy-looking empty fleet — exactly the lie this console is built
 *    against. `AgentsScreen` renders the danger-role `ErrorState` with the
 *    PostgREST detail and reports every figure as `Indisponible`.
 *
 * Tiering the reads INSIDE `getAvailableAgents` (copilots load-bearing, the
 * other five degradable into per-field `unavailableFields`) is the deeper fix
 * and belongs to that contract's owner; it is not smuggled in from the route.
 */
export default async function AgentsPage() {
  const [agentsResult] = await Promise.allSettled([getAvailableAgents()])

  const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : null
  const agentsErrorDetail =
    agentsResult.status === 'rejected' ? pgrestDetail(agentsResult.reason) : null

  // The topbar state is a MEASUREMENT, not decoration: it is drawn only when
  // the catalogue holds at least one agent. "All executable" over an empty
  // catalogue would be a vacuous claim, so an empty environment gets no dot.
  //
  // TWO DIFFERENT FACTS, DELIBERATELY SPLIT — the label counts, the ROLE judges:
  //
  //  · NOT EXECUTABLE (`!executable`) is this fleet's ordinary condition. The
  //    catalogue holds drafts, paused agents and archived ones by design, and
  //    `runtime-catalogue.isExecutable` refuses every one of them. Painting the
  //    topbar in the danger role for that left the console permanently red on a
  //    healthy platform — and a danger role that is always on can no longer warn
  //    about anything, which is the only thing it exists to do.
  //
  //  · DEGRADED is the breakage. `available-agents.ts` derives that status for
  //    exactly ONE situation: the execution path is fully wired (project,
  //    provider, model, version, manifest, langgraph runtime) and the agent's
  //    declared tools still resolve to nothing registered — it advertises work
  //    the runner cannot perform. Nobody chose that; it is a fault, and it is
  //    the only condition on this page that earns the danger role.
  //
  //  · AN UNREAD CATALOGUE is a THIRD state, and it outranks both. It is not
  //    "0 degraded" and not "all executable": nothing was measured at all, so
  //    the label says the read failed and the dot wears the danger role.
  //
  // The count stays in the label either way, so nothing an operator could read
  // before is lost — only the false alarm. It is stated as the EXECUTABLE side
  // of the same ratio ("N of T executable") rather than as "N blocked": same
  // fact, no borrowed alarm, and it matches the `Executable now` KPI on the
  // screen below. It also fits: the topbar clamps this label at `max-w-32`,
  // where "12 of 128 executable" measures 97px of the ~116px available and the
  // old danger-framed wording ("12 of 128 not executable") measured 115px.
  const total = agents === null ? null : agents.length
  const executable = agents === null ? null : agents.filter((agent) => agent.executable).length
  const broken = agents === null ? null : agents.filter((agent) => agent.status === 'degraded').length

  const stateLabel =
    agents === null || total === null || executable === null || broken === null
      ? 'Agent catalogue unreadable'
      : total === 0
        ? undefined
        : broken > 0
          ? `${broken} degraded`
          : executable === total
            ? 'All executable'
            : `${executable} of ${total} executable`

  const stateTone =
    agents === null || total === null || executable === null || broken === null
      ? 'negative'
      : total === 0
        ? undefined
        : broken > 0
          ? 'negative'
          : executable === total
            ? 'positive'
            : 'neutral'

  return (
    <ConsoleShell
      activeHref="/admin/agents"
      title="Agents"
      stateLabel={stateLabel}
      stateTone={stateTone}
      degraded={agents === null || (broken !== null && broken > 0)}
    >
      <AgentsScreen agents={agents} agentsErrorDetail={agentsErrorDetail} />
    </ConsoleShell>
  )
}
