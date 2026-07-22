import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'

import { toolsNode } from '@/langgraph/agent-builder-graph.mjs'

/**
 * Non-regression for the HITL mixed-parallel-turn bug: approvalNode appends a
 * block/decline ToolMessage for a forbidden/declined call, which becomes the
 * LAST message before toolsNode runs. toolsNode used to read
 * `state.messages[last]` literally — a ToolMessage with no `.tool_calls` — so
 * the APPROVED sibling call in the same turn was silently dropped, its tool_call
 * left unanswered, and the run then 400'd. toolsNode must instead reverse-find
 * the AI message that carries the tool calls (exactly like routeApproval).
 */
describe('toolsNode — mixed parallel turn (approved sibling must still run)', () => {
  // Configured path with ZERO tools: an unanswered call to an unknown tool
  // yields a clean "not in allowlist" ToolMessage — proving toolsNode PROCESSED
  // the call rather than reading the trailing ToolMessage and doing nothing.
  const config = { configurable: { systemPrompt: 'test', tools: [], forbiddenActions: [] } }

  it('processes the approved sibling even when the last message is a decline ToolMessage', async () => {
    const state = {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'draft_copilot_spec', id: 'call-1', args: {} }, // declined by approvalNode
            { name: 'read_market_snapshot', id: 'call-2', args: {} }, // approved sibling
          ],
        }),
        // approvalNode's decline answer — the literal LAST message.
        new ToolMessage({ content: JSON.stringify({ ok: false, blocked: true }), tool_call_id: 'call-1' }),
      ],
    }

    const result = await toolsNode(state, config)

    // The approved sibling (call-2) MUST be answered. Before the fix, result was [].
    const answeredIds = (result.messages ?? []).map((m: ToolMessage) => m.tool_call_id)
    expect(answeredIds).toContain('call-2')
    // And the already-answered declined call is NOT answered twice.
    expect(answeredIds).not.toContain('call-1')
  })

  it('answers nothing extra when every call was already answered', async () => {
    const state = {
      messages: [
        new AIMessage({ content: '', tool_calls: [{ name: 'draft_copilot_spec', id: 'only-1', args: {} }] }),
        new ToolMessage({ content: JSON.stringify({ ok: false, blocked: true }), tool_call_id: 'only-1' }),
      ],
    }
    const result = await toolsNode(state, config)
    expect(result.messages ?? []).toHaveLength(0)
  })
})
