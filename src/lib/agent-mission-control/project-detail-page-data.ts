import 'server-only'

import { notFound } from 'next/navigation'

import { getAvailableAgents } from './available-agents'
import { getCopilots, getProject, getRecentRunsForProject } from './data'
import { getConsumerProvisionStatus, type ConsumerProvisionStatus } from './github'
import type { AgentRun, Copilot, Project } from './types'

/** Raw numbers only — JSX (KPI band `content`) is built in the view, not here. */
export type ProjectDetailKpis = {
  validatedCount: number
  executableCount: number
  runsLast24h: number
  hasRunVolumeSignal: boolean
  costLast24hUsd: number
  successRate: number | null
  finishedRunsCount: number
  servedCount: number
}

export type ProjectDetailPageData = {
  project: Project
  validated: Copilot[]
  runs: AgentRun[]
  copilotNameById: Map<string, string>
  consumerStatus: ConsumerProvisionStatus | null
  kpis: ProjectDetailKpis
}

/**
 * `/admin/projects/:id` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`). Mirrors the exact
 * fetch + derivation logic that used to live inline in `page.tsx`.
 */
export async function getProjectDetailPageData(id: string): Promise<ProjectDetailPageData> {
  const [project, copilots, runs, availableAgents] = await Promise.all([
    getProject(id),
    getCopilots({ health: 'list' }),
    getRecentRunsForProject(id, 20),
    getAvailableAgents(),
  ])
  if (!project) notFound()

  const consumerStatus = project.repoFullName
    ? await getConsumerProvisionStatus(project.repoFullName).catch(() => null)
    : null

  const validated = copilots.filter((copilot) => copilot.projectId === project.id)
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  /**
   * `executable` = "can the run gate actually launch it right now" — the run
   * gate's own truth (`AvailableAgent.executable`, `runtime-catalogue.
   * isExecutable`: active AND every declared tool resolved). Deliberately NOT
   * `copilot.status === 'active'`: that count sits in the shared
   * `dashboard-overview.ts` rollup (`activeCount`) and undercounts — a copilot
   * promoted to production while its stored status still reads `draft` is
   * executable but would not be counted there. Reported, not fixed here (out
   * of this page's owned files) — see crossBoundaryDeps.
   */
  const executableByCopilotId = new Map(availableAgents.map((agent) => [agent.copilotId, agent.executable]))
  const executableCount = validated.filter((copilot) => executableByCopilotId.get(copilot.id) === true).length

  /**
   * Success = run-weighted over this project's actual recent runs, never the
   * unweighted mean-of-per-copilot-pass-rates that `dashboard-overview.ts`
   * computes for the project LIST (`passRates.reduce(...) / passRates.length`
   * — one copilot with 2 runs counts the same as one with 200). `runs` here is
   * this project's real run rows, so a plain completed/total over them is
   * already correctly weighted; no shared resolver involved.
   */
  const finishedRuns = runs.filter((run) => run.status === 'completed' || run.status === 'failed')
  const successRate = finishedRuns.length > 0
    ? finishedRuns.filter((run) => run.status === 'completed').length / finishedRuns.length
    : null

  const runsLast24h = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const hasRunVolumeSignal = validated.some((copilot) => copilot.healthEvidence === 'runs')
  const costLast24hUsd = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  const servedCount = validated.filter((copilot) => copilot.productionVersionId !== null).length

  const kpis: ProjectDetailKpis = {
    validatedCount: validated.length,
    executableCount,
    runsLast24h,
    hasRunVolumeSignal,
    costLast24hUsd,
    successRate,
    finishedRunsCount: finishedRuns.length,
    servedCount,
  }

  return { project, validated, runs, copilotNameById, consumerStatus, kpis }
}
