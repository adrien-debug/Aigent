import { describe, expect, it } from 'vitest'

import { toRuntimeRunStatus } from '@/lib/agent-mission-control/runtime-api-types'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * Non-regression for AIGENT-DEEP-FORENSIC-029 (runtime-v1-status-contract-drift):
 * every /runtime/v1 response that carries a run status must publish the external
 * RuntimeRunStatus, never Aigent's internal AgentRunStatus verbatim. A consumer's
 * contract-typed SDK cannot parse `needs-confirmation` or `blocked`.
 */
describe('toRuntimeRunStatus — internal → published contract', () => {
  const cases: Array<[AgentRunStatus, string]> = [
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['blocked', 'failed'], // a guardrail refusal is not a success
    ['needs-confirmation', 'waiting_on_input'], // paused, not done
    ['running', 'running'],
  ]
  for (const [internal, external] of cases) {
    it(`maps '${internal}' -> '${external}'`, () => {
      expect(toRuntimeRunStatus(internal)).toBe(external)
    })
  }

  it('never leaks an internal-only value', () => {
    const external = new Set(['queued', 'running', 'waiting_on_input', 'completed', 'failed', 'cancelled'])
    for (const s of ['completed', 'failed', 'blocked', 'needs-confirmation', 'running'] as AgentRunStatus[]) {
      expect(external.has(toRuntimeRunStatus(s))).toBe(true)
    }
  })
})
