'use client'

import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import { usePathname } from 'next/navigation'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Heading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'
import { AVAILABLE_AGENT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import { TimeAgoValue } from './agent-value'

/**
 * Agent header (AIGENT-AGENT-PAGES-021).
 *
 * Three things it must get right, all of which the legacy header got wrong:
 *
 * 1. Status and executability are DIFFERENT claims. The old header showed the
 *    stored status only, so an agent could read green while the run route 409'd.
 *    Both are shown, and the run affordance follows executability.
 * 2. A blocked agent states WHY as visible text. A disabled button with a
 *    tooltip hides the reason behind a hover an operator may never perform —
 *    and is invisible on touch.
 * 3. An affordance never promises a capability the backend does not have, and
 *    never links to the page the operator is already standing on
 *    (AIGENT-UI-TRUTH-026). This is why the header is a client component: the
 *    only way to know the current section is `usePathname`, and a link that
 *    leads nowhere is a worse cost than the props it serialises.
 *
 * Status never rides on colour alone: every badge carries a word.
 *
 * REMOVED (AIGENT-UI-TRUTH-026): the "Dry run" button. It carried the SAME href
 * as "Run agent", and the destination (run-copilot-panel.tsx) POSTs
 * `{ userInput }` to .../run with no dryRun flag and no variant — the runner has
 * no dry-run mode at all. The label promised a capability that does not exist.
 * Do not restore it until the runner exposes a distinct, non-billing execution
 * path AND the run surface can select it.
 */

function statusBadge(status: AvailableAgentStatus): 'zinc' | 'accent' | 'accentStrong' | 'accentSolid' {
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
  const status: AvailableAgentStatus = agent?.status ?? 'unavailable'
  const pathname = usePathname()

  // The run surface IS the runs section. Offering a link to it from that very
  // page is a dead affordance, so the action is withheld there — the run form
  // is already on screen, a few hundred pixels below.
  const runsHref = `/admin/agents/${copilot.id}/runs`
  const onRunsSurface = pathname === runsHref || pathname.startsWith(`${runsHref}/`)

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        {/* `zinc-400`: a breadcrumb is a LINK, so it falls under the "no
            interactive text below AA" rule rather than the quieter treatment
            allowed for meta — `zinc-500` measured 3.9 against this plane. */}
        <Link
          href={copilot.projectId ? `/admin/projects/${copilot.projectId}` : '/admin/agents'}
          className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
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
              <Badge color={statusBadge(status)}>{AVAILABLE_AGENT_STATUS_LABELS[status]}</Badge>
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
                  {/* `zinc-400`: at `zinc-600` the provider measured 2.44 against
                      this plane — barely half the AA threshold — on all eleven
                      agent-detail routes. Meta is quieter than the model name it
                      follows, it is not meant to be unreadable. */}
                  <span className="text-zinc-400"> · {agent?.provider ?? copilot.modelProvider}</span>
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
            run gate would actually do.

            The blocked branch still renders on the runs surface: a disabled
            button is not a link, so it is not self-referential, and it is what
            carries `aria-describedby` to the reasons below. */}
        {executable && onRunsSurface ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {executable ? (
              <Button color="accent" href={runsHref}>
                Run agent
              </Button>
            ) : (
              <Button color="accent" disabled aria-describedby="agent-run-blockers">
                Run agent
              </Button>
            )}
          </div>
        )}
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
