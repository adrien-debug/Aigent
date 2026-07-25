'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'

import { Subheading } from '@/components/ui/heading'
import { formatAge, humanizeStatus, lastActivityFallback, type TeamAgentView } from './project-team-panel'

/**
 * Screen-reader (and mobile) alternative to the canvas.
 *
 * A `<canvas>`-like node graph is unreadable to assistive tech, so the SAME
 * visible agents are also published as a semantic list. It is not a second copy
 * of the page: it carries only identity, role, status and last activity, and
 * selecting a row drives the exact same selection the canvas does.
 *
 * Status is NEVER conveyed by colour alone — every row states the status in
 * words (muted zinc text label), so the information survives greyscale,
 * colour-blindness and a screen reader.
 *
 * ── Why `focus-within:not-sr-only` and not plain `sr-only` ──────────────────
 * The caller hides this list from `lg` up (`lg:sr-only`), where the canvas is
 * the visual surface. `sr-only` removes it from SIGHT but NOT from the tab
 * order, which broke sighted keyboard users two ways at once: they tabbed into
 * a chain of rows with no visible focus anywhere (WCAG 2.4.7 Focus Visible),
 * and — because the canvas mounts only the nodes inside the viewport
 * (`onlyRenderVisibleElements`) — this invisible list was simultaneously the
 * ONLY keyboard route to the agents scrolled off-canvas.
 *
 * Un-hiding on `:focus-within` fixes both ends with one rule: assistive tech
 * still reads the full roster at any width, and the instant a keyboard user
 * tabs in, the list becomes a real, visible, scrollable roster panel — focus is
 * never on something invisible. `:focus-within` matches on the same frame the
 * descendant takes focus, so there is no flash of invisible focus.
 */
export function ProjectTeamAccessibleList({
  agents,
  selectedAgentId,
  onSelectAgent,
  className,
}: {
  agents: TeamAgentView[]
  selectedAgentId: string | null
  onSelectAgent: (agentId: string | null) => void
  className?: string
}) {
  return (
    <section
      aria-label="Team agents, list view"
      className={clsx(
        // Pairs with the caller's `lg:sr-only`: hidden while nothing inside is
        // focused, a real panel the moment something is.
        'lg:focus-within:not-sr-only lg:focus-within:border-t lg:focus-within:border-white/5',
        className
      )}
    >
      <Subheading level={2} tone="neutral" className="px-4 py-3 tracking-tight text-white">
        Team agents
      </Subheading>
      {/* Bounded box, data scrolls inside it: the roster can be long and the
          surrounding card is `overflow-hidden`, so an unbounded list would be
          clipped instead of scrolled. Focus moves scroll the row into view. */}
      <ul role="list" className="max-h-80 divide-y divide-white/5 overflow-y-auto">
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
                  selected
                    ? 'bg-[var(--accent-surface)] ring-1 ring-inset ring-[var(--accent-line-strong)]'
                    : 'hover:bg-white/5'
                )}
              >
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-white">{agent.name}</span>
                  <span className="text-sm font-medium text-zinc-400">{humanizeStatus(agent.status)}</span>
                </span>
                <span className="text-xs text-zinc-500">
                  {agent.role ?? 'Role not documented'}
                  {' · '}
                  {/* Screen readers get the SAME distinction the panel makes:
                      an unreadable run set must not be announced as the fact
                      "no run recorded". */}
                  {age ? `last activity ${age}` : lastActivityFallback(agent.runHistory)}
                </span>
              </Headless.Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
