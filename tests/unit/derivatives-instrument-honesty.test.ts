/**
 * A market tool must answer the instrument it was ASKED about, or refuse.
 *
 * `read_derivatives_snapshot` is backed by a BTCUSDT-only provider (every
 * Binance USD-M futures URL in derivatives.ts hardcodes that symbol). Its Zod
 * schema accepted `symbol: 'BTCUSDT'` and nothing else — and Zod STRIPS unknown
 * keys by default, so `{"pair":"ETHUSDT"}` parsed clean, `symbol` stayed
 * undefined, and the handler returned BTC funding + open interest with `ok:true`.
 *
 * Measured 2026-07-26 while validating ETH coverage before building an
 * ETH-specialist agent: requested ETHUSDT → received `symbol: "BTCUSDT"`, no
 * error, nothing in the payload marking the substitution. `pair` is the field
 * name EVERY other market tool uses, which is exactly why a model reaches for it
 * here — so the silent-swallow path was the LIKELY one, not an edge case.
 *
 * Why this is the worst class of defect for this platform: an agent that reports
 * "ETH funding is positive, OI rising" while reading BTC is not broken in any
 * way an operator can see. It is confident, sourced, and wrong. AGENTS.md draws
 * the line — "donnée absente → UNAVAILABLE avec provenance, jamais inventée" —
 * and answering a DIFFERENT instrument is a fabricated answer wearing a real
 * provider's name.
 *
 * Pure and OFFLINE for the refusal path (it returns before any network call).
 * The BTC path is not exercised here — it needs Binance — and is covered by the
 * live probe instead; this file defends the CONTRACT, not the provider.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { TRADING_TOOL_HANDLERS } = await import('@/lib/agent-mission-control/market/tools')
const readDerivatives = TRADING_TOOL_HANDLERS.read_derivatives_snapshot

/** Every way a caller can name an instrument this tool does not cover. */
const UNSUPPORTED = [
  ['pair (the field every other market tool uses)', '{"pair":"ETHUSDT"}', 'ETHUSDT'],
  ['pair, stable-quoted', '{"pair":"ETHUSDC"}', 'ETHUSDC'],
  ['pair, unrelated instrument', '{"pair":"SOLUSDT"}', 'SOLUSDT'],
] as const

describe('an uncovered instrument is refused, never substituted', () => {
  it.each(UNSUPPORTED)('refuses %s', async (_label, args, requested) => {
    const res = (await readDerivatives(args)) as {
      ok: boolean
      data: Record<string, unknown>
      summary: string
    }

    // Not ok — the caller must be able to branch on this without reading prose.
    expect(res.ok).toBe(false)
    // No instrument payload at all: nothing a model could mistake for an answer.
    expect(res.data.derivatives).toBeNull()
    expect(res.data.truth).toBe('UNAVAILABLE')
    // The refusal names what was asked and what is covered — provenance, not a shrug.
    expect(res.data.requested).toBe(requested)
    expect(res.data.supported).toEqual(['BTCUSDT'])
    expect(res.summary).toContain(requested)
    expect(res.summary).toContain('UNAVAILABLE')
  })

  it('never leaks BTC figures into a refusal', async () => {
    const res = (await readDerivatives('{"pair":"ETHUSDT"}')) as { summary: string }

    // The original defect answered with real BTC funding/OI numbers. A refusal
    // that still carried them would be the same lie with extra steps.
    expect(res.summary).not.toMatch(/funding=[\d.]/)
    expect(res.summary).not.toMatch(/OI=[\d.]/)
    expect(res.summary).not.toMatch(/regime=/)
  })
})

describe('the coverage limit is declared, not just enforced', () => {
  it('states BTCUSDT-only in the canonical tool description', async () => {
    // The runner ships this text to the model INSTEAD of a JSON schema
    // (AGENTS.md: "la description d'un outil EST son contrat d'entrée"), so a
    // limit that lives only in code is a limit the model cannot honour.
    const { TOOL_REGISTRY } = await import('@/lib/agent-mission-control/registry/tools')
    const summary = TOOL_REGISTRY.read_derivatives_snapshot.summary

    expect(summary).toMatch(/BTCUSDT ONLY/i)
    expect(summary).toMatch(/UNAVAILABLE/i)
  })
})
