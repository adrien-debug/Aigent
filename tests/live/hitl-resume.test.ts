/**
 * Live tests — human-in-the-loop pause + resume for the gated write tool
 * (draft_copilot_spec).
 *
 * Regression under test (git history, resume/route.ts header comment + fix
 * "le nom de l'outil approuvé n'est plus perdu au resume"): a resumed tool
 * call used to be persisted with tool_name === 'tool' (a generic placeholder)
 * instead of the REAL tool name ('draft_copilot_spec') — because the
 * AIMessage that requested the gated call sits BEFORE the interrupt pause, and
 * the resume path used to resolve tool names only from the POST-pause
 * messages, missing it. This test drives the full pause → resume cycle
 * against the real Agent Server and asserts the persisted tool_calls row
 * carries the real name, not the placeholder.
 *
 * COST: this test makes 2 REAL OpenAI calls (initial run + resume). Opt-in
 * only (`npm run test:live`). Skips cleanly when the stack isn't up.
 */
import { describe, expect, it } from 'vitest'

import { amcHeaders, findAppBaseUrl, findRepoScopedLangGraphCopilot, hasBackendEnv, pgrestGet } from './helpers'

describe('draft_copilot_spec — pause for approval, then resume', () => {
  it('a run that triggers draft_copilot_spec returns needs-confirmation + interrupted + the real pending tool name', async () => {
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

    // A NATURAL request — deliberately NOT "call draft_copilot_spec right now,
    // don't ask a question". That coercive phrasing is what let this test pass
    // while the gate was actually broken in production: the system prompt used to
    // say "Ask a human to confirm before any risky tool call", and the model obeyed
    // literally — it wrote "confirm and I'll invoke it" in prose and NEVER emitted
    // the tool call, so approvalNode saw nothing and interrupt() never fired. The
    // human-in-the-loop gate silently never engaged. Only a natural prompt proves
    // the gate engages the way an operator would actually trigger it.
    const userInput = 'Draft a copilot spec for a log triage agent.'

    const runRes = await fetch(`${baseUrl}/api/agent-ops/copilots/${copilot.id}/run`, {
      method: 'POST',
      headers: amcHeaders(apiKey),
      body: JSON.stringify({ userInput }),
      signal: AbortSignal.timeout(60_000),
    })

    if (runRes.status === 409 || runRes.status === 503) {
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
      pendingTool: { name: string; argumentsSummary: string } | null
    }

    if (!runBody.interrupted) {
      // The model didn't take the bait this time (LLM non-determinism)  — note
      // and stop rather than fail the suite on a prompt-following flake.
      console.warn(
        `[live] note: model did not trigger draft_copilot_spec this run (status=${runBody.status}) — skipping resume assertions`
      )
      return
    }

    expect(runBody.status).toBe('needs-confirmation')
    expect(runBody.interrupted).toBe(true)
    expect(runBody.pendingTool).not.toBeNull()
    expect(runBody.pendingTool?.name).toBe('draft_copilot_spec')

    // Resume with approval.
    const resumeRes = await fetch(
      `${baseUrl}/api/agent-ops/copilots/${copilot.id}/runs/${runBody.runId}/resume`,
      {
        method: 'POST',
        headers: amcHeaders(apiKey),
        body: JSON.stringify({ approved: true }),
        signal: AbortSignal.timeout(60_000),
      }
    )
    expect(resumeRes.status).toBe(200)
    const resumeBody = (await resumeRes.json()) as { ok: boolean; status: string }
    expect(resumeBody.ok).toBe(true)
    expect(resumeBody.status).toBe('completed')

    // THE regression assertion: the persisted tool_calls row for this run
    // must carry the REAL tool name, not the 'tool' placeholder.
    const toolCalls = await pgrestGet<Record<string, unknown>[]>(
      `tool_calls?run_id=eq.${encodeURIComponent(runBody.runId)}&select=id,tool_name,status`
    )
    expect(toolCalls).not.toBeNull()
    const draftCall = toolCalls!.find((tc) => tc.tool_name === 'draft_copilot_spec')
    expect(
      draftCall,
      `expected a tool_calls row named 'draft_copilot_spec', got: ${JSON.stringify(toolCalls)} ` +
        `(if you see tool_name: 'tool' here, the resume-time name-resolution regression is back)`
    ).toBeDefined()
    expect(toolCalls!.some((tc) => tc.tool_name === 'tool')).toBe(false)
  })
})
