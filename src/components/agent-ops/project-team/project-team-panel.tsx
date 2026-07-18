'use client'

import {
  ArrowDownLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpRightIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { useEffect, useRef } from 'react'

import { StatusPill } from '@/components/agent-ops/status-pill'
import { Badge } from '@/components/catalyst/badge'
import { Divider } from '@/components/catalyst/divider'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import type {
  ProjectTeamEdge,
  ProjectTeamGraph,
  ProjectTeamNode,
  ProjectTeamNodeStatus,
} from '@/lib/agent-mission-control/project-team/types'

/* ==========================================================================
 * View layer over the read contract (project-team/types.ts).
 *
 * The contract already forbids fabrication (an unreadable value is `null`, a
 * node whose data could not be read is `unavailable`). This layer's only job is
 * to turn those nulls into an EXPLICIT unavailable affordance — never into a
 * zero, a dash that reads like "none", or an invented default.
 * ======================================================================== */

const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })
const plainFormat = new Intl.NumberFormat('en-US')

export interface TeamMetric {
  key: string
  label: string
  /** null = the backend could not measure it. Renders as "unavailable", never 0. */
  value: string | null
}

export interface TeamAgentView {
  id: string
  kind: ProjectTeamNode['kind']
  name: string
  slug: string | null
  role: string | null
  description: string | null
  team: string | null
  runtime: string | null
  model: string | null
  status: ProjectTeamNodeStatus
  href: string | null
  lastActivityAt: string | null
  latestRunId: string | null
  latestRunStatus: string | null
  metrics: TeamMetric[]
  tools: string[]
  /** Same-day run count for this agent — feeds the page-level "Runs today". */
  runsToday: number
}

/** Flatten one contract node into what every surface in this folder renders. */
export function toTeamAgentView(node: ProjectTeamNode): TeamAgentView {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    slug: node.slug,
    role: node.role,
    description: node.description,
    team: node.team,
    runtime: node.runtime,
    model: node.model,
    status: node.status,
    href: node.href,
    lastActivityAt: node.latestRun?.completedAt ?? node.latestRun?.startedAt ?? null,
    latestRunId: node.latestRun?.id ?? null,
    latestRunStatus: node.latestRun?.status ?? null,
    metrics: [
      { key: 'totalRuns', label: 'Total runs', value: plainFormat.format(node.metrics.totalRuns) },
      { key: 'runsToday', label: 'Runs today', value: plainFormat.format(node.metrics.runsToday) },
      {
        key: 'successRate',
        label: 'Success rate',
        // null = no terminal run exists yet. A "0%" here would be a lie.
        value: node.metrics.successRate === null ? null : percentFormat.format(node.metrics.successRate),
      },
    ],
    tools: node.tools.map((tool) => tool.name),
    runsToday: node.metrics.runsToday,
  }
}

export interface TeamEdgeView {
  id: string
  source: string
  target: string
  relation: ProjectTeamEdge['relation']
  origin: ProjectTeamEdge['origin']
  label: string | null
  active: boolean
  lastActivityAt: string | null
}

export function toTeamEdgeView(edge: ProjectTeamEdge): TeamEdgeView {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    origin: edge.origin,
    label: edge.label,
    active: edge.active,
    lastActivityAt: edge.lastActivityAt,
  }
}

export function readGraphNodes(graph: ProjectTeamGraph | null): ProjectTeamNode[] {
  return graph?.nodes ?? []
}

export function readGraphEdges(graph: ProjectTeamGraph | null): ProjectTeamEdge[] {
  return graph?.edges ?? []
}

/** When the graph was built. Null only when there is no graph at all. */
export function readGraphFreshness(graph: ProjectTeamGraph | null): string | null {
  return graph?.generatedAt ?? null
}

/**
 * Operator buckets for the KPI band. The contract's seven statuses map onto
 * five buckets; `idle` and `draft` are NOT "waiting" (they are observed
 * absences of work, not queued work), and `unavailable` is its own thing —
 * counting it as anything else would be inventing a state.
 */
export type StatusBucket = 'active' | 'waiting' | 'blocked' | 'failed' | 'idle' | 'draft' | 'unavailable'

export function statusBucket(status: ProjectTeamNodeStatus): StatusBucket {
  return status
}

const STATUS_LABELS: Record<ProjectTeamNodeStatus, string> = {
  active: 'Running',
  waiting: 'Waiting',
  blocked: 'Blocked',
  failed: 'Failed',
  idle: 'Idle',
  draft: 'Draft',
  unavailable: 'Unavailable',
}

export function humanizeStatus(status: string): string {
  if (status in STATUS_LABELS) return STATUS_LABELS[status as ProjectTeamNodeStatus]
  const spaced = status.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const RELATION_LABELS: Record<ProjectTeamEdge['relation'], string> = {
  'project-membership': 'Member of project',
  'team-membership': 'Member of team',
  orchestrates: 'Orchestrates',
  'depends-on': 'Depends on',
  'sends-output-to': 'Sends output to',
  reviews: 'Reviews',
  triggers: 'Triggers',
  'shares-tool': 'Shares a tool with',
}

/**
 * Relative age against `Date.now()`. Null when the timestamp is absent or
 * unparseable — the caller then renders the explicit unavailable affordance
 * instead of a made-up "just now".
 */
export function formatAge(iso: string | null): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/* ========================================================================== */

const UNAVAILABLE = <span className="text-zinc-600">— unavailable</span>

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">{label}</dt>
      <dd className="text-sm text-zinc-200">{children}</dd>
    </div>
  )
}

function RelationRow({
  edge,
  counterpart,
  direction,
}: {
  edge: TeamEdgeView
  counterpart: TeamAgentView | undefined
  direction: 'in' | 'out'
}) {
  const Icon = direction === 'in' ? ArrowDownLeftIcon : ArrowUpRightIcon
  const age = formatAge(edge.lastActivityAt)
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-200">
          {counterpart?.name ?? (direction === 'in' ? edge.source : edge.target)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{edge.label ?? RELATION_LABELS[edge.relation]}</span>
          {/* Provenance is load-bearing, not decoration: a relation the platform
              INFERRED must never read like something an operator configured. */}
          <Badge color="zinc">{edge.origin === 'derived' ? 'Derived' : 'Configured'}</Badge>
          {age ? <span>· {age}</span> : null}
        </p>
      </div>
    </li>
  )
}

export function ProjectTeamPanel({
  agent,
  incoming,
  outgoing,
  nodesById,
  onClose,
}: {
  agent: TeamAgentView
  incoming: TeamEdgeView[]
  outgoing: TeamEdgeView[]
  nodesById: Map<string, TeamAgentView>
  onClose: () => void
}) {
  const headingRef = useRef<HTMLDivElement | null>(null)

  // Focus moves INTO the panel on open and returns to whatever opened it on
  // close (a canvas node, a row of the accessible list) — keyboard users are
  // never dumped back at the top of the document.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    headingRef.current?.focus()
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [agent.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const agentLinks =
    agent.kind === 'agent'
      ? [
          { label: 'Open agent', href: `/admin/agents/${agent.id}` },
          { label: 'Open runs', href: `/admin/agents/${agent.id}/runs` },
          { label: 'Open benchmark', href: `/admin/agents/${agent.id}/tests#benchmarks` },
          { label: 'Open configuration', href: `/admin/agents/${agent.id}/manifest` },
        ]
      : []

  const age = formatAge(agent.lastActivityAt)
  const derivedOnly =
    incoming.concat(outgoing).length > 0 &&
    incoming.concat(outgoing).every((edge) => edge.origin === 'derived')

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`${agent.name} details`}
      className={clsx(
        // Overlay, never a layout column: the canvas keeps its full width
        // underneath instead of being squeezed every time a node is clicked.
        'absolute inset-0 z-20 flex flex-col overflow-y-auto border-white/10 bg-[var(--color-surface-canvas)]',
        'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:border-l lg:w-[26rem]'
      )}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/5 bg-[var(--color-surface-canvas)] px-5 py-4">
        <div ref={headingRef} tabIndex={-1} className="min-w-0 focus:outline-none">
          <h2 className="truncate text-base font-semibold text-white">{agent.name}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{agent.slug ?? agent.id}</p>
        </div>
        <Headless.Button
          onClick={onClose}
          aria-label="Close agent details"
          className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <XMarkIcon aria-hidden="true" className="size-5" />
        </Headless.Button>
      </div>

      <div className="flex flex-col gap-6 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={humanizeStatus(agent.status)}
            tone={agent.status === 'active' ? 'accent' : 'zinc'}
          />
          {agent.team ? <Badge color="zinc">{agent.team}</Badge> : null}
        </div>

        {agent.description ? <Text className="text-sm text-zinc-400">{agent.description}</Text> : null}

        <dl className="grid grid-cols-2 gap-4">
          <Field label="Role">
            {agent.role ?? <span className="text-zinc-600">— not recorded</span>}
          </Field>
          <Field label="Runtime">{agent.runtime ?? UNAVAILABLE}</Field>
          <Field label="Model">
            {agent.model ? <span className="font-mono text-xs">{agent.model}</span> : UNAVAILABLE}
          </Field>
          <Field label="Last activity">
            {age ? (
              <span title={agent.lastActivityAt ?? undefined}>{age}</span>
            ) : (
              <span className="text-zinc-600">— no run recorded</span>
            )}
          </Field>
        </dl>

        <div>
          <h3 className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">Metrics</h3>
          <dl className="mt-3 grid grid-cols-3 gap-4">
            {agent.metrics.map((metric) => (
              <div key={metric.key} className="flex flex-col gap-1">
                <dt className="text-xs text-zinc-500">{metric.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-white">
                  {metric.value ?? <span className="text-zinc-600">n/a</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">Tools</h3>
          {agent.tools.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <li key={tool}>
                  <Badge color="zinc">
                    <span className="font-mono text-xs">{tool}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">No tool declared.</p>
          )}
        </div>

        <Divider soft />

        {derivedOnly ? (
          <p className="text-xs text-zinc-500">
            Every relation below was <strong className="font-medium text-zinc-400">derived</strong> from
            observable evidence (shared tools, mission participation, project membership). None of them
            is a relation someone configured.
          </p>
        ) : null}

        <div>
          <h3 className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
            Incoming relations
          </h3>
          {incoming.length > 0 ? (
            <ul className="mt-2 divide-y divide-white/5">
              {incoming.map((edge) => (
                <RelationRow key={edge.id} edge={edge} counterpart={nodesById.get(edge.source)} direction="in" />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">
              No incoming relation is configured or derivable for this agent.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
            Outgoing relations
          </h3>
          {outgoing.length > 0 ? (
            <ul className="mt-2 divide-y divide-white/5">
              {outgoing.map((edge) => (
                <RelationRow key={edge.id} edge={edge} counterpart={nodesById.get(edge.target)} direction="out" />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">
              No outgoing relation is configured or derivable for this agent.
            </p>
          )}
        </div>

        {agent.latestRunId ? (
          <div>
            <h3 className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">Recent run</h3>
            <p className="mt-2 text-sm text-zinc-300">
              {humanizeStatus(agent.latestRunStatus ?? 'unavailable')}
              <span className="ml-2 font-mono text-xs text-zinc-500">{agent.latestRunId}</span>
            </p>
          </div>
        ) : null}

        {agentLinks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {agentLinks.map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
              >
                {label}
                <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-4 text-zinc-500" />
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
