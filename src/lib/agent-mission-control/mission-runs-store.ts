/**
 * Agent Mission Control — Mission runs persistence (server only).
 */
import 'server-only'

import { pgrest } from './postgrest'
import type { MissionParticipant, MissionReport } from './mission-orchestrator'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

export interface MissionRunRow {
  id: string
  projectId: string
  objective: string
  status: string
  orchestratorCopilotId: string | null
  participantCopilotIds: string[]
  repo: string | null
  branch: string | null
  decision: string | null
  summary: string | null
  report: MissionReport
  createdAt: string
  updatedAt: string
}

export interface PersistMissionRunInput {
  id: string
  projectId: string
  objective: string
  status: string
  orchestratorCopilotId?: string | null
  participantCopilotIds: string[]
  repo: string | null
  branch: string | null
  decision: string | null
  summary: string | null
  report: MissionReport
  createdAt: string
  updatedAt: string
}

export async function persistMissionRun(input: PersistMissionRunInput): Promise<void> {
  await pgrest('POST', 'mission_runs', {
    id: input.id,
    project_id: input.projectId,
    objective: input.objective,
    status: input.status,
    orchestrator_copilot_id: input.orchestratorCopilotId ?? null,
    participant_copilot_ids: input.participantCopilotIds,
    repo: input.repo,
    branch: input.branch,
    decision: input.decision,
    summary: input.summary,
    report: input.report,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  })
}

function rowToMissionRun(row: RawRow): MissionRunRow {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    objective: row.objective as string,
    status: row.status as string,
    orchestratorCopilotId: (row.orchestrator_copilot_id as string | null) ?? null,
    participantCopilotIds: (row.participant_copilot_ids as string[]) ?? [],
    repo: (row.repo as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    decision: (row.decision as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    report: row.report as MissionReport,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function getMissionRun(missionRunId: string): Promise<MissionRunRow | null> {
  const rows = await pgrest<RawRow[]>('GET', `mission_runs?${eq('id', missionRunId)}&select=*`)
  const row = rows[0]
  return row ? rowToMissionRun(row) : null
}

export async function getLatestMissionRun(projectId: string): Promise<MissionRunRow | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `mission_runs?${eq('project_id', projectId)}&select=*&order=created_at.desc&limit=1`
  )
  const row = rows[0]
  return row ? rowToMissionRun(row) : null
}

export function participantCopilotIds(participants: MissionParticipant[]): string[] {
  return participants.map((p) => p.copilotId).filter((id): id is string => Boolean(id))
}
