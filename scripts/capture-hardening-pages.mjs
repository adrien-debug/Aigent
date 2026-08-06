#!/usr/bin/env node
/**
 * Regenerate authenticated visual proofs for the 11 production pages.
 * Usage: node scripts/capture-hardening-pages.mjs [baseUrl]
 * Requires AMC_ADMIN_PASSWORD in env (load via: node --env-file=.env.local ...)
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3987'
const OUT = 'docs/visual-reviews/AIGENT-FULL-DELIVERY-001'
const PWD = process.env.AMC_ADMIN_PASSWORD

const PAGES = [
  ['cockpit', '/'],
  ['agents', '/agents'],
  ['runs', '/runs'],
  ['projects', '/projects'],
  ['project-detail', '/projects/proj-tradeagent'],
  ['qualification', '/qualification'],
  ['qualification-detail', '/qualification/copilot-market-intelligence'],
  ['delivery', '/delivery'],
  ['delivery-detail', '/delivery/copilot-market-intelligence'],
  ['builder', '/builder'],
  ['runtime', '/runtime'],
]

if (!PWD) {
  console.error('[capture] AMC_ADMIN_PASSWORD required (use --env-file=.env.local)')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

await page.goto(`${BASE}/sign-in?next=%2Fagents`, { waitUntil: 'networkidle' })
await page.fill('input[type="password"]', PWD)
await page.click('button[type="submit"]')
await page.waitForURL('**/agents')

for (const [name, route] of PAGES) {
  for (const [suffix, w, h] of [
    ['1440', 1440, 900],
    ['390', 390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const path = join(OUT, `${name}-${suffix}.png`)
    await page.screenshot({ path, fullPage: false })
    console.log(`✓ ${route} @ ${suffix}`)
  }
}

await browser.close()
console.log(`[capture] done → ${OUT}`)
