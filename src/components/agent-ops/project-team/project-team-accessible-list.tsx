'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'

import { StatusPill } from '@/components/agent-ops/status-pill'
import { formatAge, humanizeStatus, type TeamAgentView } from './project-team-panel'

/**
 * Screen-reader (and mobile) alternative to the canvas.
 *
 * A `<canvas>`-like node graph is unreadable to assistive tech, so the SAME
 * visible agents are also published as a semantic list. It is not a second copy
 * of the page: it carries only identity, role, status and last activity, and
 * selecting a row drives the exact same selection the canvas does.
 *
 * Status is NEVER conveyed by colour alone — every row states the status in
 * words (StatusPill renders a text label next to its dot), so the information
 * survives greyscale, colour-blindness and a screen reader.
 *
 * `visuallyHidden` renders it off-screen (desktop, where the canvas is the
 * visual surface); on small viewports the same component is shown for real,
 * because hiding the feature on mobile is not an option.
 */
export function ProjectTeamAccessibleList({
  agents,
  selectedAgentId,
  onSelectAgent,
  visuallyHidden = false,
  className,
}: {
  agents: TeamAgentView[]
  selectedAgentId: string | null
  onSelectAgent: (agentId: string | null) => void
  visuallyHidden?: boolean
  className?: string
}) {
  return (
    <section
      aria-label="Team agents, list view"
      className={clsx(visuallyHidden && 'sr-only', className)}
    >
      <h2 className={clsx(visuallyHidden ? undefined : 'px-4 py-3 text-sm font-semibold text-white')}>
        Team agents
      </h2>
      <ul role="list" className={clsx(!visuallyHidden && 'divide-y divide-white/5')}>
        {agents.map((agent) => {
          const age = formatAge(agent.lastActivityAt)
          const selected = agent.id === selectedAgentId
          return (
            <li key={agent.id}>
              <Headless.Button
                onClick={() => onSelectAgent(selected ? null : agent.id)}
                aria-pressed={selected}
                className={clsx(
                  'flex w-full min-h-11 flex-col gap-1 px-4 py-3 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500',
                  !visuallyHidden && (selected ? 'bg-white/5' : 'hover:bg-white/5')
                )}
              >
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-white">{agent.name}</span>
                  <StatusPill
                    label={humanizeStatus(agent.status)}
                    tone={agent.status === 'active' ? 'accent' : 'zinc'}
                  />
                </span>
                <span className="text-xs text-zinc-500">
                  {agent.role ?? 'Role not documented'}
                  {' · '}
                  {age ? `last activity ${age}` : 'no run recorded'}
                </span>
              </Headless.Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
