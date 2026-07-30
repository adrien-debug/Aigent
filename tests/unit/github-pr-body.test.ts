import { describe, expect, it } from 'vitest'

import { buildAgentDeliveryPrBody, buildConsumerIntakePrBody } from '@/lib/agent-mission-control/github-pr-body'
import type { AgentManifest, Copilot } from '@/lib/agent-mission-control/types'

const copilot = {
  id: 'copilot-1',
  name: 'Market Scout',
  slug: 'market-scout',
  runtime: 'langgraph',
  model: 'gpt-5.4',
} as unknown as Copilot

const manifest = {
  version: 'v1.2.3',
} as unknown as AgentManifest

describe('buildAgentDeliveryPrBody', () => {
  it('renders markdown provenance, files, and validation guidance', () => {
    const body = buildAgentDeliveryPrBody(copilot, manifest, ['agents/a.ts', 'agents/b.ts'])

    expect(body).toContain('## Agent delivery')
    expect(body).toContain('manual')
    expect(body).toContain('### Files changed')
    expect(body).toContain('- `agents/a.ts`')
    expect(body).toContain('- `agents/b.ts`')
    expect(body).toContain('### Validation')
    expect(body).toContain('process.env')
  })

  it('includes optional quality summary only when non-empty', () => {
    const withExtra = buildAgentDeliveryPrBody(copilot, manifest, [], '  Score: 92  ')
    const withoutExtra = buildAgentDeliveryPrBody(copilot, manifest, [], '   ')

    expect(withExtra).toContain('### Aigent quality summary')
    expect(withExtra).toContain('Score: 92')
    expect(withoutExtra).not.toContain('### Aigent quality summary')
  })
})

describe('buildConsumerIntakePrBody', () => {
  it('renders markdown summary with files and guidance', () => {
    const body = buildConsumerIntakePrBody('Consumer X', ['aigent/file-a.ts', 'aigent/file-b.ts'], 'v9.9.9')

    expect(body).toContain('## Consumer intake — Consumer X')
    expect(body).toContain('Merge manually after review')
    expect(body).toContain('- Pack version: `v9.9.9`')
    expect(body).toContain('### Files')
    expect(body).toContain('- `aigent/file-a.ts`')
    expect(body).toContain('- `aigent/file-b.ts`')
    expect(body).toContain('/admin/aigent')
    expect(body).toContain('AGENTS-WANTED.md')
  })
})
