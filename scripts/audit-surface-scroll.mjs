#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable — installez-le puis relancez.')
  process.exit(2)
})

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [k, v] = raw.split('=')
  if (!k.startsWith('--')) continue
  args.set(k.slice(2), v ?? 'true')
}

const BASE_URL = args.get('base') ?? 'http://127.0.0.1:3987'
const OUT_DIR =
  args.get('out') ??
  join(process.cwd(), 'docs/visual-reviews/AIGENT-SURFACE-RESET-017/before')
const PHASE = args.get('phase') ?? 'before'
const MODE = args.get('mode') ?? 'development'
const CAPTURE_SENTINELS = (args.get('captureSentinels') ?? 'true') !== 'false'

mkdirSync(OUT_DIR, { recursive: true })

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'laptop', width: 1280, height: 800 },
  { key: 'mobile', width: 375, height: 812 },
]

const ROUTES = [
  '/',
  '/runs',
  '/agents',
  '/agents/[copilotId]',
  '/projects',
  '/builder',
  '/qualification',
  '/delivery',
  '/runtime',
  '/learning',
  '/actions',
  '/settings',
]

const SENTINELS = [
  { key: 'short', route: '/settings' },
  { key: 'long', route: '/agents/[copilotId]' },
  { key: 'table', route: '/runs' },
  { key: 'bounded', route: '/runtime' },
]

const IGNORE_CONSOLE = [/^Download the React DevTools/i, /^\[Fast Refresh\]/i, /webpack-hmr/i]
const IGNORE_SELECTOR = /nextjs-portal|css-studio-panel/i
const CLASS_MAX = 120
const EPS = 1

const git = (params) => execFileSync('git', params, { encoding: 'utf8' }).trim()

async function gotoStable(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(400)
  return response
}

function trunc(value) {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= CLASS_MAX) return text
  return `${text.slice(0, CLASS_MAX)}...`
}

function detectPotentialCutContent(nodes) {
  return nodes.some(
    (n) =>
      n.overflowY === 'hidden' &&
      n.scrollHeight > n.clientHeight + 40 &&
      n.tag !== 'html' &&
      n.tag !== 'body' &&
      !IGNORE_SELECTOR.test(`${n.id} ${n.className}`),
  )
}

function detectResidualScroll(metrics) {
  const residuals = metrics.scrollables.filter((n) => {
    const delta = n.scrollHeight - n.clientHeight
    return delta >= 1 && delta <= 40
  })
  return {
    exists: residuals.length > 0,
    matches: residuals.map((n) => ({ target: n.target, delta: n.scrollHeight - n.clientHeight })),
  }
}

function detectLargeArtificialGap(documentMetrics) {
  const gap = documentMetrics.scrollHeight - documentMetrics.clientHeight
  return { exists: gap > 300, pixels: gap }
}

function describeNode(node) {
  return `${node.tag}${node.id ? `#${node.id}` : ''}${node.className ? `.${node.className.replace(/\s+/g, '.')}` : ''}`
}

function toViewLabel(vp) {
  return `${vp.width}x${vp.height}`
}

function toSnapshotFileName(route, vp, mode) {
  const slug = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-/, '')
  return `${slug}-${toViewLabel(vp)}-${mode}.png`
}

function summarizeRouteViewport(route, viewport, diagnostics) {
  const documentScroll = diagnostics.document.scrollHeight > diagnostics.document.clientHeight + EPS
  return {
    route,
    viewport,
    documentScroll,
    scrollPrincipal: diagnostics.scrollOwner.target,
    secondaryScrolls: diagnostics.secondaryScrolls.map((n) => n.target),
    contentCut: diagnostics.contentCut.exists,
    artificialGap: diagnostics.artificialGap.exists ? diagnostics.artificialGap.pixels : 0,
    verdict: diagnostics.verdict,
  }
}

async function resolveDynamicAgentId(page) {
  await gotoStable(page, `${BASE_URL}/agents`)
  await page.waitForTimeout(300)
  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((el) => el.getAttribute('href'))
      .filter((v) => typeof v === 'string')
    return links.find((entry) => /^\/agents\/[^/?#]+$/.test(entry ?? '')) ?? null
  })
  if (!href) return null
  const match = href.match(/^\/agents\/([^/?#]+)$/)
  return match?.[1] ?? null
}

function materializeRoute(route, agentId) {
  if (route !== '/agents/[copilotId]') return route
  if (!agentId) return null
  return `/agents/${agentId}`
}

async function gatherMetrics(page) {
  return page.evaluate(() => {
    const toClassText = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
    const elements = Array.from(document.querySelectorAll('*'))
    const nodes = []

    for (const el of elements) {
      const style = window.getComputedStyle(el)
      const overflowY = style.overflowY
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'hidden') continue
      const id = el.id || ''
      const className = toClassText(el.className)
      nodes.push({
        tag: el.tagName.toLowerCase(),
        id,
        className,
        dataRole:
          el.getAttribute('data-page-body') !== null
            ? 'page-body'
            : el.getAttribute('data-app-shell') !== null
              ? 'app-shell'
              : el.getAttribute('data-sidebar-desktop-shell') !== null
                ? 'sidebar-desktop'
                : el.getAttribute('data-sidebar-mobile-shell') !== null
                  ? 'sidebar-mobile'
                  : '',
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY,
        position: style.position,
        target: `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}${className ? `.${className.split(' ').join('.')}` : ''}`,
      })
    }

    return {
      document: {
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
      },
      body: {
        clientHeight: document.body.clientHeight,
        scrollHeight: document.body.scrollHeight,
      },
      nodes,
    }
  })
}

function computeDiagnostics(route, viewport, rawMetrics) {
  const overflowNodes = rawMetrics.nodes
    .map((n) => ({
      ...n,
      className: trunc(n.className),
      target: trunc(n.target),
      label: n.dataRole ? `${n.target} [${n.dataRole}]` : n.target,
    }))
    .filter((n) => !IGNORE_SELECTOR.test(`${n.id} ${n.className}`))
  const verticalScrollable = overflowNodes.filter(
    (n) => (n.overflowY === 'auto' || n.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + EPS,
  )
  const hiddenOverflow = overflowNodes.filter(
    (n) =>
      n.overflowY === 'hidden' &&
      n.scrollHeight > n.clientHeight + 40 &&
      n.tag !== 'html' &&
      n.tag !== 'body',
  )
  const documentCanScroll = rawMetrics.document.scrollHeight > rawMetrics.document.clientHeight + EPS

  const syntheticDocumentOwner = {
    tag: 'document',
    id: '',
    className: 'documentElement',
    clientHeight: rawMetrics.document.clientHeight,
    scrollHeight: rawMetrics.document.scrollHeight,
    overflowY: documentCanScroll ? 'auto' : 'hidden',
    position: 'static',
    target: 'document',
    label: 'document',
  }

  const contenders = documentCanScroll
    ? [syntheticDocumentOwner, ...verticalScrollable]
    : [...verticalScrollable]
  const primary = contenders
    .slice()
    .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0] ?? {
    ...syntheticDocumentOwner,
    overflowY: 'hidden',
    scrollHeight: rawMetrics.document.clientHeight,
    target: 'none',
    label: 'none',
  }
  const secondary = contenders.filter((node) => node.target !== primary.target)

  const contentCut = {
    exists: hiddenOverflow.length > 0 || detectPotentialCutContent(overflowNodes),
    sources: hiddenOverflow.map((n) => n.label),
  }
  const residual = detectResidualScroll({
    scrollables: [...verticalScrollable, documentCanScroll ? syntheticDocumentOwner : null].filter(Boolean),
  })
  const artificialGap = detectLargeArtificialGap(rawMetrics.document)

  const scrollbarsVerticalCount = contenders.length
  const shellScroll = primary.dataRole === 'app-shell'
  const pageBodyScroll = primary.dataRole === 'page-body'
  const internalSectionScroll = !/^(document|none)$/.test(primary.target) && !shellScroll && !pageBodyScroll

  let verdict = 'OK'
  if (scrollbarsVerticalCount > 1) verdict = 'MULTI_SCROLL'
  if (contentCut.exists) verdict = verdict === 'OK' ? 'CONTENT_CUT' : `${verdict}+CONTENT_CUT`
  if (artificialGap.exists) verdict = verdict === 'OK' ? 'ARTIFICIAL_GAP' : `${verdict}+ARTIFICIAL_GAP`

  return {
    route,
    viewport,
    document: rawMetrics.document,
    body: rawMetrics.body,
    overflowNodes,
    scrollOwner: { ...primary, target: primary.label },
    secondaryScrolls: secondary.map((entry) => ({ ...entry, target: entry.label })),
    scrollbarsVerticalCount,
    documentScrolls: documentCanScroll,
    shellScrolls: shellScroll,
    pageBodyScrolls: pageBodyScroll,
    internalSectionScrolls: internalSectionScroll,
    contentCut,
    residualScroll: residual,
    artificialGap,
    verdict,
  }
}

function renderMarkdown(matrix) {
  const rows = matrix.routeViewportSummary
    .map(
      (entry) =>
        `| ${entry.route} | ${entry.viewport} | ${entry.documentScroll ? 'oui' : 'non'} | ${
          entry.scrollPrincipal
        } | ${entry.secondaryScrolls.length > 0 ? entry.secondaryScrolls.join('<br/>') : 'aucun'} | ${
          entry.contentCut ? 'oui' : 'non'
        } | ${entry.artificialGap > 0 ? `${entry.artificialGap}px` : 'non'} | ${entry.verdict} |`,
    )
    .join('\n')

  return [
    `# AIGENT-SURFACE-RESET-017 — ${PHASE} scroll matrix`,
    '',
    `- base URL: \`${BASE_URL}\``,
    `- mode: \`${MODE}\``,
    `- branch: \`${matrix.git.branch}\``,
    `- sha: \`${matrix.git.sha}\``,
    `- generatedAtUtc: \`${matrix.generatedAtUtc}\``,
    '',
    '| route | viewport | document scroll | scroll principal | scrolls secondaires | contenu coupé | vide artificiel | verdict |',
    '|---|---:|---|---|---|---|---|---|',
    rows,
    '',
  ].join('\n')
}

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-extensions', '--no-first-run', '--hide-scrollbars'],
})

const consoleEvents = []
const networkErrors = []

try {
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const page = await context.newPage()

  page.on('console', (msg) => {
    const text = msg.text()
    if (IGNORE_CONSOLE.some((rule) => rule.test(text))) return
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleEvents.push({ type: msg.type(), text })
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
    await page.request.post(`${BASE_URL}/api/auth/login`, { data: { password } })
  }

  const dynamicAgentId = await resolveDynamicAgentId(page)
  const routeRealizations = ROUTES.map((route) => ({
    template: route,
    route: materializeRoute(route, dynamicAgentId),
  }))
  const unresolved = routeRealizations.filter((item) => !item.route).map((item) => item.template)
  if (unresolved.length > 0) {
    console.error(`routes dynamiques non résolues: ${unresolved.join(', ')}`)
    process.exit(3)
  }

  const routeMeasurements = []
  const routeViewportSummary = []
  const captures = []

  for (const vp of VIEWPORTS) {
    for (const routeItem of routeRealizations) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const response = await gotoStable(page, `${BASE_URL}${routeItem.route}`)
      await page.waitForTimeout(800)
      await page
        .addStyleTag({
          content:
            'nextjs-portal{display:none!important}css-studio-panel{display:none!important}[data-nextjs-toast]{display:none!important}',
        })
        .catch(() => {})

      const raw = await gatherMetrics(page)
      const diagnostics = computeDiagnostics(routeItem.route, toViewLabel(vp), raw)
      routeMeasurements.push({
        templateRoute: routeItem.template,
        route: routeItem.route,
        viewport: toViewLabel(vp),
        responseStatus: response?.status() ?? null,
        ...diagnostics,
      })
      routeViewportSummary.push(summarizeRouteViewport(routeItem.route, toViewLabel(vp), diagnostics))
    }
  }

  if (CAPTURE_SENTINELS) {
    for (const vp of VIEWPORTS) {
      for (const sentinel of SENTINELS) {
        const route = materializeRoute(sentinel.route, dynamicAgentId)
        if (!route) continue
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await gotoStable(page, `${BASE_URL}${route}`)
        await page.waitForTimeout(700)
        const file = toSnapshotFileName(`${sentinel.key}-${route}`, vp, MODE)
        await page.screenshot({ path: join(OUT_DIR, file), fullPage: false })
        const m = await gatherMetrics(page)
        const d = computeDiagnostics(route, toViewLabel(vp), m)
        captures.push({
          file,
          category: sentinel.key,
          route,
          viewport: toViewLabel(vp),
          mode: MODE,
          documentScrollHeight: m.document.scrollHeight,
          documentClientHeight: m.document.clientHeight,
          scrollOwner: d.scrollOwner.target,
          verticalScrollableCount: d.scrollbarsVerticalCount,
          consoleErrors: consoleEvents.filter((c) => c.type === 'error' || c.type === 'pageerror').length,
        })
      }
    }

    const mobileVp = VIEWPORTS.find((entry) => entry.width === 375 && entry.height === 812)
    if (mobileVp) {
      await page.setViewportSize({ width: mobileVp.width, height: mobileVp.height })
      await gotoStable(page, `${BASE_URL}/settings`)
      await page.click('button[aria-label="Ouvrir la navigation"]', { timeout: 10_000 })
      await page.waitForTimeout(500)
      const file = `mobile-drawer-open-375x812-${MODE}.png`
      await page.screenshot({ path: join(OUT_DIR, file), fullPage: false })
      const m = await gatherMetrics(page)
      const d = computeDiagnostics('/settings', toViewLabel(mobileVp), m)
      captures.push({
        file,
        category: 'drawer-open',
        route: '/settings',
        viewport: toViewLabel(mobileVp),
        mode: MODE,
        documentScrollHeight: m.document.scrollHeight,
        documentClientHeight: m.document.clientHeight,
        scrollOwner: d.scrollOwner.target,
        verticalScrollableCount: d.scrollbarsVerticalCount,
        consoleErrors: consoleEvents.filter((c) => c.type === 'error' || c.type === 'pageerror').length,
      })
    }
  }

  await context.close()

  const payload = {
    mission: 'AIGENT-SURFACE-RESET-017',
    phase: PHASE,
    mode: MODE,
    baseUrl: BASE_URL,
    generatedAtUtc: new Date().toISOString(),
    git: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', 'HEAD']),
    },
    dynamicIds: { copilotId: dynamicAgentId },
    viewports: VIEWPORTS,
    routes: routeRealizations,
    consoleEvents,
    networkErrors,
    routeViewportSummary,
    routeMeasurements,
    captures,
  }

  const jsonPath = join(OUT_DIR, 'scroll-matrix.json')
  const mdPath = join(OUT_DIR, 'scroll-matrix.md')
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(mdPath, `${renderMarkdown(payload)}\n`)

  console.log(`audit écrit: ${jsonPath}`)
  console.log(`tableau écrit: ${mdPath}`)
  console.log(`mesures: ${routeMeasurements.length}`)
  console.log(`captures: ${captures.length}`)
  console.log(`console events: ${consoleEvents.length}`)
  console.log(`network errors: ${networkErrors.length}`)
} finally {
  await browser.close()
}
