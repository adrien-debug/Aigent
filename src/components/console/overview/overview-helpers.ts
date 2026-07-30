/** Shared pure helpers for the /admin overview. */

import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'
import type { StatusDotTone } from '@/components/ui/status-dot'
import type { RuntimeTelemetryProvenance } from '@/lib/agent-mission-control/runtime-telemetry-provenance'

export const OVERVIEW_WINDOW_LABEL = '24h window · UTC'

export const RUN_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'failed',
  'blocked',
  'needs-confirmation',
  'running',
]

export const REAL_ROUTES: readonly RegExp[] = [
  /^\/admin$/,
  /^\/admin\/runs$/,
  /^\/admin\/projects$/,
  /^\/admin\/agents$/,
  /^\/admin\/agents\/[^/]+$/,
  /^\/admin\/projects\/[^/]+\/builder$/,
]

export const RUNS_UNREAD_DETAIL = 'Run history could not be read'
export const RUNS_UNREAD_TITLE = 'Run history unavailable'

const ACTION_KIND_LABEL: Record<ActionItemKind, string> = {
  architect_approval: 'Approval',
  ready_manual: 'Ready',
  sandbox_failed: 'Failed',
  release_gate_red: 'Blocked',
  pr_open: 'Ready',
  mission_blocked: 'Blocked',
  data_unavailable: 'Data unavailable',
}

export function actionKindLabel(kind: ActionItemKind): string {
  return ACTION_KIND_LABEL[kind]
}

export function resolveConsoleHref(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href
  const path = href.split(/[?#]/)[0]
  return REAL_ROUTES.some((route) => route.test(path)) ? href : null
}

export function formatClockUtc(epochMs: number): string {
  const date = new Date(epochMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

export function formatDeliveryStamp(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const date = new Date(ms)
  const day = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  return `${day} ${formatClockUtc(ms)}`
}

export function runStatusTone(status: AgentRunStatus): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

export function actionStatusTone(status: string): StatusDotTone {
  return status === 'failed' || status === 'blocked' || status === 'unavailable' ? 'negative' : 'neutral'
}

export function telemetryProvenanceLabel(provenance: RuntimeTelemetryProvenance): string {
  switch (provenance) {
    case 'internal':
      return 'internal'
    case 'lifecycle':
      return 'lifecycle'
    case 'consumer':
      return 'consumer'
    case 'unknown':
      return 'unknown'
  }
}

export type TrendBuckets = {
  xLabels: string[]
  completed: number[]
  failed: number[]
  running: number[]
  blocked: number[]
  needsConfirmation: number[]
  total: number[]
}

const TREND_BUCKET_COUNT = 12

export function bucketRunsByStartTime(runs: AgentRun[], bucketCount = TREND_BUCKET_COUNT): TrendBuckets {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const run of runs) {
    const started = Date.parse(run.startedAt)
    if (!Number.isFinite(started)) continue
    if (started < first) first = started
    if (started > last) last = started
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return {
      xLabels: [],
      completed: [],
      failed: [],
      running: [],
      blocked: [],
      needsConfirmation: [],
      total: [],
    }
  }

  const span = last - first
  const buckets = span > 0 ? Math.max(1, bucketCount) : 1
  const width = span > 0 ? span / buckets : 0

  const empty = () => Array.from({ length: buckets }, () => 0)
  const completed = empty()
  const failed = empty()
  const running = empty()
  const blocked = empty()
  const needsConfirmation = empty()
  const total = empty()

  for (const run of runs) {
    const started = Date.parse(run.startedAt)
    if (!Number.isFinite(started)) continue
    const raw = width > 0 ? Math.floor((started - first) / width) : 0
    const index = Math.min(buckets - 1, Math.max(0, raw))
    total[index] += 1
    if (run.status === 'completed') completed[index] += 1
    else if (run.status === 'failed') failed[index] += 1
    else if (run.status === 'running') running[index] += 1
    else if (run.status === 'blocked') blocked[index] += 1
    else if (run.status === 'needs-confirmation') needsConfirmation[index] += 1
  }

  return {
    xLabels: Array.from({ length: buckets }, (_, index) => formatClockUtc(first + index * width)),
    completed,
    failed,
    running,
    blocked,
    needsConfirmation,
    total,
  }
}

export function countRunsByStatus(runs: AgentRun[]): Record<AgentRunStatus, number> {
  const counts: Record<AgentRunStatus, number> = {
    completed: 0,
    failed: 0,
    blocked: 0,
    'needs-confirmation': 0,
    running: 0,
  }
  for (const run of runs) counts[run.status] += 1
  return counts
}

export function sortActionItems(items: ActionItem[]): ActionItem[] {
  return [...items].toSorted((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
}
