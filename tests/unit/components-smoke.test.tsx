/**
 * Component smoke tests — render critical dashboard primitives to static markup.
 * No browser env required (react-dom/server). Catches import regressions and
 * missing props on high-traffic UI building blocks.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SoftAccentButton } from '@/components/agent-ops/soft-accent-link'
import { versionStageLabels } from '@/components/agent-ops/version-stage-text'
import { Badge } from '@/components/ui/badge'

describe('EmptyState', () => {
  it('renders title and description', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No agents yet" description="Create one to get started." />
    )
    expect(html).toContain('No agents yet')
    expect(html).toContain('Create one to get started.')
  })
})

describe('Badge (status)', () => {
  it('renders accent and zinc colors', () => {
    const accent = renderToStaticMarkup(<Badge color="accent">Active</Badge>)
    const zinc = renderToStaticMarkup(<Badge color="zinc">Idle</Badge>)
    expect(accent).toContain('Active')
    expect(accent).toContain('text-accent')
    expect(zinc).toContain('Idle')
    expect(zinc).toContain('text-zinc')
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
