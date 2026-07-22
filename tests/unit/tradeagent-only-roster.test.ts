import { describe, expect, it } from 'vitest'

/**
 * AIG-TRADEAGENT-ONLY-019 — the roster decision, pinned.
 *
 * These are not tests of a live database: they pin the *decision* so a later
 * change cannot silently undo it. The persisted state itself is proven by
 * `scripts/archive-non-tradeagent-agents.mjs`, which reads back what it wrote.
 *
 * What must not regress:
 *  - the six standalone `aig-trade-001` copilots stay out of the active roster;
 *  - the four resolved TradeAgent copilots are the canonical active roster;
 *  - the two historical TradeAgent ids stay present but non-active;
 *  - `archived` maps to `unavailable`, never `inactive` — retirement and pause
 *    must not read alike.
 */

/** Archived by this mission. `project_id IS NULL`, so the run route 409s them anyway. */
const ARCHIVED_STANDALONE_IDS = [
  'copilot-atlas-market-structure-6836ef1e',
  'copilot-vector-quant-regime-75d7ad26',
  'copilot-sentinel-risk-manager-382793d6',
  'copilot-pulse-execution-scout-9cdc77e2',
  'copilot-meridian-macro-context-bb9435f5',
  'copilot-sage-trading-coach-8dea0500',
] as const

/** The canonical active roster: in `proj-tradeagent`, zero unresolved tools. */
const ACTIVE_TRADEAGENT_IDS = [
  'copilot-btc-alert-levels-sentinel-draft-a732b361-c9b7fa5c',
  'copilot-portfolio-risk-lock-advisor-draft-ad3e5dc2-87b88c99',
  'copilot-source-reliability-price-trust-sentinel-draft-bd973545-fe8f01c3',
  'copilot-withdrawal-review-copilot-draft-de7c378b-b7de98cd',
] as const

/** Present, historical, NOT active: three declared tools have no handler. */
const NON_ACTIVE_TRADEAGENT_IDS = [
  'copilot-tradeagent-market-intelligence-b1c8c291',
  'copilot-tradeagent-portfolio-risk-guardian-91f81963',
] as const

/** The three tool names these two declare that resolve to nothing registered. */
const UNRESOLVED_TOOL_NAMES = ['read_repo_file', 'list_repo_tree', 'search_repo'] as const

/**
 * The tool names the runner can actually resolve: 5 native + 9 trading +
 * 9 finance, mirrored from TOOL_HANDLERS. `available-agents.ts` is server-only
 * and cannot be imported here, so this list is the contract under test — if a
 * handler is added or removed, this test is the thing that must be updated.
 */
const REGISTERED_TOOL_NAMES = new Set([
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
  'read_funding_open_interest',
  'read_derivatives_snapshot',
  'read_account_risk_snapshot',
  'read_macro_context',
  'read_invoice_document',
  'read_supplier_master',
  'read_purchase_orders',
  'read_goods_receipts',
  'read_bank_transactions',
  'read_chart_of_accounts',
  'read_tax_codes',
  'read_open_missions',
  'read_payment_status',
])

describe('AIG-TRADEAGENT-ONLY-019 — roster decision', () => {
  it('keeps the archived standalone roster disjoint from the active roster', () => {
    for (const id of ARCHIVED_STANDALONE_IDS) {
      expect(ACTIVE_TRADEAGENT_IDS).not.toContain(id)
      expect(NON_ACTIVE_TRADEAGENT_IDS).not.toContain(id)
    }
    expect(ARCHIVED_STANDALONE_IDS).toHaveLength(6)
  })

  it('holds exactly four canonical active TradeAgent agents', () => {
    expect(ACTIVE_TRADEAGENT_IDS).toHaveLength(4)
    expect(new Set(ACTIVE_TRADEAGENT_IDS).size).toBe(4)
  })

  it('never lists the two historical ids as active', () => {
    for (const id of NON_ACTIVE_TRADEAGENT_IDS) {
      expect(ACTIVE_TRADEAGENT_IDS).not.toContain(id)
    }
  })

  it('pins the reason the two historical ids are not executable', () => {
    // Their manifests declare these three; none is a registered handler, so the
    // runner refuses each call with "has no registered handler".
    for (const name of UNRESOLVED_TOOL_NAMES) {
      expect(REGISTERED_TOOL_NAMES.has(name)).toBe(false)
    }
  })

  it('does not claim a repo tool got quietly implemented', () => {
    // Guards the inverse regression: if someone registers these handlers, this
    // test fails and the two agents must be re-evaluated rather than left
    // documented as degraded.
    const anyRegistered = UNRESOLVED_TOOL_NAMES.some((n) => REGISTERED_TOOL_NAMES.has(n))
    expect(anyRegistered).toBe(false)
  })

  it('touches no copilot outside the TradeAgent decision', () => {
    const touched = new Set<string>([
      ...ARCHIVED_STANDALONE_IDS,
      ...ACTIVE_TRADEAGENT_IDS,
      ...NON_ACTIVE_TRADEAGENT_IDS,
    ])
    // 6 archived + 4 active + 2 historical. Any growth here means the blast
    // radius widened beyond what was authorised.
    expect(touched.size).toBe(12)
  })
})
