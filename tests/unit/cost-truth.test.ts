/**
 * AIG-AGENT-QUALITY-005 — Lot F1: an unmeasured cost is null, never a fake 0,
 * and the UI renders it as "—", never "$0.00".
 *
 * The false zero this guards: a LangGraph run whose messages carry no provider
 * usage_metadata (e.g. a tool-call AI message with empty content, or an
 * interrupted run) used to be priced by estimating tokens from content → 0,
 * indistinguishable from a genuinely-free run. Now it is null (unavailable).
 */
import { describe, expect, it } from 'vitest'

import { formatUsd } from '@/lib/agent-mission-control/format'
import { costFromMessages } from '@/lib/agent-mission-control/langgraph-server'

describe('costFromMessages — unmeasured usage is null, never a fabricated 0', () => {
  it('returns null when no AI message carries provider usage_metadata', () => {
    // A tool-call AI message (empty content, no usage) + a tool result. This is
    // exactly the interrupted-run shape that used to price to 0.
    const messages = [
      { type: 'ai', content: '', tool_calls: [{ name: 'draft_copilot_spec', id: 'c1' }] },
      { type: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
    ]
    expect(costFromMessages(messages as never)).toBeNull()
  })

  it('returns a real measured cost when usage_metadata is present', () => {
    const messages = [
      {
        type: 'ai',
        content: 'done',
        usage_metadata: { input_tokens: 1000, output_tokens: 200 },
        response_metadata: { model_name: 'gpt-5.4' },
      },
    ]
    const cost = costFromMessages(messages as never)
    expect(cost).not.toBeNull()
    expect(cost).toBeGreaterThan(0)
  })
})

describe('formatUsd — unknown cost renders as "—", never "$0.00"', () => {
  it('null / undefined → em dash', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(undefined)).toBe('—')
  })
  it('a real 0 is a real $0.00 (measured zero, not unknown)', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
  it('a real amount formats normally', () => {
    expect(formatUsd(0.0032, 4)).toBe('$0.0032')
  })
})
