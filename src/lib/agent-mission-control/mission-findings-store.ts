/**
 * Agent Mission Control — Mission findings persistence (server only).
 */
import 'server-only'

import { pgrest } from './postgrest'
import type { MissionFinding } from './mission-orchestrator'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

export async function persistMissionFindings(findings: MissionFinding[]): Promise<void> {
  if (findings.length === 0) return
  await pgrest('POST', 'mission_findings', findings.map((f) => ({
    id: f.id,
    mission_run_id: f.missionRunId,
    copilot_id: f.copilotId,
    role: f.role,
    severity: f.severity,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
    recommendation: f.recommendation,
  })))
}

export async function getMissionFindings(missionRunId: string): Promise<MissionFinding[]> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `mission_findings?${eq('mission_run_id', missionRunId)}&select=*&order=created_at.asc`
  )
  return rows.map((row) => ({
    id: row.id as string,
    missionRunId: row.mission_run_id as string,
    copilotId: (row.copilot_id as string | null) ?? null,
    role: row.role as MissionFinding['role'],
    severity: row.severity as MissionFinding['severity'],
    title: row.title as string,
    description: row.description as string,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    recommendation: (row.recommendation as string | null) ?? null,
  }))
}
