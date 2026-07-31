#!/usr/bin/env node
/**
 * Harness de capture — mission AIGENT-VISUAL-STACK-001.
 *
 * CE SCRIPT NE PROUVE QUE CE QU'IL MESURE. Il ouvre un navigateur ISOLÉ (jamais
 * le profil quotidien), parcourt les surfaces réelles servies par le dev server,
 * et écrit deux choses : les captures, et un manifeste des faits observés.
 *
 * LA CONSOLE EST MESURÉE, PAS AFFIRMÉE. Chaque message console est collecté avec
 * sa surface d'origine. Le manifeste rapporte les compteurs RÉELS — y compris
 * non nuls. Un zéro écrit sans mesure serait un mensonge ; ici le zéro, s'il
 * apparaît, vient du navigateur.
 *
 * AUCUN ÉLÉMENT PRODUIT N'EST MASQUÉ. Le seul retrait est l'overlay de
 * développement de Next (`nextjs-portal`), absent en production : il flotte
 * au-dessus de la page et masquerait le produit. Justifié, et déclaré dans le
 * manifeste.
 *
 * Usage : node scripts/capture-visual-stack.mjs [baseUrl]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Playwright n'est PAS une dépendance de ce dépôt et cette mission n'en ajoute
 * pas : un harnais de capture ne doit pas alourdir le graphe d'installation du
 * produit. On le résout donc depuis l'environnement, et on ÉCHOUE clairement
 * s'il est absent — jamais de capture silencieusement sautée.
 */
const { chromium } = await import('playwright').catch(() => {
  console.error(
    'playwright introuvable. Ce harnais est un outil de mission, pas une dépendance du produit.\n' +
      'Installer ponctuellement : npm i -D playwright && npx playwright install chromium',
  )
  process.exit(2)
})

const BASE = process.argv[2] ?? 'http://127.0.0.1:3988'
const OUT = join(process.cwd(), 'docs/visual-reviews/AIGENT-VISUAL-STACK-001')

const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'laptop', width: 1280, height: 800 },
  { id: 'mobile', width: 375, height: 812 },
]

/** Les parcours capturés. Chacun nomme la surface RÉELLE qu'il ouvre. */
const SHOTS = [
  { id: 'canvas', path: '/runtime?tab=langgraph', viewports: ['desktop', 'laptop', 'mobile'] },
  { id: 'visual-tooling', path: '/runtime?tab=visual-tooling', viewports: ['desktop', 'mobile'] },
]

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** Retire l'overlay de dev Next — absent en prod, il masquerait le produit. */
async function hideDevOverlay(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  /** Tous les messages console, avec la surface où ils sont apparus. */
  const console_ = []
  let currentSurface = 'boot'
  page.on('console', (msg) => {
    console_.push({ surface: currentSurface, type: msg.type(), text: msg.text().slice(0, 300) })
  })
  page.on('pageerror', (err) => {
    console_.push({ surface: currentSurface, type: 'pageerror', text: String(err).slice(0, 300) })
  })

  const captures = []
  const surfaces = []

  for (const shot of SHOTS) {
    for (const vpId of shot.viewports) {
      const vp = VIEWPORTS.find((v) => v.id === vpId)
      currentSurface = `${shot.id}@${vp.id}`
      await page.setViewportSize({ width: vp.width, height: vp.height })

      const res = await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 })
      await hideDevOverlay(page)
      // Le Canvas mesure le DOM avant de placer ses nœuds : on attend qu'il
      // ait réellement peint plutôt que de capturer une boîte vide.
      await page.waitForTimeout(1200)

      // Overflow horizontal GLOBAL — la mesure, pas l'affirmation.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      const nodeCount = await page.locator('.react-flow__node').count()

      const file = `${shot.id}-${vp.id}-${vp.width}x${vp.height}.png`
      await page.screenshot({ path: join(OUT, file), fullPage: false })

      captures.push({
        file,
        surface: shot.id,
        route: shot.path,
        viewport: `${vp.width}x${vp.height}`,
        httpStatus: res?.status() ?? null,
        canvasNodesRendered: nodeCount,
        horizontalOverflow: overflow,
      })
      surfaces.push(currentSurface)
    }
  }

  /* ── Sélection d'un nœud + inspecteur : le parcours interactif ── */
  currentSurface = 'canvas-selection@desktop'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/runtime?tab=langgraph`, { waitUntil: 'networkidle', timeout: 60_000 })
  await hideDevOverlay(page)
  await page.waitForTimeout(1200)

  let selection = { attempted: false, nodeClicked: null, inspectorOpened: false }
  const nodes = page.locator('.react-flow__node')
  if ((await nodes.count()) > 0) {
    selection.attempted = true
    const target = nodes.first()
    selection.nodeClicked = (await target.innerText().catch(() => ''))?.split('\n')[0] ?? null
    await target.click()
    await page.waitForTimeout(600)
    selection.inspectorOpened = (await page.locator('[data-testid="node-inspector"]').count()) > 0
    await page.screenshot({ path: join(OUT, 'canvas-node-selected-inspector-1440x900.png') })
    captures.push({
      file: 'canvas-node-selected-inspector-1440x900.png',
      surface: 'canvas-selection',
      route: '/runtime?tab=langgraph',
      viewport: '1440x900',
      httpStatus: 200,
      canvasNodesRendered: await nodes.count(),
      horizontalOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    })
  }

  await context.close()
  await browser.close()

  const errors = console_.filter((m) => m.type === 'error' || m.type === 'pageerror')
  const warnings = console_.filter((m) => m.type === 'warning')

  const manifest = {
    mission: 'AIGENT-VISUAL-STACK-001',
    generatedAt: new Date().toISOString(),
    git: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', 'HEAD']),
      // Un arbre sale au moment de la capture rendrait les images non
      // rattachables au commit : le fait est écrit, pas dissimulé.
      dirty: git(['status', '--porcelain']).length > 0,
    },
    environment: {
      baseUrl: BASE,
      nodeVersion: process.version,
      mode: 'next dev (Turbopack)',
      devOverlayHidden: 'nextjs-portal — overlay de développement, absent en production',
    },
    surfaces,
    captures,
    selection,
    console: {
      errors: errors.length,
      warnings: warnings.length,
      // Les messages sont listés en clair : un compteur seul ne se vérifie pas.
      messages: console_.map((m) => ({ surface: m.surface, type: m.type, text: m.text })),
    },
  }

  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`captures: ${captures.length}`)
  console.log(`console errors: ${errors.length} · warnings: ${warnings.length}`)
  console.log(`selection: ${JSON.stringify(selection)}`)
  console.log(`overflow horizontal: ${captures.filter((c) => c.horizontalOverflow).length} capture(s)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
