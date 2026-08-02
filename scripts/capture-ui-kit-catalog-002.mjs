#!/usr/bin/env node
/**
 * Captures catalogue UI kit AIGENT-DS-REFACTOR-002.
 *
 * Crée temporairement `src/app/ui-kit-catalog/page.tsx` (route dev-only),
 * attend la compilation Next, capture desktop + mobile, puis supprime la route.
 *
 * Usage : node scripts/capture-ui-kit-catalog-002.mjs --phase=before|after
 * Prérequis : dev server sur :3987 (`npm run dev`)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable')
  process.exit(2)
})

const phase = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'after'
const base = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://127.0.0.1:3987'
const outDir = join(process.cwd(), `.tmp/visual-reviews/AIGENT-DS-REFACTOR-002/${phase}`)
const routeDir = join(process.cwd(), 'src/app/ui-kit-catalog')
const routeFile = join(routeDir, 'page.tsx')
const catalogUrl = `${base}/ui-kit-catalog`

mkdirSync(outDir, { recursive: true })

const git = (...params) => execFileSync('git', params, { encoding: 'utf8' }).trim()

const routeSource = `import { UiKitCatalog } from '@/components/ui/ui-kit-catalog'

export default function UiKitCatalogPage() {
  return <UiKitCatalog />
}
`

const SECTIONS = [
  { id: 'catalog-button', slug: 'button' },
  { id: 'catalog-badge', slug: 'badge' },
  { id: 'catalog-textarea-input-absent-du-kit-', slug: 'textarea' },
  { id: 'catalog-checkbox', slug: 'checkbox' },
  { id: 'catalog-dialog', slug: 'dialog' },
]

async function waitForRoute(url, timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return
    } catch {
      // dev server still starting
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error(`route ${url} indisponible après ${timeoutMs}ms`)
}

let routeCreated = false
try {
  mkdirSync(routeDir, { recursive: true })
  writeFileSync(routeFile, routeSource)
  routeCreated = true

  console.log(`attente compilation ${catalogUrl}…`)
  await waitForRoute(catalogUrl)

  const browser = await chromium.launch({ headless: true })
  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '375x812', width: 375, height: 812 },
  ]

  const captures = []

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
    await page.goto(catalogUrl, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.waitForSelector('[data-testid="catalog-button"]', { timeout: 60_000 })

    for (const { id, slug } of SECTIONS) {
      if (slug === 'dialog') {
        await page.getByRole('button', { name: 'Ouvrir' }).click({ force: true })
        await page.waitForTimeout(600)
        const path = join(outDir, `${slug}-${vp.name}.png`)
        await page.screenshot({ path, fullPage: false })
        captures.push(path)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
        continue
      }
      const section = page.locator(`[data-testid="${id}"]`)
      const path = join(outDir, `${slug}-${vp.name}.png`)
      await section.screenshot({ path, timeout: 30_000 })
      captures.push(path)
    }

    const btn = page.locator('[data-testid="catalog-button"] button').first()
    await btn.hover({ force: true })
    await page.screenshot({ path: join(outDir, `button-hover-${vp.name}.png`), fullPage: true })
    await btn.focus({ force: true })
    await page.screenshot({ path: join(outDir, `button-focus-${vp.name}.png`), fullPage: true })

    await page.close()
  }

  await browser.close()

  execFileSync('node', ['scripts/audit-ui-kit-tokens.mjs', `--out=${join(outDir, 'inventory.json')}`], {
    stdio: 'inherit',
  })

  writeFileSync(
    join(outDir, 'metrics.json'),
    JSON.stringify(
      {
        phase,
        capturedAt: new Date().toISOString(),
        gitSha: git('rev-parse', 'HEAD'),
        base,
        route: '/ui-kit-catalog',
        captures: captures.map((p) => p.replace(process.cwd() + '/', '')),
        note: 'Select et Switch absents du kit Catalyst — Textarea tient lieu de Input.',
      },
      null,
      2,
    ) + '\n',
  )

  console.log(`capture ${phase} → ${outDir} (${captures.length} sections × ${viewports.length} viewports)`)
} finally {
  if (routeCreated) {
    rmSync(routeFile, { force: true })
    try {
      rmSync(routeDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}
