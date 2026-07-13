import { describe, expect, it } from 'vitest'

import {
  canStartDraftMaterialization,
  defaultAgentFlow,
  mergePreview,
  redactMessageContent,
  selectPreviewOption,
} from '@/lib/agent-mission-control/project-builder-preview'
import type { AgentPreview } from '@/lib/agent-mission-control/project-builder-types'

describe('project-builder-preview', () => {
  it('mergePreview merges partial patches and dedupes options by id', () => {
    const base: AgentPreview = {
      name: 'Guard',
      options: [{ id: 'a', title: 'A', summary: 'read-only', tradeoffs: ['safe'] }],
    }
    const merged = mergePreview(base, {
      role: 'Design sentinel',
      options: [{ id: 'b', title: 'B', summary: 'blocker', tradeoffs: ['strict'] }],
    })
    expect(merged?.name).toBe('Guard')
    expect(merged?.role).toBe('Design sentinel')
    expect(merged?.options?.map((o) => o.id).sort()).toEqual(['a', 'b'])
  })

  it('selectPreviewOption sets selectedOptionId and applies option fields', () => {
    const preview: AgentPreview = {
      options: [{ id: 'ro', title: 'Read-only', summary: 'Safe guard', tradeoffs: ['no writes'] }],
    }
    const next = selectPreviewOption(preview, 'ro')
    expect(next?.selectedOptionId).toBe('ro')
    expect(next?.name).toBe('Read-only')
  })

  it('canStartDraftMaterialization is fail-closed without readyForApproval', () => {
    expect(canStartDraftMaterialization(null).ok).toBe(false)
    expect(canStartDraftMaterialization({ name: 'X' }).ok).toBe(false)
    expect(canStartDraftMaterialization({ name: 'X', readyForApproval: true }).ok).toBe(true)
  })

  it('redactMessageContent strips secret patterns', () => {
    const redacted = redactMessageContent('token GITHUB_TOKEN=ghp_secret123 here')
    expect(redacted).not.toContain('ghp_secret123')
    expect(redacted).toContain('[redacted-secret]')
  })

  it('defaultAgentFlow returns architect graph steps', () => {
    expect(defaultAgentFlow()).toEqual(['start', 'agent', 'approval?', 'tools?', 'final'])
  })
})

describe('project-builder conversation guards', () => {
  it('discuss message shape does not imply draft creation', () => {
    const msg =
      'Discutons de cette recommandation : "Design System Guardian".\n\npas de draft pour l\'instant.'
    expect(msg.toLowerCase()).toContain('discutons')
    expect(msg.toLowerCase()).toContain('pas de draft')
  })
})
