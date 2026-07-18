'use client'

import { FunnelIcon, UsersIcon } from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SoftAccentButton } from '@/components/agent-ops/soft-accent-link'
import { Link } from '@/components/catalyst/link'

/**
 * Two DISTINCT empty states — conflating them is the classic trap: an operator
 * who filtered everything out must never be told the project has no team.
 *
 *  - `ProjectTeamNoAgentsEmptyState`: the project genuinely has zero agents.
 *    Routes to the Agent Builder. Renders NO graph — a fictional network drawn
 *    to "show what it could look like" is exactly the lie this surface exists
 *    to avoid.
 *  - `ProjectTeamNoMatchEmptyState`: agents exist, the active filters match
 *    none of them. Routes back to an unfiltered view.
 */
export function ProjectTeamNoAgentsEmptyState({ projectId }: { projectId: string }) {
  return (
    <EmptyState
      icon={UsersIcon}
      title="No team has been assembled yet."
      description="This project has no agent attached. Agents appear here — with their real relations, activity and metrics — as soon as one is created for this project and validated."
      action={
        <Link
          href={`/admin/projects/${projectId}/builder`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-accent-700 ring-1 ring-[var(--accent-line)] transition-colors hover:bg-[var(--accent-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300"
        >
          Open Agent Builder
        </Link>
      }
    />
  )
}

export function ProjectTeamNoMatchEmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <EmptyState
      icon={FunnelIcon}
      title="No agent matches these filters."
      description="The project does have a team — the current combination of search, status, runtime and team filters simply excludes every agent."
      action={<SoftAccentButton onClick={onClearFilters}>Clear filters</SoftAccentButton>}
    />
  )
}

/**
 * Backend refused to answer. Fail-closed: we say so plainly and precisely
 * instead of drawing a locally-reconstructed graph that would look authoritative
 * while being invented.
 */
export function ProjectTeamUnavailableState({ detail }: { detail: string }) {
  return (
    <EmptyState
      icon={UsersIcon}
      title="Team graph unavailable"
      description={detail}
    />
  )
}
