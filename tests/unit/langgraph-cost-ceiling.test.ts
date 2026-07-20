/**
 * LangGraph path — budget + guardrail transport.
 *
 * Covers the three things that used to bind the DIRECT model-router path only:
 *  - the per-run USD ceiling (`manifests.max_cost_per_run_usd`),
 *  - the manifest `forbidden_actions`,
 *  - temporal anchoring (injected at RUN time, never frozen into the prompt).
 */
import { describe, expect, it } from 'vitest'

import { buildCopilotBehaviorConfig } from '@/lib/agent-mission-control/copilot-behavior'
import {
  buildTemporalContext as buildTemporalContextTs,
  withTemporalContext as withTemporalContextTs,
} from '@/lib/agent-mission-control/temporal-context'
// The .mjs twin, loaded exactly as the separate LangGraph process would.
import {
  buildTemporalContext as buildTemporalContextMjs,
  withTemporalContext as withTemporalContextMjs,
  TEMPORAL_CONTEXT_MARKER,
} from '@/langgraph/temporal-context.mjs'
import { forbiddenEntryTargetsTool } from '@/langgraph/agent-builder-graph.mjs'

const copilot = { id: 'cp-1', name: 'Sentinel', model: 'gpt-5.4', model_provider: 'openai' }

describe('cost ceiling transport → CopilotBehaviorConfig', () => {
  it('carries max_cost_per_run_usd down the same channel as max_steps_per_run', () => {
    const cfg = buildCopilotBehaviorConfig({
      copilot,
      manifest: { max_steps_per_run: 7, max_cost_per_run_usd: 0.5 },
      tools: [],
    })
    expect(cfg.maxSteps).toBe(7)
    expect(cfg.maxCostPerRunUsd).toBe(0.5)
  })

  it('leaves the ceiling null (no enforcement) when the manifest defines none', () => {
    const cfg = buildCopilotBehaviorConfig({ copilot, manifest: {}, tools: [] })
    expect(cfg.maxCostPerRunUsd).toBeNull()
    // No rates transported either → the graph cannot and must not fabricate a cost.
    expect(cfg.modelPricing).toBeNull()
  })

  it('rejects a non-positive or non-finite ceiling rather than blocking every run', () => {
    for (const bad of [0, -1, Number.NaN]) {
      const cfg = buildCopilotBehaviorConfig({
        copilot,
        manifest: { max_cost_per_run_usd: bad },
        tools: [],
      })
      expect(cfg.maxCostPerRunUsd).toBeNull()
    }
  })

  it('transports caller-supplied price rates verbatim', () => {
    const cfg = buildCopilotBehaviorConfig({
      copilot,
      manifest: { max_cost_per_run_usd: 1 },
      tools: [],
      modelPricing: { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
    })
    expect(cfg.modelPricing).toEqual({ inputUsdPer1M: 1.25, outputUsdPer1M: 10 })
  })
})

describe('forbiddenActions transport + matching', () => {
  it('carries manifest forbidden_actions into the config, dropping empty entries', () => {
    const cfg = buildCopilotBehaviorConfig({
      copilot,
      manifest: { forbidden_actions: ['never call draft_copilot_spec', '  '] },
      tools: [],
    })
    expect(cfg.forbiddenActions).toEqual(['never call draft_copilot_spec'])
  })

  it('defaults to an empty list when the manifest declares none', () => {
    expect(buildCopilotBehaviorConfig({ copilot, manifest: {}, tools: [] }).forbiddenActions).toEqual([])
  })

  it('matches a banned tool named inside a prose entry', () => {
    expect(forbiddenEntryTargetsTool('Never call draft_copilot_spec', 'draft_copilot_spec')).toBe(true)
    expect(forbiddenEntryTargetsTool('draft_copilot_spec', 'draft_copilot_spec')).toBe(true)
    // Documented quirk of the SHARED rule (all three copies): `.` and `-` are
    // part of the boundary charset, so a trailing full stop defeats the match.
    // Asserted here so the three implementations stay provably identical rather
    // than one of them silently "fixing" it.
    expect(forbiddenEntryTargetsTool('Never call draft_copilot_spec.', 'draft_copilot_spec')).toBe(false)
  })

  it('respects word boundaries — a ban on delete_customer spares delete_customer_note', () => {
    expect(forbiddenEntryTargetsTool('delete_customer', 'delete_customer_note')).toBe(false)
    expect(forbiddenEntryTargetsTool('do not delete_customer', 'delete_customer_note')).toBe(false)
    // and the converse still matches exactly what it names
    expect(forbiddenEntryTargetsTool('do not delete_customer_note', 'delete_customer_note')).toBe(true)
  })

  it('never matches on an empty tool name', () => {
    expect(forbiddenEntryTargetsTool('anything', '')).toBe(false)
  })
})

describe('temporal context — .ts and .mjs twins', () => {
  const fixed = new Date('2026-07-20T09:30:00.000Z')

  it('produce identical output for the same instant', () => {
    expect(buildTemporalContextMjs(fixed)).toBe(buildTemporalContextTs(fixed))
    expect(withTemporalContextMjs('Base prompt.', fixed)).toBe(withTemporalContextTs('Base prompt.', fixed))
  })

  it('states the real date facts', () => {
    const block = buildTemporalContextMjs(fixed)
    expect(block).toContain('Current date: 2026-07-20 (Monday, July 20, 2026), UTC.')
    expect(block).toContain('Current quarter: Q3 2026.')
  })

  it('injects the block exactly once (idempotent, no stacked clocks)', () => {
    const once = withTemporalContextMjs('Base prompt.', fixed)
    const twice = withTemporalContextMjs(once, fixed)
    expect(twice).toBe(once)
    expect(twice.split(TEMPORAL_CONTEXT_MARKER)).toHaveLength(2)
    expect(twice.endsWith('Base prompt.')).toBe(true)
  })

  it('throws rather than emitting NaN facts on an invalid date', () => {
    expect(() => buildTemporalContextMjs(new Date('nope'))).toThrow(/invalid reference date/)
  })
})
