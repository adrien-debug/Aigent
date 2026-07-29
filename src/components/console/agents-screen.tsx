import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { Metric, ScreenHeader, Section } from './screen-primitives'

const tone: Record<AvailableAgent['status'], StatusDotTone> = {
  active: 'positive',
  inactive: 'neutral',
  degraded: 'negative',
  unavailable: 'neutral',
}

export function AgentsScreen({ agents }: { agents: AvailableAgent[] }) {
  const executable = agents.filter((agent) => agent.executable).length
  const needsAttention = agents.filter((agent) => agent.status === 'degraded' || agent.status === 'unavailable').length

  return (
    <div className="space-y-8">
      <ScreenHeader title="Agents" description="Canonical runtime catalogue — persisted agents only." />
      <div className="grid divide-y divide-white/8 border-y border-white/8 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric label="Persisted agents" value={agents.length} detail="Runtime catalogue" />
        <Metric label="Executable now" value={executable} detail="Passing every run gate" />
        <Metric label="Needs attention" value={needsAttention} detail="Degraded or unavailable" />
      </div>
      <Section title="Runtime catalogue" description="Lifecycle and execution truth remain separate">
        <div className="divide-y divide-white/8">
          {agents.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-zinc-400">No persisted agent is available.</p>
          ) : agents.map((agent) => (
            <div key={agent.copilotId} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="truncate text-sm font-medium text-white">{agent.name}</p>
                  <StatusDot tone={tone[agent.status]}>{agent.status}</StatusDot>
                  <span className="text-xs text-zinc-500">lifecycle: {agent.lifecycleStatus}</span>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-400">
                  {agent.runtime ?? 'Runtime unavailable'} · {agent.provider ?? 'Provider unavailable'} · {agent.configuredModel ?? 'Model unavailable'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <div className="text-right">
                  <p className="text-sm tabular-nums text-white">{agent.tools.length}</p>
                  <p className="text-[11px] text-zinc-500">tools</p>
                </div>
                <Button href={`/admin/agents/${agent.copilotId}`} outline>
                  Inspect <ArrowRightIcon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
