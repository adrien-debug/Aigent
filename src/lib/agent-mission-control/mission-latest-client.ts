/**
 * Client-side helpers for hydrating the latest persisted mission on project pages.
 * Pure parsing only — no I/O (testable without a browser runtime).
 */
import type { MissionFinding, MissionReport } from './mission-orchestrator'

export const MISSION_DATA_UNAVAILABLE = 'Mission data unavailable'

export interface LatestMissionApiResponse {
  ok?: boolean
  mission?: {
    objective?: string
    report?: MissionReport
    findings?: MissionFinding[]
  } | null
  error?: string
}

export type LatestMissionHydration =
  | { phase: 'idle'; report: null; objective: string | null }
  | { phase: 'ready'; report: MissionReport; objective: string }

/** Build the GET URL for the latest mission (no POST). */
export function latestMissionUrl(projectId: string): string {
  return `/api/agent-ops/projects/${encodeURIComponent(projectId)}/missions/latest`
}

/**
 * Map GET /missions/latest JSON into UI state.
 * Returns idle when no mission exists; never throws.
 */
export function parseLatestMissionResponse(
  payload: LatestMissionApiResponse | null
): LatestMissionHydration {
  if (!payload?.ok || !payload.mission) {
    return { phase: 'idle', report: null, objective: null }
  }

  const { mission } = payload
  const report = mission.report
  if (!report) {
    return {
      phase: 'idle',
      report: null,
      objective: typeof mission.objective === 'string' ? mission.objective : null,
    }
  }

  const findings =
    report.findings.length > 0
      ? report.findings
      : (mission.findings ?? report.findings)

  const objective =
    (typeof mission.objective === 'string' && mission.objective.trim()
      ? mission.objective
      : report.objective) ?? report.objective

  return {
    phase: 'ready',
    report: { ...report, findings },
    objective,
  }
}
