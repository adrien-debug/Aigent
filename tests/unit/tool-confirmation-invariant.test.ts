/**
 * Tool confirmation invariant: a tool that is high/critical risk OR
 * write-capable must be created with requiresConfirmation=true. The DB default
 * is false and release-gate.ts only blocks PROMOTION of high/critical tools, so
 * nothing else stops a medium-risk write tool from being CREATED unconfirmed.
 * Two gates are exercised here: the Zod refinement at the API boundary
 * (POST /api/agent-ops/copilots) and the defense-in-depth check in
 * authoring-writes.ts's createCopilotFromManifest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/agent-ops/copilots/route'
import {
  assertToolConfirmationInvariant,
  isHighRiskOrWriteCapableTool,
  suggestMutates,
} from '@/lib/agent-mission-control/authoring-writes'
import type { ProposedTool } from '@/lib/agent-mission-control/authoring-types'

const ENV = {
  AMC_DATA_SOURCE: 'gpu1',
  AMC_SUPABASE_URL: 'https://gpu1.example/rest',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
}

function readOnlyTool(overrides: Partial<ProposedTool> = {}): ProposedTool {
  return {
    name: 'lookup_ticket',
    description: 'Read an existing support ticket — read-only.',
    provider: 'internal',
    riskLevel: 'low',
    requiresConfirmation: false,
    ...overrides,
  }
}

function riskyWriteTool(overrides: Partial<ProposedTool> = {}): ProposedTool {
  return {
    name: 'delete_customer_account',
    description: 'Permanently deletes a customer account.',
    provider: 'http',
    riskLevel: 'medium',
    requiresConfirmation: false,
    ...overrides,
  }
}

function minimalCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    runtime: 'langgraph',
    model: 'gpt-4o-mini',
    modelProvider: 'openai',
    owner: 'ops',
    manifest: {
      confirmationPolicy: 'risky-only',
      outputContract: { format: 'markdown' },
      proposedTools: [],
      maxStepsPerRun: 10,
      maxCostPerRunUsd: 1,
    },
    ...overrides,
  }
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/agent-ops/copilots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('isHighRiskOrWriteCapableTool', () => {
  it('flags high/critical risk regardless of name', () => {
    expect(isHighRiskOrWriteCapableTool(readOnlyTool({ riskLevel: 'high' }))).toBe(true)
    expect(isHighRiskOrWriteCapableTool(readOnlyTool({ riskLevel: 'critical' }))).toBe(true)
  })

  it('flags a medium-risk tool whose name/description looks write-capable', () => {
    expect(isHighRiskOrWriteCapableTool(riskyWriteTool())).toBe(true)
  })

  it('does not flag a genuinely read-only, low-risk tool', () => {
    expect(isHighRiskOrWriteCapableTool(readOnlyTool())).toBe(false)
  })
})

describe('structural `mutates` flag (migration 0022) supersedes the name heuristic', () => {
  it('flags a low-risk tool declared mutates=true even with a read-shaped name', () => {
    expect(
      isHighRiskOrWriteCapableTool(readOnlyTool({ name: 'sync_ledger', mutates: true }))
    ).toBe(true)
  })

  it('clears a low-risk mutates=false tool whose NAME contains a write verb', () => {
    // The exact cases the regex broke: all read-only, all previously refused
    // with no escape hatch for the author.
    for (const name of ['send_reminder_email', 'submit_report', 'execute_query', 'update_cache']) {
      const tool = readOnlyTool({ name, mutates: false })
      expect(suggestMutates(tool), `${name} should still be SUGGESTED as mutating`).toBe(true)
      expect(isHighRiskOrWriteCapableTool(tool), `${name} must not be refused`).toBe(false)
      expect(() => assertToolConfirmationInvariant([tool])).not.toThrow()
    }
  })

  it('still refuses high/critical risk even when mutates=false', () => {
    for (const riskLevel of ['high', 'critical'] as const) {
      const tool = readOnlyTool({ riskLevel, mutates: false })
      expect(isHighRiskOrWriteCapableTool(tool)).toBe(true)
      expect(() => assertToolConfirmationInvariant([tool])).toThrow(/requiresConfirmation=true/)
    }
  })

  it('refuses mutates=true without confirmation, accepts it with', () => {
    const tool = readOnlyTool({ name: 'sync_ledger', mutates: true })
    expect(() => assertToolConfirmationInvariant([tool])).toThrow(/requiresConfirmation=true/)
    expect(() =>
      assertToolConfirmationInvariant([{ ...tool, requiresConfirmation: true }])
    ).not.toThrow()
  })

  it('falls back FAIL-CLOSED to the heuristic when `mutates` is absent (pre-0022 rows)', () => {
    // Exactly the previous behaviour — no field, no regression.
    expect(readOnlyTool().mutates).toBeUndefined()
    expect(isHighRiskOrWriteCapableTool(riskyWriteTool())).toBe(true)
    expect(isHighRiskOrWriteCapableTool(readOnlyTool())).toBe(false)
    expect(isHighRiskOrWriteCapableTool(readOnlyTool({ name: 'submit_report' }))).toBe(true)
  })
})

describe('assertToolConfirmationInvariant (authoring-writes.ts, defense in depth)', () => {
  it('throws for a risky/write tool with requiresConfirmation=false', () => {
    expect(() => assertToolConfirmationInvariant([riskyWriteTool()])).toThrow(
      /requiresConfirmation=true/
    )
  })

  it('accepts the same tool once requiresConfirmation=true', () => {
    expect(() =>
      assertToolConfirmationInvariant([riskyWriteTool({ requiresConfirmation: true })])
    ).not.toThrow()
  })

  it('leaves a read-only tool untouched', () => {
    expect(() => assertToolConfirmationInvariant([readOnlyTool()])).not.toThrow()
  })
})

describe('POST /api/agent-ops/copilots — tool confirmation invariant at the 400 boundary', () => {
  beforeEach(() => {
    Object.assign(process.env, ENV)
    // Deterministic, fast failure past the 400 boundary: we only assert
    // validation behaviour here, never a real PostgREST write.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network disabled in unit test')
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMC_DATA_SOURCE
    delete process.env.AMC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('rejects a high-risk tool created with requiresConfirmation=false', async () => {
    const res = await post(
      minimalCreateBody({
        manifest: {
          confirmationPolicy: 'risky-only',
          outputContract: { format: 'markdown' },
          proposedTools: [
            {
              name: 'wipe_database',
              description: 'Drops production tables.',
              provider: 'internal',
              riskLevel: 'high',
              requiresConfirmation: false,
            },
          ],
          maxStepsPerRun: 10,
          maxCostPerRunUsd: 1,
        },
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/wipe_database/)
    expect(body.error).toMatch(/requiresConfirmation=true/)
  })

  it('rejects a medium-risk write-shaped tool created with requiresConfirmation=false', async () => {
    const res = await post(
      minimalCreateBody({
        manifest: {
          confirmationPolicy: 'risky-only',
          outputContract: { format: 'markdown' },
          proposedTools: [
            {
              name: 'delete_customer_account',
              description: 'Permanently deletes a customer account.',
              provider: 'http',
              riskLevel: 'medium',
              requiresConfirmation: false,
            },
          ],
          maxStepsPerRun: 10,
          maxCostPerRunUsd: 1,
        },
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/delete_customer_account/)
  })

  it('accepts the same risky tool once requiresConfirmation=true (passes validation, fails later on live I/O)', async () => {
    const res = await post(
      minimalCreateBody({
        manifest: {
          confirmationPolicy: 'risky-only',
          outputContract: { format: 'markdown' },
          proposedTools: [
            {
              name: 'delete_customer_account',
              description: 'Permanently deletes a customer account.',
              provider: 'http',
              riskLevel: 'medium',
              requiresConfirmation: true,
            },
          ],
          maxStepsPerRun: 10,
          maxCostPerRunUsd: 1,
        },
      })
    )
    // Validation itself must not reject this body (400). Without a live
    // PostgREST backend the request still fails downstream (502/503/504),
    // but never with our invariant's message.
    expect(res.status).not.toBe(400)
  })

  it('leaves a read-only tool proposal unaffected', async () => {
    const res = await post(
      minimalCreateBody({
        manifest: {
          confirmationPolicy: 'risky-only',
          outputContract: { format: 'markdown' },
          proposedTools: [
            {
              name: 'lookup_ticket',
              description: 'Read an existing support ticket — read-only.',
              provider: 'internal',
              riskLevel: 'low',
              requiresConfirmation: false,
            },
          ],
          maxStepsPerRun: 10,
          maxCostPerRunUsd: 1,
        },
      })
    )
    expect(res.status).not.toBe(400)
  })
})
