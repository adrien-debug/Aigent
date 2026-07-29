import type { Metadata } from 'next'

import { AgentsScreen } from '@/components/console/agents-screen'
import { ConsoleShell } from '@/components/console/console-shell'
import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'

export const metadata: Metadata = { title: 'Agents — Aigent' }

export default async function AgentsPage() {
  const agents = await getAvailableAgents()

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
  // The count stays in the label either way, so nothing an operator could read
  // before is lost — only the false alarm. It is stated as the EXECUTABLE side
  // of the same ratio ("N of T executable") rather than as "N blocked": same
  // fact, no borrowed alarm, and it matches the `Executable now` KPI on the
  // screen below. It also fits: the topbar clamps this label at `max-w-32`,
  // where "12 of 128 executable" measures 97px of the ~116px available and the
  // old danger-framed wording ("12 of 128 not executable") measured 115px.
  const total = agents.length
  const executable = agents.filter((agent) => agent.executable).length
  const broken = agents.filter((agent) => agent.status === 'degraded').length

  const stateLabel =
    total === 0
      ? undefined
      : broken > 0
        ? `${broken} degraded`
        : executable === total
          ? 'All executable'
          : `${executable} of ${total} executable`

  return (
    <ConsoleShell
      activeHref="/admin/agents"
      title="Agents"
      stateLabel={stateLabel}
      degraded={broken > 0}
    >
      <AgentsScreen agents={agents} />
    </ConsoleShell>
  )
}
