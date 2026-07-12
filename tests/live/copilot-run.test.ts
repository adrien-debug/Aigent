/**
 * Live tests — THE test that would have caught the production incident.
 *
 * Incident recap (git history bb857a2, ee14bfa, 465204e, 6ea63fe): a
 * `langgraph`-runtime copilot's dedicated LangGraph assistant could vanish
 * from the (in-memory) Agent Server, or its config.configurable could carry
 * NO repo tools despite the copilot being attached to a repo. Either way,
 * the run fell back to a config with no real repo access, the model
 * HALLUCINATED the repo's contents, and the run still persisted
 * `status: completed` — a fabricated success, ZERO tool_calls rows in the
 * database. `npm run typecheck && npm run lint && npm run build` all stayed
 * green throughout, because none of them can see into a live tool_calls
 * table.
 *
 * This test closes that gap: it launches a REAL run against a real,
 * repo-scoped, langgraph-runtime copilot, asking it to do something that
 * REQUIRES reading the repo, then asserts — directly against Postgres via
 * PostgREST, not just the HTTP response — that at least one tool_calls row
 * was persisted for that run_id. A `completed` run with zero tool_calls when
 * the prompt demanded a repo read is exactly the failure mode that slipped
 * through before.
 *
 * COST: this test makes a REAL OpenAI call (~$0.001–0.005) plus a real
 * GitHub API read. Opt-in only (`npm run test:live`), and it runs at most
 * ONE live run per test file execution.
 *
 * Opt-in (`npm run test:live`): requires `npm run dev` running (Next +
 * LangGraph Agent Server) and a live gpu1 backend. Skips cleanly (does not
 * fail) when any prerequisite is missing.
 */
import { describe, expect, it } from 'vitest'

import { amcHeaders, findAppBaseUrl, findRepoScopedLangGraphCopilot, hasBackendEnv, pgrestGet } from './helpers'

describe('POST /api/agent-ops/copilots/:id/run — repo tool_calls must exist on a completed run (the incident)', () => {
  it('a run that requires a repo read persists at least one tool_calls row — never a hallucinated "completed"', async () => {
    const baseUrl = await findAppBaseUrl()
    const apiKey = process.env.AMC_API_KEY
    if (!baseUrl || !apiKey) {
      console.warn('[live] skip: app not reachable or AMC_API_KEY not set')
      return
    }
    if (!hasBackendEnv() || !process.env.OPENAI_API_KEY) {
      console.warn('[live] skip: gpu1 backend or OPENAI_API_KEY not configured')
      return
    }

    const copilot = await findRepoScopedLangGraphCopilot()
    if (!copilot) {
      console.warn('[live] skip: no repo-scoped langgraph copilot found in the live backend')
      return
    }

    const userInput =
      'List the files at the root of your linked repository using your repo tools, then name one file you see. ' +
      'You MUST call a repo tool to answer — do not guess or recall from memory.'

    const runRes = await fetch(`${baseUrl}/api/agent-ops/copilots/${copilot.id}/run`, {
      method: 'POST',
      headers: amcHeaders(apiKey),
      body: JSON.stringify({ userInput }),
      signal: AbortSignal.timeout(60_000),
    })

    if (runRes.status === 409 || runRes.status === 503) {
      // Copilot has no serving version, or the live backend dropped out
      // mid-suite — an environment fact, not a route bug under test here.
      const body = await runRes.json().catch(() => ({}))
      console.warn(`[live] skip: run route returned ${runRes.status} (${body.error ?? 'no detail'})`)
      return
    }

    expect(runRes.status).toBe(200)
    const runBody = (await runRes.json()) as {
      ok: boolean
      runId: string
      status: string
      interrupted: boolean
    }
    expect(runBody.ok).toBe(true)
    expect(typeof runBody.runId).toBe('string')

    // If the run paused for approval (draft_copilot_spec is the only gated
    // tool and this prompt shouldn't trigger it), that's a different flow —
    // covered by hitl-resume.test.ts. Here we only assert the completed case.
    if (runBody.interrupted) {
      console.warn('[live] note: run interrupted instead of completing — see hitl-resume.test.ts for that path')
      return
    }

    expect(runBody.status).toBe('completed')

    // THE assertion: query tool_calls directly — bypass the HTTP layer
    // entirely so a route that LIES about what happened (the original bug)
    // can't fool this test the way it fooled status: completed.
    const toolCalls = await pgrestGet<Record<string, unknown>[]>(
      `tool_calls?run_id=eq.${encodeURIComponent(runBody.runId)}&select=id,tool_name,status`
    )
    expect(toolCalls, 'expected to be able to query tool_calls from the live backend').not.toBeNull()
    expect(
      toolCalls!.length,
      `run ${runBody.runId} completed with ZERO tool_calls — this is the hallucination bug: ` +
        `a repo-scoped copilot answered without ever calling a repo tool`
    ).toBeGreaterThan(0)

    // And it must be a REAL repo tool, not a fabricated/placeholder name.
    const repoToolNames = new Set(['read_repo_file', 'list_repo_tree', 'search_repo', 'http_get'])
    const usedARepoTool = toolCalls!.some((tc) => repoToolNames.has(tc.tool_name as string))
    expect(
      usedARepoTool,
      `run ${runBody.runId}'s tool_calls did not include any repo tool: ${JSON.stringify(toolCalls)}`
    ).toBe(true)
  })
})
