/**
 * Unit tests for Gemini tool-use in model-router (callGemini path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { routeCompletion } from '@/lib/agent-mission-control/model-router'

describe('routeCompletion — google tool-use', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'read_project_summary', args: { projectId: 'proj-console' } } }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
        }),
      }))
    )
  })

  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    vi.unstubAllGlobals()
  })

  it('returns normalized toolCalls from a Gemini functionCall part', async () => {
    const response = await routeCompletion({
      purpose: 'run',
      modelProvider: 'google',
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'List projects' }],
      tools: [
        {
          name: 'read_project_summary',
          description: 'Read a project summary',
          parameters: { type: 'object', properties: {} },
        },
      ],
      toolChoice: 'auto',
    })

    expect(response.toolCalls).toEqual([
      {
        id: 'gemini_call_0',
        name: 'read_project_summary',
        argumentsJson: JSON.stringify({ projectId: 'proj-console' }),
      },
    ])

    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.tools?.[0]?.functionDeclarations?.[0]?.name).toBe('read_project_summary')
    expect(body.toolConfig.functionCallingConfig.mode).toBe('AUTO')
  })
})
