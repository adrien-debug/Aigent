import { describe, expect, it } from 'vitest'

import {
  IncompleteSSEStreamError,
  consumeSSE,
  isProjectBuilderTerminal,
} from '../../src/lib/agent-mission-control/sse-client'
import {
  encodeProjectBuilderHeartbeat,
  encodeProjectBuilderSSE,
  type ProjectBuilderStreamEvent,
} from '../../src/lib/agent-mission-control/project-builder-stream-protocol'

function streamFrom(chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

describe('Project Builder continuity protocol', () => {
  it('ignores heartbeat comments and requires a terminal event', async () => {
    const connected: ProjectBuilderStreamEvent = {
      type: 'connected',
      lifecycle: 'running',
      runId: 'run-1',
      conversationId: null,
      sequence: 1,
    }
    const terminal: ProjectBuilderStreamEvent = {
      type: 'terminal',
      lifecycle: 'completed',
      runId: 'run-1',
      conversationId: 'conversation-1',
      sequence: 2,
      messageId: 'message-1',
      conversationStatus: 'active',
      preview: null,
      createdCopilotId: null,
    }
    const seen: ProjectBuilderStreamEvent[] = []
    const result = await consumeSSE(
      streamFrom([
        encodeProjectBuilderSSE(connected),
        encodeProjectBuilderHeartbeat('run-1', 1),
        encodeProjectBuilderSSE(terminal),
      ]),
      (event) => seen.push(event),
      { isTerminal: isProjectBuilderTerminal, requireTerminal: true }
    )

    expect(seen).toEqual([connected, terminal])
    expect(result.terminalEvent).toEqual(terminal)
  })

  it('fails closed when EOF arrives before terminal', async () => {
    const delta: ProjectBuilderStreamEvent = {
      type: 'delta',
      lifecycle: 'running',
      runId: 'run-1',
      conversationId: null,
      sequence: 2,
      delta: 'partial',
    }
    await expect(
      consumeSSE(streamFrom([encodeProjectBuilderSSE(delta)]), () => {}, {
        isTerminal: isProjectBuilderTerminal,
        requireTerminal: true,
      })
    ).rejects.toBeInstanceOf(IncompleteSSEStreamError)
  })

  it('counts malformed data without losing later valid events', async () => {
    const terminal: ProjectBuilderStreamEvent = {
      type: 'terminal',
      lifecycle: 'failed',
      runId: 'run-1',
      conversationId: null,
      sequence: 3,
      error: 'architect_message_failed',
      retryable: true,
    }
    const result = await consumeSSE(
      streamFrom(['data: {broken}\n\n', encodeProjectBuilderSSE(terminal)]),
      () => {},
      { isTerminal: isProjectBuilderTerminal, requireTerminal: true }
    )
    expect(result.malformedFrames).toBe(1)
    expect(result.terminalEvent).toEqual(terminal)
  })
})
