/**
 * Agent Mission Control — Dashboard overview (pure + server collector).
 *
 * Aggregates delivery-centric signals for the Agent Delivery Command Center.
 * Read-only, fail-soft: missing tables never crash the dashboard.
 */
import 'server-only'

import { DELIVERY_LEVEL_LABELS } from './delivery-scorecard'
import { getDeliveryScorecard } from './delivery-scorecard-server'
import type { DeliveryEvent } from './delivery-events-store'
import { getCopilots, getProjects } from './data'
import type { MissionReport } from './mission-orchestrator'
import { pgrest } from './postgrest'
import { parseSandboxReport, type TargetRepoSandboxReport } from './target-repo-sandbox'
import type { Copilot, Project } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardKpis = {
  productionAgents: number | null
  readyForManualTest: number | null
  sandboxPassRate: number | null
  avgRepoFit: number | null
  blockedDeliveries: number | null
}

export type DeliveryStepId = 'build' | 'scorecard' | 'pr' | 'sandbox' | 'manual_test' | 'merged'

export type DeliveryStepState = 'past' | 'current' | 'pending' | 'failed'

export type DeliveryLoopItem = {
  id: string
  agentId: string
  agentName: string
  targetRepo: string | null
  currentState: string
  steps: Record<DeliveryStepId, DeliveryStepState>
  lastUpdate: string
  source: 'delivery' | 'mission'
}

export type ActionItemKind =
  | 'ready_manual'
  | 'sandbox_failed'
  | 'release_gate_red'
  | 'pr_open'
  | 'mission_blocked'
  | 'data_unavailable'

export type ActionItem = {
  id: string
  kind: ActionItemKind
  title: string
  meta: string
  status: string
  href: string
  buttonLabel: string
  priority: number
}

export type DeliveryMatrixRow = {
  agentId: string
  agentName: string
  targetRepo: string | null
  repoFit: number | null
  scorecardScore: number | null
  scorecardLabel: string | null
  sandboxStatus: string | null
  deliveryStatus: string | null
  nextAction: { label: string; href: string }
  updatedAt: string | null
}

export type DashboardOverview = {
  kpis: DashboardKpis
  deliveryLoop: DeliveryLoopItem[]
  actionItems: ActionItem[]
  deliveryMatrix: DeliveryMatrixRow[]
  dataWarnings: string[]
}

type SandboxSnapshot = {
  copilotId: string
  status: TargetRepoSandboxReport['status']
  sandboxFitScore: number | null
  repoFitScore: number | null
  repo: string | null
  createdAt: string
}

type ScorecardSnapshot = {
  score: number
  level: string
  blockers: string[]
  repoFitScore: number | null
  releaseGateRed: boolean
}

type MissionRunSnapshot = {
  id: string
  projectId: string
  objective: string
  status: string
  decision: string | null
  repo: string | null
  updatedAt: string
  report: MissionReport | null
}

// ---------------------------------------------------------------------------
// Pure — KPIs
// ---------------------------------------------------------------------------

export function computeProductionAgents(
  copilots: Pick<Copilot, 'productionVersionId' | 'displayStatus'>[]
): number {
  return copilots.filter((c) => Boolean(c.productionVersionId) || c.displayStatus === 'production').length
}

export function computeReadyForManualTest(events: Pick<DeliveryEvent, 'status'>[]): number {
  return events.filter((e) => e.status === 'ready_for_manual_test').length
}

export function computeSandboxPassRate(reports: Pick<SandboxSnapshot, 'status'>[]): number | null {
  if (reports.length === 0) return null
  const passed = reports.filter((r) => r.status === 'passed').length
  return Math.round((passed / reports.length) * 100)
}

export function computeAvgRepoFit(scores: number[]): number | null {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
}

export function isBlockedDelivery(input: {
  deliveryStatus: string | null
  sandboxStatus: string | null
  scorecard: ScorecardSnapshot | null
  missionStatus: string | null
}): boolean {
  if (input.sandboxStatus === 'failed') return true
  if (input.missionStatus === 'blocked') return true
  if (input.deliveryStatus === 'execute_failed' || input.deliveryStatus === 'blocked') return true
  if (input.scorecard?.releaseGateRed) return true
  if (input.scorecard && input.scorecard.level === 'not_ready' && input.scorecard.blockers.length > 0) return true
  return false
}

export function computeBlockedDeliveries(
  copilotIds: string[],
  latestDeliveryByCopilot: Map<string, DeliveryEvent>,
  latestSandboxByCopilot: Map<string, SandboxSnapshot>,
  scorecards: Map<string, ScorecardSnapshot>,
  missionRuns: MissionRunSnapshot[]
): number {
  let count = 0
  const seen = new Set<string>()
  for (const id of copilotIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const blocked = isBlockedDelivery({
      deliveryStatus: latestDeliveryByCopilot.get(id)?.status ?? null,
      sandboxStatus: latestSandboxByCopilot.get(id)?.status ?? null,
      scorecard: scorecards.get(id) ?? null,
      missionStatus: null,
    })
    if (blocked) count += 1
  }
  count += missionRuns.filter((m) => m.status === 'blocked' || m.decision === 'blocked').length
  return count
}

// ---------------------------------------------------------------------------
// Pure — delivery loop steps
// ---------------------------------------------------------------------------

const STEP_ORDER: DeliveryStepId[] = ['build', 'scorecard', 'pr', 'sandbox', 'manual_test', 'merged']

export function deriveDeliverySteps(input: {
  deliveryStatus: string | null
  hasPr: boolean
  sandboxStatus: string | null
}): Record<DeliveryStepId, DeliveryStepState> {
  const status = input.deliveryStatus ?? 'created'
  const sandboxFailed = input.sandboxStatus === 'failed'

  const steps = Object.fromEntries(STEP_ORDER.map((s) => [s, 'pending' as DeliveryStepState])) as Record<
    DeliveryStepId,
    DeliveryStepState
  >

  const markPast = (through: DeliveryStepId) => {
    const idx = STEP_ORDER.indexOf(through)
    for (let i = 0; i <= idx; i += 1) steps[STEP_ORDER[i]] = 'past'
  }

  if (status === 'merged_validated' || status === 'completed') {
    STEP_ORDER.forEach((s) => {
      steps[s] = 'past'
    })
    return steps
  }

  if (status === 'ready_for_manual_test') {
    markPast('sandbox')
    steps.manual_test = 'current'
    return steps
  }

  if (sandboxFailed || status === 'execute_failed') {
    markPast('pr')
    steps.sandbox = 'failed'
    return steps
  }

  if (input.sandboxStatus === 'passed' || status === 'dry_run_passed') {
    markPast('sandbox')
    steps.manual_test = 'current'
    return steps
  }

  if (input.hasPr || status === 'redelivered' || status === 'delivered') {
    markPast('pr')
    steps.sandbox = 'current'
    return steps
  }

  if (status === 'fixing' || status === 'execute_running') {
    markPast('scorecard')
    steps.pr = 'current'
    return steps
  }

  markPast('build')
  steps.scorecard = 'current'
  return steps
}

export function buildDeliveryLoopItems(input: {
  copilotsById: Map<string, Copilot>
  projectsById: Map<string, Project>
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  missionRuns: MissionRunSnapshot[]
  limit?: number
}): DeliveryLoopItem[] {
  const items: DeliveryLoopItem[] = []

  for (const [copilotId, evt] of input.latestDeliveryByCopilot) {
    const copilot = input.copilotsById.get(copilotId)
    if (!copilot) continue
    const project = copilot.projectId ? input.projectsById.get(copilot.projectId) : undefined
    const sandbox = input.latestSandboxByCopilot.get(copilotId)
    items.push({
      id: `delivery_${evt.id}`,
      agentId: copilotId,
      agentName: copilot.name,
      targetRepo: evt.targetRepo ?? project?.repoFullName ?? null,
      currentState: evt.status,
      steps: deriveDeliverySteps({
        deliveryStatus: evt.status,
        hasPr: Boolean(evt.prUrl),
        sandboxStatus: sandbox?.status ?? null,
      }),
      lastUpdate: evt.createdAt,
      source: 'delivery',
    })
  }

  for (const mission of input.missionRuns) {
    items.push({
      id: `mission_${mission.id}`,
      agentId: mission.projectId,
      agentName: mission.objective.slice(0, 48),
      targetRepo: mission.repo,
      currentState: mission.status,
      steps: deriveDeliverySteps({
        deliveryStatus: mission.status === 'completed' ? 'merged_validated' : mission.status,
        hasPr: false,
        sandboxStatus: mission.decision === 'blocked' ? 'failed' : null,
      }),
      lastUpdate: mission.updatedAt,
      source: 'mission',
    })
  }

  return items
    .sort((a, b) => Date.parse(b.lastUpdate) - Date.parse(a.lastUpdate))
    .slice(0, input.limit ?? 10)
}

// ---------------------------------------------------------------------------
// Pure — action items
// ---------------------------------------------------------------------------

const ACTION_PRIORITY: Record<ActionItemKind, number> = {
  ready_manual: 1,
  sandbox_failed: 2,
  release_gate_red: 3,
  pr_open: 4,
  mission_blocked: 5,
  data_unavailable: 6,
}

export function buildActionItems(input: {
  copilotsById: Map<string, Copilot>
  projectsById: Map<string, Project>
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  scorecards: Map<string, ScorecardSnapshot>
  missionRuns: MissionRunSnapshot[]
  dataWarnings: string[]
  limit?: number
}): ActionItem[] {
  const items: ActionItem[] = []

  for (const [copilotId, evt] of input.latestDeliveryByCopilot) {
    const copilot = input.copilotsById.get(copilotId)
    if (!copilot) continue
    const project = copilot.projectId ? input.projectsById.get(copilot.projectId) : undefined
    const meta = `${copilot.name} · ${evt.targetRepo || project?.repoFullName || '—'}`

    if (evt.status === 'ready_for_manual_test') {
      items.push({
        id: `action_ready_${copilotId}`,
        kind: 'ready_manual',
        title: 'Ready for manual test',
        meta,
        status: evt.status,
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'Review',
        priority: ACTION_PRIORITY.ready_manual,
      })
    }

    const sandbox = input.latestSandboxByCopilot.get(copilotId)
    if (sandbox?.status === 'failed') {
      items.push({
        id: `action_sandbox_${copilotId}`,
        kind: 'sandbox_failed',
        title: 'Sandbox failed',
        meta,
        status: 'failed',
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'View Sandbox',
        priority: ACTION_PRIORITY.sandbox_failed,
      })
    }

    const card = input.scorecards.get(copilotId)
    if (card?.releaseGateRed) {
      items.push({
        id: `action_gate_${copilotId}`,
        kind: 'release_gate_red',
        title: 'Release gate red',
        meta,
        status: 'blocked',
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'View Scorecard',
        priority: ACTION_PRIORITY.release_gate_red,
      })
    }

    if (evt.prUrl && evt.status !== 'merged_validated' && evt.status !== 'completed') {
      items.push({
        id: `action_pr_${copilotId}`,
        kind: 'pr_open',
        title: evt.prNumber ? `PR #${evt.prNumber} awaiting review` : 'PR open awaiting review',
        meta,
        status: 'open',
        href: evt.prUrl,
        buttonLabel: 'Open PR',
        priority: ACTION_PRIORITY.pr_open,
      })
    }
  }

  for (const mission of input.missionRuns) {
    if (mission.status === 'blocked' || mission.decision === 'blocked') {
      const project = input.projectsById.get(mission.projectId)
      items.push({
        id: `action_mission_${mission.id}`,
        kind: 'mission_blocked',
        title: 'Mission blocked',
        meta: `${project?.name ?? mission.projectId} · ${mission.repo ?? '—'}`,
        status: mission.status,
        href: project ? `/admin/projects/${project.id}` : '/admin/projects',
        buttonLabel: 'View Mission',
        priority: ACTION_PRIORITY.mission_blocked,
      })
    }
  }

  for (const warning of input.dataWarnings) {
    items.push({
      id: `action_warn_${warning}`,
      kind: 'data_unavailable',
      title: warning,
      meta: 'System',
      status: 'unavailable',
      href: '/admin',
      buttonLabel: 'Review',
      priority: ACTION_PRIORITY.data_unavailable,
    })
  }

  return items
    .sort((a, b) => a.priority - b.priority)
    .slice(0, input.limit ?? 6)
}

// ---------------------------------------------------------------------------
// Pure — delivery matrix
// ---------------------------------------------------------------------------

export function resolveNextAction(input: {
  agentId: string
  projectId: string | null
  delivery: DeliveryEvent | null
  sandbox: SandboxSnapshot | null
  scorecard: ScorecardSnapshot | null
}): { label: string; href: string } {
  if (input.delivery?.prUrl && input.delivery.status !== 'merged_validated') {
    return { label: 'Review PR', href: input.delivery.prUrl }
  }
  if (input.delivery?.status === 'ready_for_manual_test') {
    return { label: 'Review', href: `/admin/agents/${input.agentId}` }
  }
  if (!input.sandbox) {
    return { label: 'Run Sandbox', href: `/admin/agents/${input.agentId}` }
  }
  if (input.scorecard) {
    return { label: 'View Scorecard', href: `/admin/agents/${input.agentId}` }
  }
  if (input.projectId) {
    return { label: 'View Mission', href: `/admin/projects/${input.projectId}` }
  }
  return { label: 'Open Agent', href: `/admin/agents/${input.agentId}` }
}

export function buildDeliveryMatrix(input: {
  copilots: Copilot[]
  projectsById: Map<string, Project>
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  scorecards: Map<string, ScorecardSnapshot>
}): DeliveryMatrixRow[] {
  const ranked = [...input.copilots].sort((a, b) => {
    const aDelivery = input.latestDeliveryByCopilot.has(a.id) ? 1 : 0
    const bDelivery = input.latestDeliveryByCopilot.has(b.id) ? 1 : 0
    if (aDelivery !== bDelivery) return bDelivery - aDelivery
    const aProd = a.productionVersionId ? 1 : 0
    const bProd = b.productionVersionId ? 1 : 0
    if (aProd !== bProd) return bProd - aProd
    return a.name.localeCompare(b.name)
  })

  return ranked
    .filter((c) => c.projectId || c.productionVersionId || input.latestDeliveryByCopilot.has(c.id))
    .slice(0, 20)
    .map((copilot) => {
      const project = copilot.projectId ? input.projectsById.get(copilot.projectId) : undefined
      const delivery = input.latestDeliveryByCopilot.get(copilot.id) ?? null
      const sandbox = input.latestSandboxByCopilot.get(copilot.id) ?? null
      const scorecard = input.scorecards.get(copilot.id) ?? null
      const repoFit = scorecard?.repoFitScore ?? sandbox?.repoFitScore ?? null

      return {
        agentId: copilot.id,
        agentName: copilot.name,
        targetRepo: delivery?.targetRepo ?? project?.repoFullName ?? null,
        repoFit,
        scorecardScore: scorecard?.score ?? null,
        scorecardLabel: scorecard ? DELIVERY_LEVEL_LABELS[scorecard.level as keyof typeof DELIVERY_LEVEL_LABELS] ?? scorecard.level : null,
        sandboxStatus: sandbox?.status ?? null,
        deliveryStatus: delivery?.status ?? (copilot.productionVersionId ? 'production' : null),
        nextAction: resolveNextAction({
          agentId: copilot.id,
          projectId: copilot.projectId,
          delivery,
          sandbox,
          scorecard,
        }),
        updatedAt: delivery?.createdAt ?? sandbox?.createdAt ?? copilot.updatedAt,
      }
    })
}

// ---------------------------------------------------------------------------
// Pure — assemble overview from snapshots
// ---------------------------------------------------------------------------

export function assembleDashboardOverview(input: {
  copilots: Copilot[]
  projects: Project[]
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  scorecards: Map<string, ScorecardSnapshot>
  missionRuns: MissionRunSnapshot[]
  dataWarnings: string[]
}): DashboardOverview {
  const copilotsById = new Map(input.copilots.map((c) => [c.id, c]))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))
  const copilotIds = input.copilots.map((c) => c.id)

  const latestDeliveries = [...input.latestDeliveryByCopilot.values()]
  const sandboxSnapshots = [...input.latestSandboxByCopilot.values()]
  const repoFitScores = [
    ...sandboxSnapshots.map((s) => s.repoFitScore).filter((n): n is number => n != null),
    ...[...input.scorecards.values()].map((s) => s.repoFitScore).filter((n): n is number => n != null),
  ]

  return {
    kpis: {
      productionAgents: computeProductionAgents(input.copilots),
      readyForManualTest: latestDeliveries.length > 0 ? computeReadyForManualTest(latestDeliveries) : 0,
      sandboxPassRate: computeSandboxPassRate(sandboxSnapshots),
      avgRepoFit: computeAvgRepoFit(repoFitScores),
      blockedDeliveries: computeBlockedDeliveries(
        copilotIds,
        input.latestDeliveryByCopilot,
        input.latestSandboxByCopilot,
        input.scorecards,
        input.missionRuns
      ),
    },
    deliveryLoop: buildDeliveryLoopItems({
      copilotsById,
      projectsById,
      latestDeliveryByCopilot: input.latestDeliveryByCopilot,
      latestSandboxByCopilot: input.latestSandboxByCopilot,
      missionRuns: input.missionRuns,
    }),
    actionItems: buildActionItems({
      copilotsById,
      projectsById,
      latestDeliveryByCopilot: input.latestDeliveryByCopilot,
      latestSandboxByCopilot: input.latestSandboxByCopilot,
      scorecards: input.scorecards,
      missionRuns: input.missionRuns,
      dataWarnings: input.dataWarnings,
    }),
    deliveryMatrix: buildDeliveryMatrix({
      copilots: input.copilots,
      projectsById,
      latestDeliveryByCopilot: input.latestDeliveryByCopilot,
      latestSandboxByCopilot: input.latestSandboxByCopilot,
      scorecards: input.scorecards,
    }),
    dataWarnings: input.dataWarnings,
  }
}

// ---------------------------------------------------------------------------
// Server collector — read-only, fail-soft
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>

function latestByCopilot<T extends { copilotId: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    if (!map.has(row.copilotId)) map.set(row.copilotId, row)
  }
  return map
}

async function fetchLatestDeliveryEvents(): Promise<Map<string, DeliveryEvent>> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'agent_delivery_events?select=*&order=created_at.desc&limit=200'
    )
    const map = new Map<string, DeliveryEvent>()
    for (const row of rows) {
      const copilotId = row.copilot_id as string
      if (map.has(copilotId)) continue
      map.set(copilotId, {
        id: row.id as string,
        mode: row.mode as DeliveryEvent['mode'],
        targetRepo: row.target_repo as string,
        targetBranch: (row.target_branch as string | null) ?? null,
        deliveryBranch: (row.delivery_branch as string | null) ?? null,
        commitSha: (row.commit_sha as string | null) ?? null,
        commitUrl: (row.commit_url as string | null) ?? null,
        prUrl: (row.pr_url as string | null) ?? null,
        prNumber: (row.pr_number as number | null) ?? null,
        status: row.status as string,
        createdAt: row.created_at as string,
      })
    }
    return map
  } catch {
    return new Map()
  }
}

async function fetchLatestSandboxSnapshots(): Promise<Map<string, SandboxSnapshot>> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'sandbox_reports?select=copilot_id,status,sandbox_fit_score,repo_fit_score,report,created_at&order=created_at.desc&limit=200'
    )
    const snapshots: SandboxSnapshot[] = []
    for (const row of rows) {
      const copilotId = row.copilot_id as string | null
      if (!copilotId) continue
      let repo: string | null = null
      try {
        const report = parseSandboxReport(row.report)
        repo = report.repo
      } catch {
        repo = null
      }
      snapshots.push({
        copilotId,
        status: row.status as SandboxSnapshot['status'],
        sandboxFitScore: (row.sandbox_fit_score as number | null) ?? null,
        repoFitScore: (row.repo_fit_score as number | null) ?? null,
        repo,
        createdAt: row.created_at as string,
      })
    }
    return latestByCopilot(snapshots)
  } catch {
    return new Map()
  }
}

async function fetchMissionRuns(): Promise<{ runs: MissionRunSnapshot[]; warning: string | null }> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'mission_runs?select=*&order=created_at.desc&limit=10'
    )
    return {
      runs: rows.map((row) => ({
        id: row.id as string,
        projectId: row.project_id as string,
        objective: row.objective as string,
        status: row.status as string,
        decision: (row.decision as string | null) ?? null,
        repo: (row.repo as string | null) ?? null,
        updatedAt: (row.updated_at as string) ?? (row.created_at as string),
        report: (row.report as MissionReport | null) ?? null,
      })),
      warning: null,
    }
  } catch {
    return { runs: [], warning: 'Mission data unavailable' }
  }
}

async function fetchScorecardsForCopilots(copilotIds: string[]): Promise<Map<string, ScorecardSnapshot>> {
  const map = new Map<string, ScorecardSnapshot>()
  const unique = [...new Set(copilotIds)].slice(0, 16)
  const results = await Promise.allSettled(unique.map((id) => getDeliveryScorecard(id, { target: 'auto' })))
  results.forEach((result, idx) => {
    if (result.status !== 'fulfilled' || !result.value) return
    const card = result.value
    map.set(unique[idx], {
      score: card.score,
      level: card.level,
      blockers: card.blockers,
      repoFitScore: card.evidence.repoFit?.score ?? null,
      releaseGateRed: card.blockers.includes('release_gate_red') || card.evidence.releaseGatePromotable === false,
    })
  })
  return map
}

/** Read-only dashboard overview for /admin. Never writes, never calls GitHub. */
export async function getDashboardOverview(): Promise<DashboardOverview> {
  const dataWarnings: string[] = []

  const [copilots, projects, latestDeliveryByCopilot, latestSandboxByCopilot, missionResult] =
    await Promise.all([
      getCopilots(),
      getProjects(),
      fetchLatestDeliveryEvents(),
      fetchLatestSandboxSnapshots(),
      fetchMissionRuns(),
    ])

  if (missionResult.warning) dataWarnings.push(missionResult.warning)

  const scorecardCopilotIds = [
    ...new Set([
      ...copilots.filter((c) => c.projectId || c.productionVersionId).map((c) => c.id),
      ...latestDeliveryByCopilot.keys(),
    ]),
  ]
  const scorecards = await fetchScorecardsForCopilots(scorecardCopilotIds)

  return assembleDashboardOverview({
    copilots,
    projects,
    latestDeliveryByCopilot,
    latestSandboxByCopilot,
    scorecards,
    missionRuns: missionResult.runs,
    dataWarnings,
  })
}
