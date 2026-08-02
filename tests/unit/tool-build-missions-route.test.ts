import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolBuildMissionRow } from '@/lib/agent-mission-control/tool-build-missions-store'
import { TOOL_BUILDER_FIXTURES } from '@/lib/agent-mission-control/tool-builder/fixtures'

let timeoutFlag = false
const listActiveToolBuildMissions = vi.fn(async () => [] as ToolBuildMissionRow[])
const listToolBuildMissions = vi.fn(async () => [] as ToolBuildMissionRow[])
const startToolBuildMission = vi.fn(async (_spec: unknown) => ({} as ToolBuildMissionRow))
const retryToolBuildMission = vi.fn(async (_missionId: string) => ({} as ToolBuildMissionRow))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  isPgrestTimeout: () => timeoutFlag,
}))

vi.mock('@/lib/agent-mission-control/tool-build-missions-store', () => ({
  listActiveToolBuildMissions: () => listActiveToolBuildMissions(),
  listToolBuildMissions: () => listToolBuildMissions(),
  startToolBuildMission: (spec: unknown) => startToolBuildMission(spec),
  retryToolBuildMission: (missionId: string) => retryToolBuildMission(missionId),
}))

import { GET, PATCH, POST } from '@/app/api/agent-ops/tool-build-missions/route'

const ENV = {
  AMC_DATA_SOURCE: 'gpu1',
  AMC_SUPABASE_URL: 'https://gpu1/rest',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
}

function missionRow(overrides: Partial<ToolBuildMissionRow> = {}): ToolBuildMissionRow {
  return {
    id: 'm-1',
    toolId: 'count_words',
    state: 'TESTING',
    spec: TOOL_BUILDER_FIXTURES.deterministicValid,
    evidence: null,
    rejectionReason: null,
    createdAt: '2026-08-02T08:00:00.000Z',
    updatedAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  }
}

describe('/api/agent-ops/tool-build-missions route', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV)
    timeoutFlag = false
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POST creates a mission with a valid spec', async () => {
    startToolBuildMission.mockResolvedValueOnce(missionRow({ id: 'm-1' }))
    const res = await POST(
      new Request('http://localhost/api/agent-ops/tool-build-missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: TOOL_BUILDER_FIXTURES.deterministicValid }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.id).toBe('m-1')
    expect(startToolBuildMission).toHaveBeenCalledTimes(1)
  })

  it('POST rejects an invalid spec payload', async () => {
    const res = await POST(
      new Request('http://localhost/api/agent-ops/tool-build-missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: TOOL_BUILDER_FIXTURES.deterministicInvalid }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid spec')
  })

  it('GET all=1 uses full listing endpoint', async () => {
    listToolBuildMissions.mockResolvedValueOnce([missionRow({ id: 'm-all' })])
    const res = await GET(new Request('http://localhost/api/agent-ops/tool-build-missions?all=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.missions[0].id).toBe('m-all')
    expect(listToolBuildMissions).toHaveBeenCalledTimes(1)
    expect(listActiveToolBuildMissions).not.toHaveBeenCalled()
  })

  it('PATCH retries a mission id', async () => {
    retryToolBuildMission.mockResolvedValueOnce(missionRow({ id: 'm-retry', state: 'CERTIFIED' }))
    const res = await PATCH(
      new Request('http://localhost/api/agent-ops/tool-build-missions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ missionId: 'm-retry' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.id).toBe('m-retry')
  })

  it('maps store timeout errors to 504', async () => {
    timeoutFlag = true
    listActiveToolBuildMissions.mockRejectedValueOnce(new Error('timeout'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request('http://localhost/api/agent-ops/tool-build-missions'))
    expect(res.status).toBe(504)
    consoleSpy.mockRestore()
  })

  it('returns 503 when live backend env is missing', async () => {
    delete process.env.AMC_SUPABASE_URL
    const res = await GET(new Request('http://localhost/api/agent-ops/tool-build-missions'))
    expect(res.status).toBe(503)
    process.env.AMC_SUPABASE_URL = ENV.AMC_SUPABASE_URL
  })
})
