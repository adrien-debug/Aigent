#!/usr/bin/env node
/**
 * Captures minimales AIGENT-DS-REFACTOR-001 — home @ 1440×900.
 * Usage : node scripts/capture-ds-foundation-001.mjs --phase=before|after
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable')
  process.exit(2)
})

const phase = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'after'
const base = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://127.0.0.1:3987'
const outDir = join(process.cwd(), `docs/visual-reviews/AIGENT-DS-REFACTOR-001/${phase}`)
mkdirSync(outDir, { recursive: true })

const git = (...params) => execFileSync('git', params, { encoding: 'utf8' }).trim()

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForTimeout(500)

const png = join(outDir, 'home-1440x900.png')
await page.screenshot({ path: png, fullPage: true })

const metrics = await page.evaluate(() => {
  const panel = document.querySelector('.aig-panel')
  const style = panel ? getComputedStyle(panel) : null
  const root = getComputedStyle(document.documentElement)
  return {
    aigRadius: root.getPropertyValue('--aig-radius').trim(),
    radiusMd: root.getPropertyValue('--radius-md').trim(),
    panelBorderRadius: style?.borderRadius ?? null,
    surfacePrimary: root.getPropertyValue('--surface-primary').trim(),
  }
})

writeFileSync(
  join(outDir, 'metrics.json'),
  JSON.stringify(
    {
      phase,
      capturedAt: new Date().toISOString(),
      gitSha: git('rev-parse', 'HEAD'),
      base,
      metrics,
    },
    null,
    2,
  ) + '\n',
)

await browser.close()
console.log(`capture ${phase} → ${png}`)
