import { describe, expect, it } from 'vitest'

import {
  assessMarketIntelligenceOperatorRun,
  MARKET_INTELLIGENCE_TOOL_IDS,
} from '@/lib/agent-mission-control/market/eval/operator-run-quality'

describe('assessMarketIntelligenceOperatorRun', () => {
  it('passes when 4+ declared tools used and provenance stated', () => {
    const q = assessMarketIntelligenceOperatorRun({
      actualToolNames: MARKET_INTELLIGENCE_TOOL_IDS.slice(0, 4),
      outputText: 'Provider: Binance spot. Freshness: live (~1s).',
    })
    expect(q.toolBreadthOk).toBe(true)
    expect(q.provenanceMentioned).toBe(true)
    expect(q.warnings).toHaveLength(0)
  })

  it('warns when fewer than 4 tools on a full synthesis run', () => {
    const q = assessMarketIntelligenceOperatorRun({
      actualToolNames: ['read_volatility_state', 'read_liquidity_snapshot'],
      outputText: 'Bearish structure.',
    })
    expect(q.toolBreadthOk).toBe(false)
    expect(q.missingTools.length).toBeGreaterThan(0)
    expect(q.warnings.some((w) => w.includes('tool breadth'))).toBe(true)
    expect(q.warnings.some((w) => w.includes('provenance'))).toBe(true)
  })
})
