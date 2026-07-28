import { describe, expect, it } from 'vitest'

import { isDevSeedCopilot, isDevSeedProject } from '@/lib/agent-mission-control/dev-seed-markers'

describe('dev-seed-markers', () => {
  it('detects dev-seed copilots by tag, name, and id prefix', () => {
    expect(
      isDevSeedCopilot({
        id: 'seed-agent-alpha',
        slug: 'seed-agent-alpha',
        name: 'seed · Alpha Reader (active)',
        tags: ['seed', 'dev-only'],
      })
    ).toBe(true)
    expect(
      isDevSeedCopilot({
        id: 'copilot-market-intelligence',
        slug: 'market-intelligence',
        name: 'Market Intelligence',
        tags: [],
      })
    ).toBe(false)
  })

  it('detects dev-seed projects by name and id prefix', () => {
    expect(
      isDevSeedProject({
        id: 'seed-proj-dev-lab',
        slug: 'seed-dev-lab',
        name: 'seed · Dev Lab',
      })
    ).toBe(true)
    expect(
      isDevSeedProject({
        id: 'proj-tradeagent',
        slug: 'tradeagent',
        name: 'TradeAgent',
      })
    ).toBe(false)
  })
})
