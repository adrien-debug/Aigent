/**
 * Garde-fou : le Link Catalyst doit rester branché sur le routeur Next.js.
 * Sans ça, SidebarItem / TextLink retombent en navigation full-page.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const LINK_PATH = join(ROOT, 'src/components/ui/link.tsx')
const NEXT_LINK_IMPORT = /from\s+['"]next\/link['"]/

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('catalyst Link ↔ next/link', () => {
  it('importe NextLink depuis next/link (intégration Catalyst officielle)', () => {
    const source = readFileSync(LINK_PATH, 'utf8')
    expect(source).toMatch(NEXT_LINK_IMPORT)
    expect(source).toMatch(/NextLink/)
    expect(source).not.toMatch(/<\s*a\s+\{\.\.\.props\}/)
  })

  it('aucun écran produit ne contourne le kit avec un import next/link direct', () => {
    const offenders = listSourceFiles(join(ROOT, 'src'))
      .filter((file) => file !== LINK_PATH)
      .filter((file) => NEXT_LINK_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
    expect(offenders).toEqual([])
  })
})
