import { describe, expect, it } from 'vitest'

import type { ProposedTool } from '@/lib/agent-mission-control/authoring-types'
import { buildToolMountRows } from '@/lib/agent-mission-control/tool-catalog'

describe('tool-catalog buildToolMountRows', () => {
  it('sets tool_definition_id from registry id and preserves mount fields', () => {
    const proposed: ProposedTool[] = [
      {
        name: 'read_market_snapshot',
        description: 'Live market snapshot',
        provider: 'internal',
        riskLevel: 'low',
        requiresConfirmation: false,
        mutates: false,
      },
    ]
    const rows = buildToolMountRows('copilot-market-intelligence', 'market-intelligence', proposed)
    expect(rows).toHaveLength(1)
    expect(rows[0].copilot_id).toBe('copilot-market-intelligence')
    expect(rows[0].tool_definition_id).toBe('read_market_snapshot')
    expect(rows[0].name).toBe('read_market_snapshot')
    expect(rows[0].mutates).toBe(false)
    expect(rows[0].enabled).toBe(true)
    expect(String(rows[0].id)).toMatch(/^tool-market-intelligence-read-market-snapshot-/)
  })

  it('falls back to proposed name when tool is not in registry', () => {
    const proposed: ProposedTool[] = [
      {
        name: 'custom_bespoke_tool',
        description: 'One-off',
        provider: 'internal',
        riskLevel: 'medium',
        requiresConfirmation: true,
        mutates: true,
      },
    ]
    const rows = buildToolMountRows('copilot-x', 'x', proposed)
    expect(rows[0].tool_definition_id).toBe('custom_bespoke_tool')
  })
})
