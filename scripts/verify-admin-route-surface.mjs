/**
 * Admin route surface regression — ensures client navigations never stack two
 * full pages (e.g. Fleet Performance + Dashboard) in the same viewport.
 *
 * Run: node scripts/verify-admin-route-surface.mjs
 * Requires dev server on http://localhost:3000
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.ADMIN_TEST_URL ?? 'http://localhost:3000'
const OUT = path.join(process.cwd(), 'tmp', 'admin-route-surface')

async function readSurface(page) {
  return page.evaluate(() => ({
    url: location.pathname,
    h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()),
    fleet: document.body.innerText.includes('Fleet Performance'),
    dashboard: document.body.innerText.includes('Agent Delivery Command Center'),
    telemetry: document.body.innerText.includes('Runtime Telemetry'),
    settings: document.body.innerText.includes('Global Settings'),
    leaderboard: document.body.innerText.includes('Agent Leaderboard'),
    projects: document.body.innerText.includes('Requires Attention'),
    wrappers: document.querySelectorAll('main .flex.min-h-0.flex-1.flex-col.p-6').length,
    pageBlocks: document.querySelectorAll('main .flex.flex-col.gap-8.pb-12').length,
    staggerFade: document.querySelectorAll('main [style*="opacity"]').length,
    busy: document.querySelector('main [aria-busy="true"]') !== null,
  }))
}

function assertNoStack(label, s) {
  const errors = []
  if (s.wrappers !== 1) errors.push(`wrappers=${s.wrappers} (expected 1)`)
  if (s.pageBlocks > 1) errors.push(`pageBlocks=${s.pageBlocks} (expected ≤1)`)
  if (s.fleet && s.dashboard) errors.push('Fleet Performance + Dashboard stacked')
  if (s.fleet && s.projects) errors.push('Fleet Performance + Dashboard projects stacked')
  if (s.leaderboard && s.projects) errors.push('Leaderboard + Dashboard projects stacked')
  if (s.h1s.length > 1) errors.push(`multiple h1: ${s.h1s.join(' | ')}`)
  if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await mkdir(OUT, { recursive: true })

const failures = []
const scenarios = []

async function runScenario(name, fn) {
  try {
    await fn()
    scenarios.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    failures.push({ name, msg })
    scenarios.push({ name, ok: false, msg })
    console.error(`FAIL  ${name}: ${msg}`)
  }
}

await runScenario('direct /admin', async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(2000)
  const s = await readSurface(page)
  assertNoStack('direct /admin', s)
  if (!s.dashboard || s.h1s[0] !== 'Agent Delivery Command Center') {
    throw new Error('dashboard not loaded')
  }
  await page.screenshot({ path: path.join(OUT, '01-direct-admin.png'), fullPage: true })
})

await runScenario('direct /admin/performance', async () => {
  await page.goto(`${BASE}/admin/performance`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(2000)
  const s = await readSurface(page)
  assertNoStack('direct /admin/performance', s)
  if (!s.fleet || s.h1s[0] !== 'Fleet Performance') throw new Error('performance not loaded')
  await page.screenshot({ path: path.join(OUT, '02-direct-performance.png'), fullPage: true })
})

await runScenario('perf → admin client nav (sample during transition)', async () => {
  await page.goto(`${BASE}/admin/performance`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.click('a[href="/admin"]')
  let stacked = false
  for (const ms of [50, 100, 200, 400, 800, 1500, 3000]) {
    await page.waitForTimeout(ms)
    const s = await readSurface(page)
    try {
      assertNoStack(`transition +${ms}ms`, s)
    } catch {
      stacked = true
      await page.screenshot({ path: path.join(OUT, `03-stack-at-${ms}ms.png`), fullPage: true })
      throw new Error(`stack detected at +${ms}ms cumulative`)
    }
  }
  await page.waitForTimeout(8000)
  const final = await readSurface(page)
  assertNoStack('after load', final)
  if (!final.dashboard) throw new Error('dashboard never loaded after nav')
  await page.screenshot({ path: path.join(OUT, '03-perf-to-admin.png'), fullPage: true })
})

await runScenario('admin → performance client nav', async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(2000)
  await page.click('a[href="/admin/performance"]')
  for (const ms of [50, 200, 800, 2000]) {
    await page.waitForTimeout(ms)
    const s = await readSurface(page)
    assertNoStack(`admin→perf +${ms}ms`, s)
  }
  await page.waitForTimeout(6000)
  const final = await readSurface(page)
  assertNoStack('admin→perf final', final)
  if (!final.fleet) throw new Error('performance never loaded')
  await page.screenshot({ path: path.join(OUT, '04-admin-to-perf.png'), fullPage: true })
})

await runScenario('rail: settings → dashboard → telemetry', async () => {
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(2000)
  await page.click('a[href="/admin"]')
  await page.waitForTimeout(8000)
  let s = await readSurface(page)
  assertNoStack('settings→admin', s)
  await page.click('a[href="/admin/telemetry"]')
  await page.waitForTimeout(6000)
  s = await readSurface(page)
  assertNoStack('admin→telemetry', s)
  await page.screenshot({ path: path.join(OUT, '05-settings-dashboard-telemetry.png'), fullPage: true })
})

await runScenario('browser back/forward', async () => {
  await page.goto(`${BASE}/admin/performance`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.click('a[href="/admin"]')
  await page.waitForTimeout(8000)
  await page.goBack()
  await page.waitForTimeout(3000)
  let s = await readSurface(page)
  assertNoStack('back to perf', s)
  if (!s.fleet) throw new Error('back did not restore performance')
  await page.goForward()
  await page.waitForTimeout(8000)
  s = await readSurface(page)
  assertNoStack('forward to admin', s)
  if (!s.dashboard) throw new Error('forward did not restore dashboard')
  await page.screenshot({ path: path.join(OUT, '06-back-forward.png'), fullPage: true })
})

await runScenario('command palette nav', async () => {
  await page.goto(`${BASE}/admin/performance`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(300)
  await page.getByRole('option', { name: 'Go to Dashboard' }).click()
  for (const ms of [100, 500, 2000]) {
    await page.waitForTimeout(ms)
    const s = await readSurface(page)
    assertNoStack(`cmdk +${ms}ms`, s)
  }
  await page.waitForTimeout(8000)
  const final = await readSurface(page)
  assertNoStack('cmdk final', final)
  if (!final.dashboard) throw new Error('cmdk nav failed')
  await page.screenshot({ path: path.join(OUT, '07-command-palette.png'), fullPage: true })
})

await browser.close()

console.log('\n--- Summary ---')
console.log(`Scenarios: ${scenarios.length}, passed: ${scenarios.filter((s) => s.ok).length}, failed: ${failures.length}`)
if (failures.length) {
  console.error('\nFailures:')
  for (const f of failures) console.error(`  - ${f.name}: ${f.msg}`)
  process.exit(1)
}
console.log(`Screenshots: ${OUT}`)
process.exit(0)
