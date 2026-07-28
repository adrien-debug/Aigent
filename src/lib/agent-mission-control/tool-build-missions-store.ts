import 'server-only'

import { randomUUID } from 'node:crypto'

import { pgrest } from './postgrest'
import {
  beginImplementing,
  beginTesting,
  certifyMission,
  startToolBuild,
  type ToolBuildMission,
  type ToolBuildSpec,
  type ToolBuildState,
} from './tool-builder/mission'
import { runToolSandbox } from './tool-builder/sandbox'
import { countWords } from './tool-builder/tools/count-words'
import type { IsoTimestamp } from './types'

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

function runSandboxForSpec(spec: ToolBuildSpec) {
  if (spec.id === 'count_words') {
    return runToolSandbox(countWords, [
      { name: 'empty', input: '', expected: { ok: true, words: 0, characters: 0, longestWord: 0 } },
      { name: 'hello world', input: 'hello world', expected: { ok: true, words: 2, characters: 11, longestWord: 5 } },
    ])
  }
  return null
}

/** Advance a mission through implement → test → certify when a sandbox exists. */
export function advanceToolBuildMission(mission: ToolBuildMission): ToolBuildMission {
  if (mission.state === 'REJECTED' || mission.state === 'CERTIFIED' || mission.state === 'DEPRECATED') {
    return mission
  }
  let next = mission.state === 'DRAFT' ? beginImplementing(mission) : mission
  if (next.state === 'IMPLEMENTING') next = beginTesting(next)
  if (next.state !== 'TESTING') return next

  const evidence = runSandboxForSpec(next.spec)
  if (!evidence) {
    return {
      ...next,
      state: 'REJECTED',
      rejectionReason: `no sandbox implementation for tool id "${next.spec.id}" yet — only count_words is buildable today`,
    }
  }
  return certifyMission(next, evidence)
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
  mission = advanceToolBuildMission(mission)

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
  const advanced = advanceToolBuildMission(current)
  return persistMissionRow(id, advanced)
}
