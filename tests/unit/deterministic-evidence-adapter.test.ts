/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the deterministic fixture adapter's legs.
 *
 * Unit-level proof of the two billed legs the fixture replaces, in isolation:
 *   - the AGENT leg runs a REAL certified tool (count_words) and reports its
 *     MEASURED result; simulates a wrong answer, a tool error, a timeout, and a
 *     fail-closed refusal to execute an uncertified tool;
 *   - the JUDGE leg renders a scripted verdict in the exact strict-JSON shape the
 *     calling runner parses (test vs benchmark).
 * Offline, $0, deterministic. The runner-level proof (the 14 scenarios end to
 * end) lives in deterministic-evidence-runners.test.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  makeDeterministicEvidenceAdapter,
  type FixtureScenario,
} from '@/lib/agent-mission-control/evidence/deterministic-adapter'
import type { AgentLegRequest } from '@/lib/agent-mission-control/evidence/execution-adapter'
import { countWords } from '@/lib/agent-mission-control/tool-builder/tools/count-words'

/** A full AgentLegRequest for `input` — only `input` matters to the fixture. */
function agentReq(input: string): AgentLegRequest {
  return {
    copilotId: 'c1',
    runtime: 'langgraph',
    input,
    maxSteps: 4,
    versionId: 'v1',
    projectId: 'p1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    systemPromptSummary: 'sp',
    userLabel: 'test-case',
    assistantId: undefined,
  }
}

const TEST_ENV = { NODE_ENV: 'test' }

describe('deterministic adapter — the agent leg runs REAL certified tools', () => {
  it('count-words executes the real tool and reports the MEASURED count ($0)', async () => {
    const input = 'the quick brown fox'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'count-words' }, grade: { pass: true } }],
      env: TEST_ENV,
    })
    const r = await adapter.executeAgent(agentReq(input))
    expect(r.toolCalls).toEqual([{ toolName: 'count_words', status: 'ok' }])
    // The reported number is what the real tool returns — measured, not asserted.
    expect(r.reply).toContain(String(countWords(input).words))
    expect(r.costUsd).toBe(0)
    expect(r.pausedForConfirmation).toBe(false)
  })

  it('wrong-answer runs the tool but reports a wrong count', async () => {
    const input = 'one two three'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'wrong-answer' }, grade: { pass: false } }],
      env: TEST_ENV,
    })
    const r = await adapter.executeAgent(agentReq(input))
    expect(r.toolCalls).toEqual([{ toolName: 'count_words', status: 'ok' }])
    expect(r.reply).not.toContain(`${countWords(input).words} words`)
  })

  it('tool-error surfaces an errored tool call in the ground truth', async () => {
    const input = 'boom'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'tool-error' }, grade: { pass: false } }],
      env: TEST_ENV,
    })
    const r = await adapter.executeAgent(agentReq(input))
    expect(r.toolCalls).toEqual([{ toolName: 'count_words', status: 'error' }])
  })

  it('timeout throws — the runner turns that into an honest error outcome', async () => {
    const input = 'slow'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'timeout' }, grade: { pass: false } }],
      env: TEST_ENV,
    })
    await expect(adapter.executeAgent(agentReq(input))).rejects.toThrow(/timeout/i)
  })
})

describe('deterministic adapter — fail-closed: it executes CERTIFIED tools only', () => {
  it('refuses to execute an UNKNOWN tool (rejected, never run)', async () => {
    const input = 'ghost'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'uncertified-tool', toolName: 'totally_unknown_tool' }, grade: { pass: false } }],
      env: TEST_ENV,
    })
    const r = await adapter.executeAgent(agentReq(input))
    expect(r.toolCalls).toEqual([{ toolName: 'totally_unknown_tool', status: 'rejected' }])
    expect(r.reply).toMatch(/not a certified tool/i)
  })

  it('refuses a KNOWN-but-uncertified tool (injected certification oracle)', async () => {
    const input = 'wire'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'uncertified-tool', toolName: 'send_wire_transfer' }, grade: { pass: false } }],
      // Simulate a tool that resolves but is NOT certified, without polluting the
      // real registry — the same lookup-injection seam shadow.ts uses.
      certificationLookup: () => false,
      env: TEST_ENV,
    })
    const r = await adapter.executeAgent(agentReq(input))
    expect(r.toolCalls).toEqual([{ toolName: 'send_wire_transfer', status: 'rejected' }])
  })

  it('a scenario that names a CERTIFIED tool as "uncertified" is a loud scripting error', async () => {
    const input = 'oops'
    const adapter = makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'uncertified-tool', toolName: 'count_words' }, grade: { pass: false } }],
      // count_words IS certified per the real registry → the refusal scenario is
      // self-contradictory and must throw rather than silently pass.
      env: TEST_ENV,
    })
    await expect(adapter.executeAgent(agentReq(input))).rejects.toThrow(/IS certified/i)
  })
})

describe('deterministic adapter — the judge leg renders the runner-correct JSON shape', () => {
  const input = 'grade me'
  function adapterWith(grade: FixtureScenario['grade']) {
    return makeDeterministicEvidenceAdapter({
      scenarios: [{ input, behavior: { kind: 'count-words' }, grade }],
      env: TEST_ENV,
    })
  }

  it('purpose=test → verdict/unsafeAttempt/confirmationHonored, costUsd 0', async () => {
    const adapter = adapterWith({ pass: true })
    const r = await adapter.judge({ purpose: 'test', systemPrompt: 's', payload: { input }, model: 'm', modelProvider: 'openai' })
    expect(r.costUsd).toBe(0)
    const parsed = JSON.parse(r.text)
    expect(parsed.verdict).toBe('pass')
    expect(parsed.unsafeAttempt).toBe(false)
    expect(parsed.confirmationHonored).toBe(true)
  })

  it('purpose=test → a failing grade renders verdict:fail', async () => {
    const adapter = adapterWith({ pass: false, reason: 'wrong count' })
    const r = await adapter.judge({ purpose: 'test', systemPrompt: 's', payload: { input }, model: 'm', modelProvider: 'openai' })
    expect(JSON.parse(r.text).verdict).toBe('fail')
  })

  it('purpose=benchmark → success/accuracy/unsafeAction/unauthorizedRoute/confirmationMistake', async () => {
    const adapter = adapterWith({ pass: true, accuracy: 0.9 })
    const r = await adapter.judge({ purpose: 'benchmark', systemPrompt: 's', payload: { input }, model: 'm', modelProvider: 'openai' })
    const parsed = JSON.parse(r.text)
    expect(parsed.success).toBe(true)
    expect(parsed.accuracy).toBe(0.9)
    expect(parsed.unsafeAction).toBe(false)
    expect(parsed.unauthorizedRoute).toBe(false)
    expect(parsed.confirmationMistake).toBe(false)
  })

  it('confirmationHonored:false maps to confirmationMistake:true on the benchmark shape', async () => {
    const adapter = adapterWith({ pass: false, confirmationHonored: false })
    const r = await adapter.judge({ purpose: 'benchmark', systemPrompt: 's', payload: { input }, model: 'm', modelProvider: 'openai' })
    expect(JSON.parse(r.text).confirmationMistake).toBe(true)
  })
})

describe('deterministic adapter — fail-closed on an unscripted input', () => {
  it('throws rather than fabricating a default answer', async () => {
    const adapter = makeDeterministicEvidenceAdapter({ scenarios: [], env: TEST_ENV })
    await expect(adapter.executeAgent(agentReq('not scripted'))).rejects.toThrow(/no scenario scripted/i)
  })
})
