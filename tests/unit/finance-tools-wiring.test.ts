/**
 * AIG-FIN-001 — finance tool wiring.
 *
 * Regression guard for a silent break: FINANCE_TOOL_HANDLERS existed, was
 * benched 16/16, and was imported NOWHERE — so every AP copilot tool call fell
 * through to "tool not found". These tests assert the registry is actually
 * reachable from the runner's resolution path, that wiring it shadowed nothing,
 * and that the read-only/truth-aware contract survived the adaptation.
 */
import { describe, it, expect } from 'vitest'
import { TOOL_HANDLERS } from '@/lib/agent-mission-control/tool-handlers'
import {
  FINANCE_TOOL_HANDLERS,
  FINANCE_TOOL_IDS,
} from '@/lib/agent-mission-control/finance/tools'
import { TRADING_TOOL_HANDLERS } from '@/lib/agent-mission-control/market/tools'

const NATIVE_TOOL_IDS = [
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
]

describe('finance tools are resolvable from TOOL_HANDLERS', () => {
  it('exposes all 9 declared finance tool ids', () => {
    expect(FINANCE_TOOL_IDS).toHaveLength(9)
    for (const id of FINANCE_TOOL_IDS) {
      expect(typeof TOOL_HANDLERS[id], `TOOL_HANDLERS[${id}]`).toBe('function')
    }
  })

  it('keeps the native and trading handlers reachable too', () => {
    for (const id of [...NATIVE_TOOL_IDS, ...Object.keys(TRADING_TOOL_HANDLERS)]) {
      expect(typeof TOOL_HANDLERS[id], `TOOL_HANDLERS[${id}]`).toBe('function')
    }
  })

  it('registers no colliding names across native, trading and finance', () => {
    const ids = [
      ...NATIVE_TOOL_IDS,
      ...Object.keys(TRADING_TOOL_HANDLERS),
      ...FINANCE_TOOL_IDS,
    ]
    const seen = new Map<string, number>()
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([])
    // Total registry size == sum of the parts ⇒ nothing was silently shadowed.
    expect(Object.keys(TOOL_HANDLERS).sort()).toEqual([...new Set(ids)].sort())
  })
})

describe('finance handlers stay safe through the ToolHandler adaptation', () => {
  const ctx = { copilotId: 'copilot-fin-documents' }

  it('never throws on missing/absent data — returns UNAVAILABLE with provenance', async () => {
    const r = await TOOL_HANDLERS.read_invoice_document(
      JSON.stringify({ invoiceId: 'inv-does-not-exist-xyz' }),
      ctx,
    )
    expect(r.ok).toBe(false)
    const data = r.data as { truth?: string; reason?: string; invoice?: unknown }
    expect(data.truth).toBe('UNAVAILABLE')
    expect(typeof data.reason).toBe('string')
    // Absent datum is never fabricated.
    expect(data.invoice ?? null).toBeNull()
  })

  it('never throws on malformed args — every handler resolves to a result', async () => {
    for (const id of FINANCE_TOOL_IDS) {
      for (const args of ['', 'not json at all', '[]', '{"bogusKey":123}']) {
        const r = await TOOL_HANDLERS[id](args, ctx)
        expect(typeof r.ok, `${id} <- ${args}`).toBe('boolean')
        expect(typeof r.summary, `${id} <- ${args}`).toBe('string')
      }
    }
  })

  it('adapts every finance handler without dropping one', () => {
    expect(Object.keys(FINANCE_TOOL_HANDLERS).sort()).toEqual([...FINANCE_TOOL_IDS].sort())
  })
})
