#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
})

const BASE = process.argv[2] ?? 'http://127.0.0.1:3987'
const ROUTE = '/lab'
const OUT = join(process.cwd(), '.tmp/visual-reviews/AIGENT-GOVERNANCE-015')
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900, file: 'desktop-1440x900.png' },
  { key: 'laptop', width: 1280, height: 800, file: 'laptop-1280x800.png' },
  { key: 'mobile', width: 375, height: 812, file: 'mobile-375x812.png' },
]

const consoleErrors = []
const networkErrors = []
const captures = []

const IGNORED = [/^Download the React DevTools/i, /^\[Fast Refresh\]/i, /webpack-hmr/i]
const ignore = (text) => IGNORED.some((re) => re.test(text))

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-extensions', '--no-first-run', '--hide-scrollbars'],
})

try {
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const page = await context.newPage()

  page.on('console', (msg) => {
    const text = msg.text()
    if (ignore(text)) return
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push({ type: msg.type(), text, route: ROUTE })
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push({ type: 'pageerror', text: String(error), route: ROUTE })
  })
  page.on('requestfailed', (request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      failureText: request.failure()?.errorText ?? 'unknown',
      route: ROUTE,
    })
  })

  const password = process.env.AMC_ADMIN_PASSWORD
  if (password) {
    await page.request.post(`${BASE}/api/auth/login`, { data: { password } })
  }

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const response = await page.goto(`${BASE}${ROUTE}`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    })
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, vp.file), fullPage: false })
    captures.push({
      viewport: `${vp.width}x${vp.height}`,
      file: vp.file,
      status: response?.status() ?? null,
      route: ROUTE,
    })
  }

  await context.close()
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'console-errors.json'), `${JSON.stringify(consoleErrors, null, 2)}\n`)
writeFileSync(join(OUT, 'network-errors.json'), `${JSON.stringify(networkErrors, null, 2)}\n`)

const manifest = {
  mission: 'AIGENT-GOVERNANCE-015',
  route: ROUTE,
  baseUrl: BASE,
  git: {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sha: git(['rev-parse', 'HEAD']),
  },
  captures,
  consoleErrors: consoleErrors.length,
  networkErrors: networkErrors.length,
  verdict: consoleErrors.length === 0 ? 'PASS' : 'FAIL',
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

if (consoleErrors.length > 0) {
  console.error('Composer proof failed: console errors detected.')
  process.exit(1)
}

console.log(`captures: ${captures.length}`)
console.log(`console errors: ${consoleErrors.length}`)
console.log(`network errors: ${networkErrors.length}`)
