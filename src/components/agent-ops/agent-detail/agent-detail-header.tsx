import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import { TimeAgoValue } from './agent-value'

/**
 * Agent header (AIGENT-AGENT-PAGES-021).
 *
 * Two things it must get right, both of which the legacy header got wrong:
 *
 * 1. Status and executability are DIFFERENT claims. The old header showed the
 *    stored status only, so an agent could read green while the run route 409'd.
 *    Both are shown, and the run affordance follows executability.
 * 2. A blocked agent states WHY as visible text. A disabled button with a
 *    tooltip hides the reason behind a hover an operator may never perform —
 *    and is invisible on touch.
 *
 * Status never rides on colour alone: every badge carries a word.
 */

function statusBadge(status: string): 'zinc' | 'accent' | 'accentStrong' | 'accentSolid' {
  switch (status) {
    case 'active':
      return 'accent'
    case 'degraded':
      return 'accentStrong'
    case 'unavailable':
      return 'accentSolid'
    default:
      return 'zinc'
  }
}

export function AgentDetailHeader({ detail }: { detail: AgentDetail }) {
  const { copilot, agent, currentVersion, executable, blockers, metrics } = detail
  const status = agent?.status ?? 'unavailable'

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        <Link
          href={copilot.projectId ? `/admin/projects/${copilot.projectId}` : '/admin/agents'}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {copilot.projectId ? 'Project' : 'Agents'}
        </Link>
      </nav>

      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <CopilotAvatar copilot={copilot} className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Heading level={1} className="truncate">
                {copilot.name}
              </Heading>
              <Badge color={statusBadge(status)}>{status}</Badge>
              {/* Executability is the claim that actually predicts a run. */}
              <Badge color={executable ? 'accent' : 'zinc'}>
                {executable ? 'Executable' : 'Not executable'}
              </Badge>
              {/* Read-only and "approval required" are not contradictory but they
                  read as such side by side: with every mounted tool a read, the
                  approval policy is dormant, not active. Say which it is. */}
              {agent?.readOnly ? <Badge color="zinc">Read-only</Badge> : null}
              {agent?.requiresHumanApproval ? (
                <Badge color="accentStrong">
                  {agent.readOnly ? 'Approval on write' : 'Approval required'}
                </Badge>
              ) : null}
            </div>

            {copilot.description ? (
              <Text className="mt-2 max-w-2xl !text-sm">{copilot.description}</Text>
            ) : null}

            <dl className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5">
              <div className="flex items-baseline gap-2">
                <dt className={eyebrowClass}>Model</dt>
                <dd className="font-mono text-xs tabular-nums text-zinc-400">
                  {agent?.configuredModel ?? copilot.model}
                  <span className="text-zinc-600"> · {agent?.provider ?? copilot.modelProvider}</span>
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className={eyebrowClass}>Version</dt>
                <dd className="font-mono text-xs tabular-nums text-zinc-400">
                  {currentVersion?.label ?? '—'}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className={eyebrowClass}>Last run</dt>
                <dd className="text-xs text-zinc-400">
                  <TimeAgoValue value={metrics.lastRun?.startedAt ?? null} />
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Actions stay above the fold on desktop and stack first on mobile.
            A Catalyst Button given `href` renders as a Link, and a link ignores
            `disabled` — it would stay clickable and lead to a run form the API
            refuses. Dropping `href` makes Catalyst render a Headless.Button
            instead, which honours `disabled`, so the affordance matches what the
            run gate would actually do. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {executable ? (
            <>
              <Button color="accent" href={`/admin/agents/${copilot.id}/runs`}>
                Run agent
              </Button>
              <Button outline href={`/admin/agents/${copilot.id}/runs`}>
                Dry run
              </Button>
            </>
          ) : (
            <>
              <Button color="accent" disabled aria-describedby="agent-run-blockers">
                Run agent
              </Button>
              <Button outline disabled aria-describedby="agent-run-blockers">
                Dry run
              </Button>
            </>
          )}
        </div>
      </div>

      {/* The reason, as text. Never a tooltip — an operator on touch never sees one. */}
      {!executable && blockers.length > 0 ? (
        <div
          id="agent-run-blockers"
          className="mt-4 rounded-xl bg-[var(--color-surface-raised)] p-4 ring-1 ring-[var(--accent-line)] ring-inset"
        >
          <p className={eyebrowClass}>Cannot run</p>
          <ul className="mt-2 flex flex-col gap-2">
            {blockers.map((b) => (
              <li key={b.code} className="text-sm">
                <span className="font-medium text-zinc-100">{b.label}</span>
                <span className="text-zinc-400"> — {b.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
