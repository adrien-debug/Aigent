import { describe, expect, it } from 'vitest'

import {
  AGENTS_WANTED_PATH,
  BINDINGS_PATH,
  CONSUMER_PACK_VERSION,
  CONSUMER_READY_PATH,
  buildConsumerIntakePack,
  consumerProjectKey,
  consumerProvisionBranchName,
} from '@/lib/agent-mission-control/consumer-bootstrap'
import type { Project } from '@/lib/agent-mission-control/types'

const project: Project = {
  id: 'proj-trade',
  name: 'TradeAgent',
  slug: 'tradeagent',
  description: 'Trading workspace',
  platform: 'web',
  repoFullName: 'hearst/tradeagent',
  repoUrl: 'https://github.com/hearst/tradeagent',
  createdAt: '2026-07-01T00:00:00Z',
}

describe('consumer-bootstrap', () => {
  it('buildConsumerIntakePack includes intake UI, API, registry and demand file', () => {
    const files = buildConsumerIntakePack(project, '2026-07-19T12:00:00Z')
    const paths = files.map((f) => f.path)
    expect(paths).toContain(CONSUMER_READY_PATH)
    expect(paths).toContain(AGENTS_WANTED_PATH)
    expect(paths).toContain(BINDINGS_PATH)
    expect(paths).toContain('app/admin/aigent/page.tsx')
    expect(paths).toContain('app/api/aigent/intake/[slug]/activate/route.ts')
    expect(paths).toContain('lib/aigent/telemetry-client.ts')
  })

  it('consumer-ready marker carries project key and pack version', () => {
    const ready = buildConsumerIntakePack(project, '2026-07-19T12:00:00Z').find(
      (f) => f.path === CONSUMER_READY_PATH
    )
    expect(ready).toBeDefined()
    const marker = JSON.parse(ready!.content) as {
      version: string
      projectKey: string
      aigentProjectId: string
    }
    expect(marker.version).toBe(CONSUMER_PACK_VERSION)
    expect(marker.projectKey).toBe(consumerProjectKey(project))
    expect(marker.aigentProjectId).toBe(project.id)
  })

  it('AGENTS-WANTED names the project', () => {
    const wanted = buildConsumerIntakePack(project, '2026-07-19T12:00:00Z').find(
      (f) => f.path === AGENTS_WANTED_PATH
    )
    expect(wanted?.content).toContain('TradeAgent')
  })

  it('consumerProvisionBranchName is git-safe', () => {
    expect(consumerProvisionBranchName('My Project!!')).toMatch(/^aigent\/provision-[a-z0-9-]+$/)
  })

  // The scaffolded telemetry client MUST emit Aigent's strict ingestion
  // contract (POST /api/runtime-telemetry): required { eventId, projectId,
  // agentId, runId, timestamp, status } and NO unknown keys. The previous
  // scaffold sent agentSlug/projectKey/targetRoute with no timestamp, which the
  // .strict() schema rejected 400 — so nothing ever reached the dashboard.
  describe('telemetry client contract (must match the ingestion route schema)', () => {
    const pack = buildConsumerIntakePack(project, '2026-07-19T12:00:00Z')
    const telemetry = pack.find((f) => f.path === 'lib/aigent/telemetry-client.ts')!
    const activate = pack.find((f) => f.path === 'app/api/aigent/intake/[slug]/activate/route.ts')!

    it('the client emits the route-required field names', () => {
      for (const key of ['eventId', 'projectId', 'agentId', 'runId', 'timestamp', 'status']) {
        expect(telemetry.content).toContain(key)
      }
    })

    it('the client no longer emits the rejected legacy field names', () => {
      // These were the exact keys the strict schema 400'd on.
      expect(telemetry.content).not.toContain('agentSlug')
      expect(telemetry.content).not.toContain('projectKey')
      expect(telemetry.content).not.toContain('targetRoute')
    })

    it('the internal activate caller also uses the corrected shape', () => {
      expect(activate.content).toContain('agentId:')
      expect(activate.content).toContain('projectId:')
      expect(activate.content).toContain('timestamp:')
      expect(activate.content).not.toContain('agentSlug:')
      expect(activate.content).not.toContain('projectKey:')
    })
  })
})
