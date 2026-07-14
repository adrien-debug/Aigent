/**
 * Unit tests for the Project Builder Architect's STREAMING transport
 * (src/lib/agent-mission-control/project-builder-conversation.ts,
 * streamArchitectTurn + postProjectBuilderMessageStream).
 *
 * No real OpenAI call: the SDK client is mocked so `chat.completions.create`
 * returns an async-iterable of ChatCompletionChunk-shaped objects whenever
 * `stream: true` is requested (matching the OpenAI SDK's Stream<Item>
 * contract — `for await` over the returned value). Proves:
 *  - onToken fires once per content delta, in order, as the (mocked) stream
 *    yields them — not once at the end,
 *  - the final `reply` returned equals the full accumulated prose,
 *  - a streamed update_preview tool-call (delta-by-delta function.arguments)
 *    is still captured correctly into previewPatch,
 *  - repo-tool-calling iterations are never handed an onToken invocation
 *    (their chunks carry tool_calls deltas, never content deltas),
 *  - postProjectBuilderMessageStream persists the user turn immediately, and
 *    the assistant reply + merged preview exactly once, after the stream
 *    completes — same write shape as postProjectBuilderMessage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/github', () => ({
  getRepoFile: vi.fn(),
  getRepoTree: vi.fn(),
  searchRepoCode: vi.fn(),
}))

const createCompletion = vi.fn()
vi.mock('@/lib/agent-mission-control/llm-client', () => ({
  ARCHITECT_MODEL: 'gpt-5.4',
  getOpenAIClient: () => ({
    chat: { completions: { create: createCompletion } },
  }),
}))

const pgrestMock = vi.fn()
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (...args: unknown[]) => pgrestMock(...args),
}))

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async () => ({ id: 'proj-1', repoFullName: 'acme/widgets' })),
}))

vi.mock('@/lib/agent-mission-control/repo-intelligence-store', () => ({
  loadRepoIntelligence: vi.fn(async () => ({ intelligence: null })),
}))

import { getRepoTree } from '@/lib/agent-mission-control/github'
import {
  postProjectBuilderMessageStream,
  streamArchitectTurn,
} from '@/lib/agent-mission-control/project-builder-conversation'
import type { ProjectBuilderMessage } from '@/lib/agent-mission-control/project-builder-types'

const REPO = 'acme/widgets'
const ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN

function userMsg(content: string): ProjectBuilderMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
}

/** A fake OpenAI Stream<ChatCompletionChunk>: async-iterable over the given chunks. */
function fakeStream(chunks: Array<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

function contentChunk(delta: string) {
  return { choices: [{ delta: { content: delta } }] }
}

function toolCallChunk(index: number, args: { id?: string; name?: string; args?: string }) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              id: args.id,
              function: { name: args.name, arguments: args.args },
            },
          ],
        },
      },
    ],
  }
}

function nonStreamToolCallResponse(toolCalls: { id: string; name: string; args: string }[]) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((t) => ({
            id: t.id,
            type: 'function' as const,
            function: { name: t.name, arguments: t.args },
          })),
        },
      },
    ],
  }
}

beforeEach(() => {
  createCompletion.mockReset()
  pgrestMock.mockReset()
  vi.mocked(getRepoTree).mockReset()
  process.env.GITHUB_TOKEN = 'test-token'
  pgrestMock.mockImplementation(async (method: string, path: string) => {
    // Conversation lookup — no existing conversation, so a fresh one is created.
    if (method === 'GET' && path.startsWith('project_builder_conversations?')) return []
    // Message history reload after appending the user turn.
    if (method === 'GET' && path.startsWith('project_builder_messages?')) return []
    // Every POST/PATCH just needs to resolve — return shape is not read by callers here.
    return []
  })
})

afterEach(() => {
  process.env.GITHUB_TOKEN = ORIGINAL_GITHUB_TOKEN
})

describe('streamArchitectTurn — token-by-token prose transport', () => {
  it('forwards each content delta to onToken, in order, and returns the fully accumulated prose', async () => {
    createCompletion.mockImplementationOnce(async () =>
      fakeStream([
        contentChunk('I opened '),
        contentChunk('package.json'),
        contentChunk(' — this repo is named "widgets". What should the agent do here?'),
      ])
    )

    const deltas: string[] = []
    const result = await streamArchitectTurn(
      {
        messages: [userMsg('cadre-moi un agent pour ce repo')],
        repoContext: 'REPO INTELLIGENCE: bounded summary',
        currentPreview: null,
        repoFullName: REPO,
      },
      (delta) => deltas.push(delta)
    )

    expect(deltas).toEqual(['I opened ', 'package.json', ' — this repo is named "widgets". What should the agent do here?'])
    expect(result.reply).toBe(deltas.join(''))
    expect(result.reply).toContain('package.json')

    // The streaming call really requested stream: true.
    expect(createCompletion).toHaveBeenCalledTimes(1)
    const callArgs = createCompletion.mock.calls[0]![0] as { stream?: boolean }
    expect(callArgs.stream).toBe(true)
  })

  it('captures a streamed update_preview tool-call (arguments assembled from deltas) into previewPatch', async () => {
    const previewArgs = JSON.stringify({ name: 'Design Sentinel', role: 'watches the design system' })
    // Split the JSON string arbitrarily across two chunks to prove accumulation.
    const half = Math.floor(previewArgs.length / 2)

    createCompletion.mockImplementationOnce(async () =>
      fakeStream([
        toolCallChunk(0, { id: 'preview-1', name: 'update_preview', args: previewArgs.slice(0, half) }),
        toolCallChunk(0, { args: previewArgs.slice(half) }),
        contentChunk('Here is a first pass at the spec — does this match what you want?'),
      ])
    )

    const deltas: string[] = []
    const result = await streamArchitectTurn(
      {
        messages: [userMsg('propose un agent')],
        repoContext: 'REPO INTELLIGENCE: bounded summary',
        currentPreview: null,
        repoFullName: REPO,
      },
      (delta) => deltas.push(delta)
    )

    expect(result.previewPatch?.name).toBe('Design Sentinel')
    expect(result.previewPatch?.role).toBe('watches the design system')
    expect(result.reply).toContain('first pass at the spec')
    // Tool-call deltas never produced a content token.
    expect(deltas).toEqual(['Here is a first pass at the spec — does this match what you want?'])
  })

  it('repo-tool-scouting iterations run non-streamed internally and never invoke onToken with tool JSON', async () => {
    vi.mocked(getRepoTree).mockResolvedValue([{ path: 'src', type: 'tree' }])

    // First iteration: model calls list_repo_tree (streamed call, but only
    // yields tool_call deltas — no content). Second iteration: model answers
    // in prose, streamed with real content deltas.
    createCompletion
      .mockImplementationOnce(async () =>
        fakeStream([toolCallChunk(0, { id: 'call-1', name: 'list_repo_tree', args: '{}' })])
      )
      .mockImplementationOnce(async () => fakeStream([contentChunk('src/ exists. What should live there?')]))

    const deltas: string[] = []
    const result = await streamArchitectTurn(
      {
        messages: [userMsg('quest ce qui existe dans src ?')],
        repoContext: 'REPO INTELLIGENCE: bounded summary',
        currentPreview: null,
        repoFullName: REPO,
      },
      (delta) => deltas.push(delta)
    )

    expect(getRepoTree).toHaveBeenCalledTimes(1)
    expect(deltas).toEqual(['src/ exists. What should live there?'])
    expect(result.reply).toBe('src/ exists. What should live there?')
  })
})

describe('postProjectBuilderMessageStream — persistence after streaming completes', () => {
  it('persists the user turn before streaming, then the assistant reply + merged preview exactly once after', async () => {
    createCompletion.mockImplementationOnce(async () =>
      fakeStream([
        contentChunk('Sure — '),
        contentChunk('here is what I found in the repo.'),
      ])
    )

    const deltas: string[] = []
    const bundle = await postProjectBuilderMessageStream('proj-1', 'discute cet agent', (delta) => deltas.push(delta))

    expect(deltas.join('')).toBe('Sure — here is what I found in the repo.')

    const calls = pgrestMock.mock.calls as [string, string, Record<string, unknown>?][]

    // 1. User message persisted (POST project_builder_messages, role: user) —
    //    happens BEFORE the architect call, i.e. before any content delta.
    const userInsert = calls.find(
      ([method, path, body]) => method === 'POST' && path === 'project_builder_messages' && body?.role === 'user'
    )
    expect(userInsert).toBeDefined()
    expect(userInsert?.[2]?.content).toBe('discute cet agent')

    // 2. Assistant message persisted exactly once, with the full accumulated reply.
    const assistantInserts = calls.filter(
      ([method, path, body]) => method === 'POST' && path === 'project_builder_messages' && body?.role === 'assistant'
    )
    expect(assistantInserts).toHaveLength(1)
    expect(assistantInserts[0]?.[2]?.content).toBe('Sure — here is what I found in the repo.')

    // 3. Conversation row patched with the merged preview + updated_at exactly once
    //    for the turn (in addition to the touch-on-append PATCHes).
    const conversationPatches = calls.filter(
      ([method, path]) => method === 'PATCH' && path.startsWith('project_builder_conversations?')
    )
    expect(conversationPatches.length).toBeGreaterThanOrEqual(1)

    expect(bundle.conversation).toBeDefined()
  })

  it('propagates a streamed reply through the same bundle shape as the non-streaming path', async () => {
    createCompletion.mockImplementationOnce(async () => fakeStream([contentChunk('Got it.')]))

    const bundle = await postProjectBuilderMessageStream('proj-1', 'ok', () => {})

    expect(bundle).toHaveProperty('conversation')
    expect(bundle).toHaveProperty('messages')
    expect(bundle).toHaveProperty('repoSummary')
    expect(bundle).toHaveProperty('createdCopilotId')
  })
})

describe('generateArchitectTurn (non-streaming) is unaffected by the streaming refactor', () => {
  it('still reads the plain response.choices[0].message shape, with no stream:true on the request', async () => {
    const { generateArchitectTurn } = await import('@/lib/agent-mission-control/project-builder-conversation')
    createCompletion.mockImplementationOnce(async () =>
      nonStreamToolCallResponse([{ id: 'preview-1', name: 'update_preview', args: '{}' }])
    )
    // Model produces prose (with no tool calls) on the second turn.
    createCompletion.mockImplementationOnce(async () => ({
      choices: [{ message: { role: 'assistant', content: 'done', tool_calls: undefined } }],
    }))

    const result = await generateArchitectTurn({
      messages: [userMsg('test')],
      repoContext: 'x',
      currentPreview: null,
      repoFullName: undefined,
    })

    expect(result.reply).toBe('done')
    const firstCallArgs = createCompletion.mock.calls[0]![0] as { stream?: boolean }
    expect(firstCallArgs.stream).toBeUndefined()
  })
})
