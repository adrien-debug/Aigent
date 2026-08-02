/**
 * AIG-DROPSHIP-001 — roster archivé (2026-08-02).
 *
 * Les agents dropship ne sont plus servis par Aigent : roster vide, pas de
 * facturation live, pas de provisioning. Les définitions Lot 1 restent dans
 * `roster.ts` pour traçabilité git.
 */
import { describe, it, expect } from 'vitest'
import {
  DROPSHIP_ROSTER,
  DROPSHIP_IMPORT,
  DROPSHIP_ARCHIVED,
  getDropshipAgentBySlug,
} from '@/lib/agent-mission-control/dropship/agents/roster'

describe('dropship roster (archived)', () => {
  it('is explicitly archived', () => {
    expect(DROPSHIP_ARCHIVED).toBe(true)
  })

  it('exports an empty roster', () => {
    expect(DROPSHIP_ROSTER).toHaveLength(0)
  })

  it('does not resolve any slug while archived', () => {
    expect(getDropshipAgentBySlug('dropship-super-agent')).toBeUndefined()
    expect(getDropshipAgentBySlug('dropship-recherche-niche')).toBeUndefined()
  })

  it('keeps import provenance for traceability', () => {
    expect(DROPSHIP_IMPORT.repo).toBe('Hearst-Corporation/dropship-platform')
    expect(DROPSHIP_IMPORT.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(DROPSHIP_IMPORT.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
