import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../..')

function read(rel: string) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('console UI token consolidation', () => {
  it('status-dot neutral/pending do not use raw zinc classes', () => {
    const source = read('src/components/ui/status-dot.tsx')
    expect(source).not.toMatch(/zinc-\d/)
  })

  it('button outline/plain dark mode use semantic content tokens', () => {
    const source = read('src/components/ui/button.tsx')
    expect(source).toMatch(/dark:text-content/)
    expect(source).toMatch(/dark:border-line-strong/)
    expect(source).not.toMatch(/dark:border-white\/15/)
  })

  it('table defaults use semantic line/content tokens', () => {
    const source = read('src/components/ui/table.tsx')
    expect(source).toMatch(/text-content-muted/)
    expect(source).toMatch(/border-line/)
    expect(source).not.toMatch(/text-zinc-/)
    expect(source).not.toMatch(/border-white\/10/)
  })
})
