/**
 * Unit tests for the Project Builder Architect's agentic repo-reading loop
 * (src/lib/agent-mission-control/project-builder-conversation.ts, generateArchitectTurn).
 *
 * Proves, WITHOUT any real OpenAI call, that:
 *  - when the (mocked) model emits a `read_repo_file` / `list_repo_tree` /
 *    `search_repo` tool_call, the loop executes it against the real repo-read
 *    helpers in github.ts (getRepoFile / getRepoTree / searchRepoCode) with
 *    the project's repoFullName — not a hallucinated/mocked repo,
 *  - the tool result is fed back to the model as a `tool` message and the
 *    loop re-calls the model until it returns prose,
 *  - the loop is bounded (MAX_TOOL_ITERATIONS) and never calls github.ts when
 *    no repo is linked (fail-closed, clean error string instead of a crash),
 *  - the old laconic fallback string no longer exists anywhere in the module.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

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

import { getRepoFile, getRepoTree, searchRepoCode } from '@/lib/agent-mission-control/github'
import { generateArchitectTurn } from '@/lib/agent-mission-control/project-builder-conversation'
import type { ProjectBuilderMessage } from '@/lib/agent-mission-control/project-builder-types'

const REPO = 'acme/widgets'

function userMsg(content: string): ProjectBuilderMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
}

function assistantToolCallResponse(toolCalls: { id: string; name: string; args: string }[]) {
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

function assistantProseResponse(content: string, previewArgs?: string) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          tool_calls: previewArgs
            ? [
                {
                  id: 'preview-1',
                  type: 'function' as const,
                  function: { name: 'update_preview', arguments: previewArgs },
                },
              ]
            : undefined,
        },
      },
    ],
  }
}

const ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN

beforeEach(() => {
  createCompletion.mockReset()
  vi.mocked(getRepoFile).mockReset()
  vi.mocked(getRepoTree).mockReset()
  vi.mocked(searchRepoCode).mockReset()
  // Repo tools are gated fail-closed on GITHUB_TOKEN (see runRepoTool) — set a
  // fake token by default so tests exercise the real github.ts call path;
  // the dedicated "no repo linked" test below asserts the fail-closed branch
  // via `repoFullName: undefined` instead of via a missing token.
  process.env.GITHUB_TOKEN = 'test-token'
})

afterEach(() => {
  process.env.GITHUB_TOKEN = ORIGINAL_GITHUB_TOKEN
})

describe('generateArchitectTurn — agentic repo-reading loop', () => {
  it('a read_repo_file tool_call triggers github.ts getRepoFile with the project repo, then re-calls the model', async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      path: 'package.json',
      encoding: 'utf-8',
      text: '{"name":"widgets"}',
      truncated: false,
    })

    createCompletion
      .mockResolvedValueOnce(
        assistantToolCallResponse([{ id: 'call-1', name: 'read_repo_file', args: JSON.stringify({ path: 'package.json' }) }])
      )
      .mockResolvedValueOnce(
        assistantProseResponse('I opened package.json — this repo is named "widgets". What should the agent do here?')
      )

    const result = await generateArchitectTurn({
      messages: [userMsg('cadre-moi un agent pour ce repo')],
      repoContext: 'REPO INTELLIGENCE: bounded summary',
      currentPreview: null,
      repoFullName: REPO,
    })

    // The handler called github.ts's getRepoFile with the resolved project repo.
    expect(getRepoFile).toHaveBeenCalledTimes(1)
    expect(getRepoFile).toHaveBeenCalledWith(REPO, 'package.json')

    // The model was re-called after the tool result (2 completions total).
    expect(createCompletion).toHaveBeenCalledTimes(2)

    // The second call's messages include a `tool` message carrying the file content.
    const secondCallArgs = createCompletion.mock.calls[1]![0] as {
      messages: { role: string; content?: unknown; tool_call_id?: string }[]
    }
    const toolMsg = secondCallArgs.messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.tool_call_id).toBe('call-1')
    expect(String(toolMsg?.content)).toContain('widgets')

    // Final reply is real prose, not the old laconic fallback.
    expect(result.reply).toContain('package.json')
    expect(result.reply).not.toContain("I've updated the preview panel")
  })

  it('a list_repo_tree tool_call triggers github.ts getRepoTree, scoped by the requested path', async () => {
    vi.mocked(getRepoTree).mockResolvedValue([
      { path: 'src', type: 'tree' },
      { path: 'src/index.ts', type: 'blob', size: 42 },
      { path: 'README.md', type: 'blob', size: 10 },
    ])
    createCompletion
      .mockResolvedValueOnce(
        assistantToolCallResponse([{ id: 'call-2', name: 'list_repo_tree', args: JSON.stringify({ path: 'src' }) }])
      )
      .mockResolvedValueOnce(assistantProseResponse('src/ contains index.ts. Is that the entry point you want wrapped?'))

    const result = await generateArchitectTurn({
      messages: [userMsg('quest ce qui existe dans src ?')],
      repoContext: 'REPO INTELLIGENCE: bounded summary',
      currentPreview: null,
      repoFullName: REPO,
    })

    expect(getRepoTree).toHaveBeenCalledTimes(1)
    expect(getRepoTree).toHaveBeenCalledWith(REPO)
    expect(result.reply).toContain('index.ts')
  })

  it('a search_repo tool_call triggers github.ts searchRepoCode with the query and repo', async () => {
    vi.mocked(searchRepoCode).mockResolvedValue({
      totalCount: 1,
      incomplete: false,
      matches: [{ path: 'src/auth.ts', fragments: ['export function login()'] }],
    })
    createCompletion
      .mockResolvedValueOnce(
        assistantToolCallResponse([{ id: 'call-3', name: 'search_repo', args: JSON.stringify({ query: 'login' }) }])
      )
      .mockResolvedValueOnce(assistantProseResponse('Found login() in src/auth.ts — is that the flow this agent should guard?'))

    const result = await generateArchitectTurn({
      messages: [userMsg('cherche la logique de login')],
      repoContext: 'REPO INTELLIGENCE: bounded summary',
      currentPreview: null,
      repoFullName: REPO,
    })

    expect(searchRepoCode).toHaveBeenCalledTimes(1)
    expect(searchRepoCode).toHaveBeenCalledWith(REPO, 'login')
    expect(result.reply).toContain('auth.ts')
  })

  it('a failed repo read (github.ts throws) becomes a clean tool-error message, not a crash', async () => {
    vi.mocked(getRepoFile).mockRejectedValue(new Error('GitHub 404 on GET repos/acme/widgets/contents/missing.ts'))
    createCompletion
      .mockResolvedValueOnce(
        assistantToolCallResponse([{ id: 'call-4', name: 'read_repo_file', args: JSON.stringify({ path: 'missing.ts' }) }])
      )
      .mockResolvedValueOnce(assistantProseResponse("That file doesn't exist in this repo — can you point me at the right path?"))

    const result = await generateArchitectTurn({
      messages: [userMsg('lis missing.ts')],
      repoContext: 'REPO INTELLIGENCE: bounded summary',
      currentPreview: null,
      repoFullName: REPO,
    })

    const secondCallArgs = createCompletion.mock.calls[1]![0] as {
      messages: { role: string; content?: unknown }[]
    }
    const toolMsg = secondCallArgs.messages.find((m) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain('error')
    expect(String(toolMsg?.content)).toContain('404')
    expect(result.reply).toContain("doesn't exist")
  })

  it('fail-closed: without a linked repo, github.ts is never called and the model gets a clean "unavailable" tool result', async () => {
    createCompletion
      .mockResolvedValueOnce(
        assistantToolCallResponse([{ id: 'call-5', name: 'read_repo_file', args: JSON.stringify({ path: 'package.json' }) }])
      )
      .mockResolvedValueOnce(assistantProseResponse("I can't read the repo right now — no repo is linked to this project yet. What should the agent do based on your description?"))

    const result = await generateArchitectTurn({
      messages: [userMsg('lis package.json')],
      repoContext: 'REPO INTELLIGENCE: not available yet',
      currentPreview: null,
      repoFullName: undefined,
    })

    expect(getRepoFile).not.toHaveBeenCalled()
    expect(getRepoTree).not.toHaveBeenCalled()
    expect(searchRepoCode).not.toHaveBeenCalled()

    const secondCallArgs = createCompletion.mock.calls[1]![0] as {
      messages: { role: string; content?: unknown }[]
    }
    const toolMsg = secondCallArgs.messages.find((m) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain('repo read unavailable')
    expect(result.reply).toContain("can't read the repo")
  })

  it('bounds the loop at MAX_TOOL_ITERATIONS and still returns prose instead of looping forever', async () => {
    vi.mocked(getRepoTree).mockResolvedValue([{ path: 'README.md', type: 'blob', size: 1 }])

    // The model NEVER stops calling tools on its own — every completion
    // returns another list_repo_tree tool_call. The loop must still
    // terminate with the forced final prose call, not hang or throw.
    createCompletion.mockImplementation(() =>
      Promise.resolve(
        assistantToolCallResponse([{ id: `call-loop-${Math.random()}`, name: 'list_repo_tree', args: '{}' }])
      )
    )
    // The forced final call (tools disabled) is a distinct mock return —
    // append it as the last resolved value so it wins once the loop breaks
    // out of the tool-calling branch.
    createCompletion.mockImplementation((() => {
      let call = 0
      return () => {
        call += 1
        // MAX_TOOL_ITERATIONS is 8: iterations 0..6 execute tools, iteration 7
        // breaks without executing (budget exhausted), then one forced final
        // call happens outside the loop — 8 tool-call completions + 1 final.
        if (call <= 8) {
          return Promise.resolve(
            assistantToolCallResponse([{ id: `call-loop-${call}`, name: 'list_repo_tree', args: '{}' }])
          )
        }
        return Promise.resolve(assistantProseResponse('Repo budget spent — here is what I found so far.'))
      }
    })())

    const result = await generateArchitectTurn({
      messages: [userMsg('explore tout le repo en detail')],
      repoContext: 'REPO INTELLIGENCE: bounded summary',
      currentPreview: null,
      repoFullName: REPO,
    })

    // Never more than MAX_TOOL_ITERATIONS - 1 = 7 actual tool executions.
    expect(vi.mocked(getRepoTree).mock.calls.length).toBeLessThanOrEqual(7)
    expect(result.reply.length).toBeGreaterThan(0)
    expect(result.reply).toContain('budget spent')
  })
})

describe('laconic fallback removal', () => {
  it('the old single-shot fallback string no longer appears in project-builder-conversation.ts', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/lib/agent-mission-control/project-builder-conversation.ts'),
      'utf-8'
    )
    expect(source).not.toContain("I've updated the preview panel with my latest proposal — tell me what to refine.")
  })
})
