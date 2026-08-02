#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable: npm i -D playwright')
  process.exit(2)
})

const ROOT = process.cwd()
const OUT = join(ROOT, 'docs/visual-reviews/aigent-design-system-factory-006')
const BASE = 'http://127.0.0.1:3987'
const AGENT_DETAIL_ROUTE = '/agents/copilot-gold-trading-high-risk-copilot-draft-57917f07-bd916fd8'
const BEFORE_DIR = join(ROOT, 'docs/visual-reviews/aigent-visual-composition-004-r4')
const BEFORE_REFERENCE = [
  { route: '/', file: 'overview-desktop-1440x900.png' },
  { route: '/runs', file: 'runs-desktop-1440x900.png' },
  { route: '/runtime?tab=telemetry', file: 'runtime-telemetry-desktop-1440x900.png' },
  { route: '/agents', file: 'agents-desktop-1440x900.png' },
]

const ROUTES = [
  { slug: 'overview', route: '/' },
  { slug: 'runs', route: '/runs' },
  { slug: 'runtime-telemetry', route: '/runtime?tab=telemetry' },
  { slug: 'agents', route: '/agents' },
  { slug: 'agent-detail', route: AGENT_DETAIL_ROUTE },
  { slug: 'learning', route: '/learning' },
  { slug: 'delivery', route: '/delivery' },
  { slug: 'qualification', route: '/qualification' },
]

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1280, height: 600 },
  { width: 375, height: 812 },
]

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const currentSha = git('rev-parse', 'HEAD')
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const status = git('status', '--short')

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
})
const browserVersion = browser.version()
const context = await browser.newContext()
const page = await context.newPage()

const consoleEvents = []
page.on('console', (msg) => {
  const type = msg.type()
  if (type !== 'error' && type !== 'warning') return
  consoleEvents.push({
    route: page.url(),
    type,
    text: msg.text().slice(0, 500),
  })
})
page.on('pageerror', (err) => {
  consoleEvents.push({
    route: page.url(),
    type: 'pageerror',
    text: String(err).slice(0, 500),
  })
})

await page.addStyleTag({
  content: [
    'nextjs-portal{display:none!important}',
    'css-studio-panel{display:none!important}',
    '[data-testid=\"issues-badge\"], [data-testid=\"cursor-overlay\"], [data-testid=\"agent-overlay\"]{display:none!important}',
  ].join(''),
}).catch(() => {})

const captures = []
for (const routeDef of ROUTES) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp)
    const beforeCount = consoleEvents.length
    const res = await page.goto(`${BASE}${routeDef.route}`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    await page.waitForTimeout(900)
    const file = `${routeDef.slug}-${vp.width}x${vp.height}.png`
    await page.screenshot({ path: join(OUT, file), fullPage: false })
    const afterEvents = consoleEvents.slice(beforeCount)
    const routeErrors = afterEvents.filter((e) => e.type === 'error' || e.type === 'pageerror')
    captures.push({
      route: routeDef.route,
      file,
      viewport: vp,
      status: res?.status() ?? null,
      consoleErrors: routeErrors.length,
      dataState: 'live-backend-or-fail-closed',
    })
  }
}

for (const ref of BEFORE_REFERENCE) {
  const src = join(BEFORE_DIR, ref.file)
  if (!existsSync(src)) continue
  const dst = join(OUT, `before-${ref.file}`)
  copyFileSync(src, dst)
}

const allPngs = readdirSync(OUT).filter((f) => f.endsWith('.png')).toSorted()
let html = '<!doctype html><html><head><meta charset="utf-8"><title>AIGENT-DS-FACTORY-006</title><style>body{margin:0;background:#101014;color:#ddd;font:12px/1.4 system-ui;padding:16px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.card{background:#17171d;border:1px solid #2b2b34;border-radius:8px;padding:8px}.card img{width:100%;height:auto;border-radius:6px;display:block}.name{margin:6px 0 0;word-break:break-word}</style></head><body><h1>Mission AIGENT-DESIGN-SYSTEM-FACTORY-006</h1><div class="grid">'
for (const file of allPngs) {
  html += `<div class="card"><img src="./${file}" alt="${file}"><p class="name">${file}</p></div>`
}
html += '</div></body></html>'
writeFileSync(join(OUT, 'contact-sheet.html'), html)

await page.goto(pathToFileURL(join(OUT, 'contact-sheet.html')).href, { waitUntil: 'networkidle' })
await page.setViewportSize({ width: 1720, height: 2200 })
await page.screenshot({ path: join(OUT, 'contact-sheet.png'), fullPage: true })

const inspectedFiles = []
for (const file of allPngs) {
  await page.goto(pathToFileURL(join(OUT, file)).href, { waitUntil: 'load' })
  inspectedFiles.push(file)
}
await page.goto(pathToFileURL(join(OUT, 'contact-sheet.png')).href, { waitUntil: 'load' })

await context.close()
await browser.close()

const manifest = {
  mission: 'AIGENT-DESIGN-SYSTEM-FACTORY-006',
  generatedAt: new Date().toISOString(),
  captureCommitSha: currentSha,
  captureCommitShort: currentSha.slice(0, 7),
  branch,
  server: { baseUrl: BASE, port: 3987, mode: 'production-preview' },
  worktree: {
    path: ROOT,
    statusAtCaptureStart: status,
  },
  browser: {
    name: 'chromium',
    version: browserVersion,
    headless: true,
  },
  captures,
  console: {
    totalErrors: consoleEvents.filter((e) => e.type === 'error' || e.type === 'pageerror').length,
    totalWarnings: consoleEvents.filter((e) => e.type === 'warning').length,
    events: consoleEvents,
  },
  openedImages: inspectedFiles,
  openedContactSheet: true,
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(
  join(OUT, 'console-errors.json'),
  JSON.stringify(
    {
      totalErrors: manifest.console.totalErrors,
      totalWarnings: manifest.console.totalWarnings,
      events: manifest.console.events,
    },
    null,
    2,
  ) + '\n',
)

console.log(`captures: ${captures.length}`)
console.log(`console errors: ${manifest.console.totalErrors}`)
console.log(`output: ${resolve(OUT)}`)
