/**
 * The commissioned admin routes remain thin server shells. Component rendering
 * is covered by the component suite; this test pins the route-to-screen wiring
 * without importing server-only data modules into jsdom.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function routeSource(path: string) {
  return readFileSync(join(ROOT, 'src/app/admin', path), 'utf8')
}

describe('commissioned admin screens — wired without legacy dependencies', () => {
  it('/admin uses the live overview screen', () => {
    const source = routeSource('page.tsx')
    expect(source).toContain('getDashboardPageData')
    expect(source).toContain('<OverviewScreen')
  })

  it('/admin/runs uses the live runs screen', () => {
    const source = routeSource('runs/page.tsx')
    expect(source).toContain('getRunsPageData')
    expect(source).toContain('<RunsScreen')
  })

  it('/admin/projects/:id/builder uses the strict builder screen', () => {
    const source = routeSource('projects/[id]/builder/page.tsx')
    expect(source).toContain('getProjectBuilderPageData')
    expect(source).toContain('<ProjectBuilderScreen')
  })
})
