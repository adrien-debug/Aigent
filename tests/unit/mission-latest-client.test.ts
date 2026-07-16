/**
 * Unit tests — latest mission hydration (client parse + URL, no browser).
 */
import { describe, expect, it } from 'vitest'

import {
  latestMissionUrl,
  MISSION_DATA_UNAVAILABLE,
  parseLatestMissionResponse,
} from '@/lib/agent-mission-control/mission-latest-client'
import type { MissionReport } from '@/lib/agent-mission-control/mission-orchestrator'

function sampleReport(overrides: Partial<MissionReport> = {}): MissionReport {
  return {
    runId: 'mission_test_001',
    projectId: 'proj-tradeagent',
    objective: 'Validate BTC after delivery',
    mode: 'evidence_v1',
    status: 'completed',
    repo: 'adrien-debug/TradeAgent',
    branch: 'main',
    participants: [],
    findings: [{ id: 'f1', missionRunId: 'mission_test_001', copilotId: null, role: 'orchestrator', severity: 'info', title: 'OK', description: '', evidence: {}, recommendation: null }],
    consensus: {
      decision: 'continue',
      status: 'completed',
      summary: 'All clear',
      blockers: [],
      warnings: [],
      nextActions: ['Ship'],
    },
    createdAt: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

describe('mission-latest-client', () => {
  it('latestMissionUrl encodes project id', () => {
    expect(latestMissionUrl('proj-tradeagent')).toBe(
      '/api/agent-ops/projects/proj-tradeagent/missions/latest'
    )
  })

  it('parseLatestMissionResponse — no mission → idle', () => {
    expect(parseLatestMissionResponse({ ok: true, mission: null })).toEqual({
      phase: 'idle',
      report: null,
      objective: null,
    })
    expect(parseLatestMissionResponse(null)).toEqual({
      phase: 'idle',
      report: null,
      objective: null,
    })
  })

  it('parseLatestMissionResponse — mission with report → ready', () => {
    const report = sampleReport()
    const result = parseLatestMissionResponse({ ok: true, mission: { objective: report.objective, report } })
    expect(result.phase).toBe('ready')
    if (result.phase === 'ready') {
      expect(result.report.runId).toBe('mission_test_001')
      expect(result.report.findings).toHaveLength(1)
      expect(result.objective).toBe('Validate BTC after delivery')
    }
  })

  it('parseLatestMissionResponse — merges top-level findings when report.findings empty', () => {
    const report = sampleReport({ findings: [] })
    const topFinding = {
      id: 'f2',
      missionRunId: 'mission_test_001',
      copilotId: null,
      role: 'qa_release' as const,
      severity: 'warning' as const,
      title: 'Gate pending',
      description: '',
      evidence: {},
      recommendation: null,
    }
    const result = parseLatestMissionResponse({
      ok: true,
      mission: { report, findings: [topFinding] },
    })
    expect(result.phase).toBe('ready')
    if (result.phase === 'ready') {
      expect(result.report.findings).toHaveLength(1)
      expect(result.report.findings[0].id).toBe('f2')
    }
  })

  it('parseLatestMissionResponse — mission without report → idle with objective', () => {
    const result = parseLatestMissionResponse({
      ok: true,
      mission: { objective: 'Custom objective only' },
    })
    expect(result).toEqual({
      phase: 'idle',
      report: null,
      objective: 'Custom objective only',
    })
  })

  it('MISSION_DATA_UNAVAILABLE is a discrete fallback string', () => {
    expect(MISSION_DATA_UNAVAILABLE).toBe('Mission data unavailable')
  })
})
