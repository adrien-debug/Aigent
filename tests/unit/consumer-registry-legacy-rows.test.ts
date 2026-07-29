/**
 * A registry row written BEFORE the Aigent identity chain existed must still
 * load — on both sides of the delivery.
 *
 * `aigentProjectId` / `copilotId` / `versionId` were added to registry rows so
 * runtime telemetry can be joined back to the exact project/copilot/version
 * that produced it. They were first introduced as REQUIRED in the read guards,
 * which is destructive rather than strict: a consumer repo provisioned before
 * the change holds rows without them, a strict guard drops those rows, and the
 * caller that rebuilds the file from what it just read (`mergeRegistryEntry` on
 * the host side) then writes the sibling agents out of existence — a silent
 * delete triggered by an unrelated push.
 *
 * The fields are therefore OPTIONAL on read and ALWAYS written on push. The
 * host-side guard (`isRegistryEntry`) is module-private, so it is exercised
 * here through `buildAgentPushFiles`'s public behaviour; the consumer-side
 * guard ships as generated source, so it is asserted on the generated text.
 */
import { describe, expect, it } from 'vitest'

import { buildConsumerIntakePack } from '@/lib/agent-mission-control/consumer-bootstrap'
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

function generatedFile(path: string): string {
  const files = buildConsumerIntakePack(project, '2026-07-19T12:00:00Z')
  const file = files.find((f) => f.path === path)
  if (!file) throw new Error(`generated pack has no ${path} (paths: ${files.map((f) => f.path).join(', ')})`)
  return file.content
}

describe('consumer registry — legacy rows survive the identity-chain upgrade', () => {
  it('the generated registry reader does NOT require the identity chain', () => {
    const source = generatedFile('lib/aigent/registry.ts')

    // Provenance and shape are still enforced...
    expect(source).toContain("(row as RegistryAgent).source === 'aigent'")
    expect(source).toContain('typeof (row as RegistryAgent).slug === \'string\'')

    // ...but a missing copilotId must NOT disqualify a row. This exact
    // predicate is what silently deleted pre-upgrade agents.
    expect(source).not.toContain("typeof (row as RegistryAgent).copilotId === 'string'")
  })

  it('the generated RegistryAgent type marks the identity chain optional', () => {
    const types = generatedFile('lib/aigent/types.ts')

    // Optional (`?:`) — a legacy row parses; a current row still carries them.
    expect(types).toMatch(/aigentProjectId\?:\s*string/)
    expect(types).toMatch(/copilotId\?:\s*string/)
    expect(types).toMatch(/versionId\?:\s*string \| null/)
  })

  it('identity is read from the registry row, never invented when absent', () => {
    const activate = generatedFile('app/api/aigent/intake/[slug]/activate/route.ts')

    // The row's own aigentProjectId is preferred over an env var the pack
    // never writes — that env-only read is what sent projectId:'unknown'.
    expect(activate).toContain('agent.aigentProjectId')
    // No fabricated placeholder identity anywhere in the generated route.
    expect(activate).not.toContain("'unknown'")
  })
})
