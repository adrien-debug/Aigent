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

/** Hard cap per fetch — a run produces ~40 findings max by construction; aligned on the repo's limit=200 pattern. */
const MISSION_FINDINGS_LIMIT = 200

export async function getMissionFindings(missionRunId: string): Promise<MissionFinding[]> {
  // order=created_at.desc + limit → deterministic truncation keeping the most recent rows;
  // reversed below so callers still receive chronological (asc) order as before.
  const rows = await pgrest<RawRow[]>(
    'GET',
    `mission_findings?${eq('mission_run_id', missionRunId)}&select=*&order=created_at.desc&limit=${MISSION_FINDINGS_LIMIT}`
  )
  return rows.reverse().map((row) => ({
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
