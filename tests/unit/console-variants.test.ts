import { describe, expect, it } from 'vitest'

import {
  consoleCardChrome,
  consolePanelChrome,
  consoleSurfaceClasses,
  consoleTypography,
} from '@/components/console/console-variants'

describe('consoleSurfaceClasses', () => {
  it('returns distinct chrome per variant', () => {
    expect(consoleSurfaceClasses('primary')).toContain('surface-overlay')
    expect(consoleSurfaceClasses('secondary')).toContain('surface-raised')
    expect(consoleSurfaceClasses('sunken')).toContain('surface-sunken')
    expect(consoleSurfaceClasses('danger')).toContain('state-danger')
  })
})

describe('consolePanelChrome', () => {
  it('composes rounded frame with the requested variant', () => {
    expect(consolePanelChrome('primary')).toMatch(/rounded-xl/)
    expect(consolePanelChrome('primary')).toContain(consoleSurfaceClasses('primary'))
  })
})

describe('consoleCardChrome', () => {
  it('matches panel chrome without imposing flex column', () => {
    expect(consoleCardChrome('secondary')).toContain(consoleSurfaceClasses('secondary'))
    expect(consoleCardChrome('secondary')).not.toContain('flex-col')
  })
})

describe('consoleTypography', () => {
  it('exposes the shared role keys', () => {
    expect(consoleTypography.screenTitle).toContain('text-xl')
    expect(consoleTypography.metric).toContain('tabular-nums')
  })
})
