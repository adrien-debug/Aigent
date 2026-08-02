#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable')
  process.exit(2)
})

const args = new Map()
for (const arg of process.argv.slice(2)) {
  const [k, v] = arg.split('=')
  if (k.startsWith('--')) args.set(k.slice(2), v ?? 'true')
}

const PHASE = args.get('phase') ?? 'before'
const BASE = args.get('base') ?? 'http://127.0.0.1:3987'
const MODE = args.get('mode') ?? 'development'
const OUT = args.get('out') ?? `docs/visual-reviews/AIGENT-DESIGN-POLISH-002/phase3/${PHASE}`

const outDir = join(process.cwd(), OUT)
mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]

const RUNTIME_TABS = ['langgraph', 'repositories', 'providers', 'tools', 'models']
const ROOT_TARGETS = ['/', '/projects', '/agents/[id]']

const git = (...params) => execFileSync('git', params, { encoding: 'utf8' }).trim()

function vpLabel(vp) {
  return `${vp.width}x${vp.height}`
}

function targetSlug(pathname) {
  if (pathname === '/') return 'home'
  return pathname.replaceAll('/', '-').replace(/^-/, '')
}

async function gotoStable(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(400)
}

async function resolveAgentId(page) {
  await gotoStable(page, `${BASE}/agents`)
  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((node) => node.getAttribute('href'))
      .filter((entry) => typeof entry === 'string')
    return links.find((entry) => /^\/agents\/[^/?#]+$/.test(entry ?? '')) ?? null
  })
  if (!href) return null
  const match = href.match(/^\/agents\/([^/?#]+)$/)
  return match?.[1] ?? null
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const rolePatterns = ['aig-stage', 'aig-panel', 'aig-inset', 'aig-raised']
    const elements = Array.from(document.querySelectorAll('*'))
    const roleNodes = elements.filter((el) => {
      const cls = el.className
      if (typeof cls !== 'string') return false
      return rolePatterns.some((token) => cls.includes(token))
    })
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }
    const visibleRoleNodes = roleNodes.filter(isVisible)

    const depthOf = (el) => {
      let depth = 0
      let node = el.parentElement
      while (node) {
        const cls = typeof node.className === 'string' ? node.className : ''
        if (rolePatterns.some((token) => cls.includes(token))) depth += 1
        node = node.parentElement
      }
      return depth + 1
    }

    const maxDepth = visibleRoleNodes.reduce((max, el) => Math.max(max, depthOf(el)), 0)
    const panelCount = visibleRoleNodes.filter((el) => String(el.className).includes('aig-panel')).length

    const badgeNodes = elements.filter((el) => {
      if (el.tagName.toLowerCase() !== 'span') return false
      const cls = el.className
      if (typeof cls !== 'string') return false
      return cls.includes('rounded-md') && cls.includes('text-sm/5')
    })
    const visibleBadgeCount = badgeNodes.filter(isVisible).length

    return {
      document: {
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      depth: {
        max: maxDepth,
        visibleSurfaces: visibleRoleNodes.length,
        visiblePanels: panelCount,
      },
      badges: {
        visible: visibleBadgeCount,
      },
      consoleErrorsOnPage: 0,
    }
  })
}

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-extensions', '--no-first-run', '--hide-scrollbars'],
})

const captures = []
const consoleEvents = []
const networkErrors = []

try {
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleEvents.push({ type: msg.type(), text: msg.text() })
    }
  })
  page.on('pageerror', (error) => {
    consoleEvents.push({ type: 'pageerror', text: String(error) })
  })
  page.on('requestfailed', (request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      failureText: request.failure()?.errorText ?? 'unknown',
    })
  })

  const password = process.env.AMC_ADMIN_PASSWORD
  if (password) {
    await page.request.post(`${BASE}/api/auth/login`, { data: { password } }).catch(() => {})
  }

  const agentId = await resolveAgentId(page)
  if (!agentId) {
    console.error('agent id introuvable pour /agents/[id]')
    process.exit(3)
  }

  const targets = [
    ...RUNTIME_TABS.map((tab) => ({ key: `runtime-${tab}`, path: `/runtime?tab=${tab}` })),
    ...ROOT_TARGETS.map((path) => ({
      key: targetSlug(path),
      path: path === '/agents/[id]' ? `/agents/${agentId}` : path,
      template: path,
    })),
  ]

  for (const vp of VIEWPORTS) {
    for (const target of targets) {
      await page.setViewportSize(vp)
      await gotoStable(page, `${BASE}${target.path}`)
      await page
        .addStyleTag({
          content:
            'nextjs-portal{display:none!important}css-studio-panel{display:none!important}[data-nextjs-toast]{display:none!important}',
        })
        .catch(() => {})
      const metrics = await collectMetrics(page)
      const file = `${target.key}-${vpLabel(vp)}-${MODE}.png`
      await page.screenshot({ path: join(outDir, file), fullPage: false })
      captures.push({
        file,
        key: target.key,
        route: target.path,
        templateRoute: target.template ?? target.path,
        viewport: vpLabel(vp),
        mode: MODE,
        metrics,
      })
    }
  }

  await context.close()

  const payload = {
    mission: 'AIGENT-DESIGN-POLISH-002',
    phase: 'phase3',
    snapshot: PHASE,
    mode: MODE,
    generatedAtUtc: new Date().toISOString(),
    baseUrl: BASE,
    git: {
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      sha: git('rev-parse', 'HEAD'),
    },
    dynamic: { agentId },
    captures,
    consoleEvents,
    networkErrors,
  }

  writeFileSync(join(outDir, 'metrics.json'), `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`captures: ${captures.length}`)
  console.log(`metrics: ${join(outDir, 'metrics.json')}`)
} finally {
  await browser.close()
}
