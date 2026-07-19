/**
 * Component smoke tests — render critical dashboard primitives to static markup.
 * No browser env required (react-dom/server). Catches import regressions and
 * missing props on high-traffic UI building blocks.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusPill } from '@/components/agent-ops/status-pill'
import { SoftAccentButton } from '@/components/agent-ops/soft-accent-link'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'

describe('EmptyState', () => {
  it('renders title and description', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No agents yet" description="Create one to get started." />
    )
    expect(html).toContain('No agents yet')
    expect(html).toContain('Create one to get started.')
  })
})

describe('RuntimeBadge', () => {
  it('renders the human-readable runtime label', () => {
    const html = renderToStaticMarkup(<RuntimeBadge runtime="langgraph" />)
    expect(html).toContain('LangGraph')
  })
})

describe('StatusPill', () => {
  it('renders accent and zinc tones', () => {
    const accent = renderToStaticMarkup(<StatusPill label="Active" tone="accent" />)
    const zinc = renderToStaticMarkup(<StatusPill label="Idle" tone="zinc" />)
    expect(accent).toContain('Active')
    expect(accent).toContain('bg-accent-500')
    expect(zinc).toContain('Idle')
    expect(zinc).toContain('bg-zinc-600')
  })
})

describe('SoftAccentButton', () => {
  it('renders children as a button control', () => {
    const html = renderToStaticMarkup(<SoftAccentButton onClick={() => {}}>New agent</SoftAccentButton>)
    expect(html).toContain('New agent')
    expect(html).toContain('<button')
  })
})

describe('versionStageLabels', () => {
  it('maps production stage to a human label', () => {
    expect(versionStageLabels.production).toBeTruthy()
    expect(typeof versionStageLabels.production).toBe('string')
  })
})
