import { describe, expect, it } from 'vitest'

import type { ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import {
  actionItemChip,
  sortOverviewProjects,
  windowReadState,
} from '@/components/cockpit/overview/model'

describe('overview model', () => {
  it('windowReadState distingue unread, vide et actif', () => {
    expect(windowReadState(true, null)).toBe('unread')
    expect(windowReadState(false, 0)).toBe('empty')
    expect(windowReadState(false, 3)).toBe('active')
  })

  it('sortOverviewProjects met les projets peuplés en tête', () => {
    const sorted = sortOverviewProjects([
      { id: 'b', name: 'B', copilotCount: 0, activeCount: 0 } as never,
      { id: 'a', name: 'A', copilotCount: 2, activeCount: 1 } as never,
    ])
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('actionItemChip réutilise QUEUE_KIND_LABEL', () => {
    const chip = actionItemChip({ kind: 'mission_blocked' satisfies ActionItemKind })
    expect(chip.label).toBe('Mission bloquée')
    expect(chip.tone).toBe('bad')
  })
})
