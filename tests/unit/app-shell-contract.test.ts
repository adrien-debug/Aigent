import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const APP_SHELL = join(ROOT, 'src/components/app-shell.tsx')

describe('app shell scroll contract', () => {
  it('does not add a second active marker outside SidebarItem', () => {
    const source = readFileSync(APP_SHELL, 'utf8')
    expect(source.includes('bg-[var(--aig-accent)]')).toBe(false)
  })

  it('keeps desktop and mobile sidebar wrappers non-scrollable', () => {
    const source = readFileSync(APP_SHELL, 'utf8')
    expect(source.includes('data-sidebar-desktop-shell')).toBe(true)
    expect(source.includes('data-sidebar-mobile-shell')).toBe(true)
    expect(source.includes('data-sidebar-desktop-shell className="aig-subtle aig-line-soft scroll-thin')).toBe(
      false,
    )
    expect(source.includes('data-sidebar-mobile-shell className="aig-panel-raised scroll-thin')).toBe(false)
  })
})
