#!/usr/bin/env node
/**
 * Inventaire rounded / shadow / ring dans `src/components/ui/`.
 * Usage : node scripts/audit-ui-kit-tokens.mjs [--out=path]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KIT_DIR = 'src/components/ui'
const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1]
const outPath = outArg ?? join(KIT_DIR, '.token-inventory.json')

const ROUNDED = /\brounded[\w:-]*(?:\[[^\]]+\])?/g
const SHADOW = /\bshadow[\w:-]*(?:\[[^\]]+\])?/g
const RING = /\bring[\w:-]*(?:\[[^\]]+\])?/g

const inventory = {}
for (const name of readdirSync(KIT_DIR).filter((n) => /\.tsx?$/.test(n))) {
  const src = readFileSync(join(KIT_DIR, name), 'utf8')
  inventory[name] = {
    rounded: [...new Set(src.match(ROUNDED) ?? [])].sort(),
    shadow: [...new Set(src.match(SHADOW) ?? [])].sort(),
    ring: [...new Set(src.match(RING) ?? [])].sort(),
  }
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(inventory, null, 2) + '\n')
console.log(`ui-kit token inventory → ${outPath}`)
