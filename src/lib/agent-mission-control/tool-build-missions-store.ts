import 'server-only'

import { randomUUID } from 'node:crypto'

import { pgrest } from './postgrest'
import {
  startToolBuild,
  type ToolBuildMission,
  type ToolBuildSpec,
  type ToolBuildState,
} from './tool-builder/mission'
import { advanceToolBuildMission } from './tool-builder/advance'
import type { IsoTimestamp } from './types'

export { advanceToolBuildMission } from './tool-builder/advance'

export interface ToolBuildMissionRow {
  id: string
  toolId: string
  state: ToolBuildState
  spec: ToolBuildSpec
  evidence: ToolBuildMission['evidence']
  rejectionReason: string | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

interface RawToolBuildMission {
  id: string
  tool_id: string
  state: ToolBuildState
  spec: ToolBuildSpec
  evidence: ToolBuildMission['evidence']
  rejection_reason: string | null
  created_at: IsoTimestamp
  updated_at: IsoTimestamp
}

function mapRow(raw: RawToolBuildMission): ToolBuildMissionRow {
  return {
    id: raw.id,
    toolId: raw.tool_id,
    state: raw.state,
    spec: raw.spec,
    evidence: raw.evidence ?? null,
    rejectionReason: raw.rejection_reason,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

async function persistMissionRow(id: string, mission: ToolBuildMission): Promise<ToolBuildMissionRow> {
  const now = new Date().toISOString()
  const rows = await pgrest<RawToolBuildMission[]>(
    'PATCH',
    `tool_build_missions?id=eq.${encodeURIComponent(id)}`,
    {
      tool_id: mission.spec.id,
      state: mission.state,
      spec: mission.spec,
      evidence: mission.evidence,
      rejection_reason: mission.rejectionReason,
      updated_at: now,
    },
  )
  if (rows[0]) return mapRow(rows[0])
  throw new Error('tool build mission persist returned no row')
}

export async function startToolBuildMission(spec: ToolBuildSpec): Promise<ToolBuildMissionRow> {
  const id = randomUUID()
  const now = new Date().toISOString()
  let mission = startToolBuild(spec)
  mission = await advanceToolBuildMission(mission)

  const rows = await pgrest<RawToolBuildMission[]>('POST', 'tool_build_missions', {
    id,
    tool_id: mission.spec.id,
    state: mission.state,
    spec: mission.spec,
    evidence: mission.evidence,
    rejection_reason: mission.rejectionReason,
    created_at: now,
    updated_at: now,
  })
  if (!rows[0]) throw new Error('tool build mission insert returned no row')
  return mapRow(rows[0])
}

export async function listToolBuildMissions(limit = 20): Promise<ToolBuildMissionRow[]> {
  const rows = await pgrest<RawToolBuildMission[]>(
    'GET',
    `tool_build_missions?order=updated_at.desc&limit=${limit}`,
  )
  return rows.map(mapRow)
}

export async function listActiveToolBuildMissions(limit = 20): Promise<ToolBuildMissionRow[]> {
  const rows = await pgrest<RawToolBuildMission[]>(
    'GET',
    `tool_build_missions?state=in.(DRAFT,IMPLEMENTING,TESTING)&order=updated_at.desc&limit=${limit}`,
  )
  return rows.map(mapRow)
}

export async function retryToolBuildMission(id: string): Promise<ToolBuildMissionRow> {
  const rows = await pgrest<RawToolBuildMission[]>(
    'GET',
    `tool_build_missions?id=eq.${encodeURIComponent(id)}&limit=1`,
  )
  if (!rows[0]) throw new Error('tool build mission not found')
  const current: ToolBuildMission = {
    spec: rows[0].spec,
    state: rows[0].state,
    evidence: rows[0].evidence ?? null,
    rejectionReason: rows[0].rejection_reason,
  }
  const advanced = await advanceToolBuildMission(current)
  return persistMissionRow(id, advanced)
}
