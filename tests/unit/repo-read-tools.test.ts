/**
 * Unit tests for repo-read tool mounting (repo-read-tools.ts).
 */
import { describe, expect, it } from 'vitest'

import {
  REPO_READ_TOOL_NAMES,
  augmentProposedToolsWithRepoRead,
  claimsRepoInspectionRole,
  effectiveToolNamesForRepoFit,
  isWriteCapableToolName,
} from '@/lib/agent-mission-control/repo-read-tools'

describe('claimsRepoInspectionRole', () => {
  it('detects inspection / diagnostic / repo-context roles', () => {
    expect(claimsRepoInspectionRole('Inspect and analyze the BTC codebase')).toBe(true)
    expect(claimsRepoInspectionRole('Diagnostic sentinel for levels')).toBe(true)
    expect(claimsRepoInspectionRole('Read-only trading alerts')).toBe(true)
    expect(claimsRepoInspectionRole('Emit BUY/SELL signals only')).toBe(false)
  })
})

describe('augmentProposedToolsWithRepoRead', () => {
  it('adds repo-read tools for inspection role on a repo-linked copilot', () => {
    const out = augmentProposedToolsWithRepoRead(
      [{ name: 'http_get', description: 'x', provider: 'internal', riskLevel: 'low', requiresConfirmation: false }],
      'Inspect the repo for trading signals',
      true
    )
    const names = out.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining([...REPO_READ_TOOL_NAMES]))
    expect(out.every((t) => t.riskLevel === 'low' && !t.requiresConfirmation)).toBe(true)
  })

  it('does not add tools when no repo', () => {
    const tools = [{ name: 'http_get', description: 'x', provider: 'internal' as const, riskLevel: 'low' as const, requiresConfirmation: false }]
    expect(augmentProposedToolsWithRepoRead(tools, 'Inspect the repo', false)).toEqual(tools)
  })

  it('never adds write tools', () => {
    const out = augmentProposedToolsWithRepoRead([], 'Review and audit files', true)
    expect(out.every((t) => !isWriteCapableToolName(t.name))).toBe(true)
  })
})

describe('effectiveToolNamesForRepoFit', () => {
  it('BTC inspection role gets repo-read tools even when DB tools are empty', () => {
    const names = effectiveToolNamesForRepoFit({
      toolNames: [],
      roleText: 'BTC Alert sentinel — inspect levels and read repo context',
      hasRepo: true,
    })
    expect(names).toEqual(expect.arrayContaining([...REPO_READ_TOOL_NAMES]))
  })

  it('leaves non-inspection roles unchanged', () => {
    expect(
      effectiveToolNamesForRepoFit({ toolNames: ['http_get'], roleText: 'Trade only', hasRepo: true })
    ).toEqual(['http_get'])
  })
})
