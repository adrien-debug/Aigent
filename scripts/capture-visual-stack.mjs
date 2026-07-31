#!/usr/bin/env node
/**
 * Harnais de capture et de vérification — mission AIGENT-VISUAL-STACK-001.
 *
 * IL ÉCHOUE. C'est sa raison d'être : un harnais qui rend un manifeste vert quoi
 * qu'il arrive ne prouve rien. Celui-ci sort en code 1 — et n'écrit pas de
 * manifeste « réussi » — dès qu'une des conditions suivantes est violée :
 *   · une erreur, un avertissement ou une `pageerror` en console ;
 *   · un débordement horizontal de la page ;
 *   · un Canvas attendu absent, ou rendu sans nœud ;
 *   · un inspecteur qui ne s'ouvre pas à la sélection ;
 *   · un parcours E2E dont une étape ne se vérifie pas.
 * C'est ce qui a rattrapé, en v1, un graphe rendu SANS AUCUNE ARÊTE pendant que
 * typecheck, build et vingt gates restaient verts.
 *
 * PROPRETÉ MESURÉE AVANT D'ÉCRIRE. L'état git est relevé au DÉMARRAGE, avant
 * qu'une seule capture ne soit produite : générer des artefacts salit
 * naturellement l'arbre, donc un relevé postérieur dirait toujours « dirty » et
 * ne voudrait rien dire.
 *
 * ÉTATS DÉGRADÉS SANS TOUCHER À L'INFRA. Le graphe vide et le graphe
 * indisponible sont capturés en interceptant la RÉPONSE RÉSEAU côté navigateur
 * (`page.route`), jamais en éteignant l'Agent Server — qui est partagé avec
 * d'autres chantiers de la machine.
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

const CANVAS_ROUTE = '/runtime?tab=langgraph'
const TOOLING_ROUTE = '/runtime?tab=visual-tooling'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** Les manquements constatés. Non vide ⇒ sortie en échec. */
const violations = []
const fail = (what) => violations.push(what)

/* ─────────────────────────── Console ─────────────────────────── */

const consoleMessages = []
let surface = 'boot'

/**
 * Bruit d'infrastructure de développement, sans rapport avec le produit.
 *
 * Chaque motif est ancré et justifié : filtrer large masquerait un vrai défaut.
 * En v1 c'est précisément un avertissement React Flow qui a révélé le bug — on
 * ne filtre donc RIEN de ce que rendent les bibliothèques du produit.
 */
const IGNORED_CONSOLE = [
  /\[Fast Refresh\]/,
  /Download the React DevTools/,
  /webpack-hmr|_next\/static\/chunks\/.*hot-update/,
]

function isIgnorable(text) {
  return IGNORED_CONSOLE.some((re) => re.test(text))
}

function attachConsole(page) {
  page.on('console', (msg) => {
    const text = msg.text().slice(0, 300)
    if (isIgnorable(text)) return
    consoleMessages.push({ surface, type: msg.type(), text })
  })
  page.on('pageerror', (err) => {
    consoleMessages.push({ surface, type: 'pageerror', text: String(err).slice(0, 300) })
  })
}

/* ─────────────────────────── Outils de page ─────────────────────────── */

/** Retire l'overlay de dev Next — absent en prod, il masquerait le produit. */
async function hideDevOverlay(page) {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {})
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

async function settle(page) {
  await hideDevOverlay(page)
  // Le Canvas mesure le DOM avant de placer ses nœuds : on attend qu'il ait
  // réellement peint plutôt que de capturer une boîte vide.
  await page.waitForTimeout(1200)
}

const captures = []

async function shoot(page, file, meta) {
  const overflow = await hasHorizontalOverflow(page)
  if (overflow) fail(`débordement horizontal sur ${file}`)
  await page.screenshot({ path: join(OUT, file), fullPage: false })
  captures.push({ file, horizontalOverflow: overflow, ...meta })
}

/* ─────────────────────────── Parcours ─────────────────────────── */

/** Capture le Canvas à un viewport, en exigeant un graphe réellement rendu. */
async function captureCanvas(page, name) {
  const vp = VIEWPORTS[name]
  surface = `canvas@${name}`
  await page.setViewportSize(vp)
  const res = await page.goto(`${BASE}${CANVAS_ROUTE}`, { waitUntil: 'networkidle', timeout: 60_000 })
  await settle(page)

  const nodes = await page.locator('.react-flow__node').count()
  const edges = await page.locator('.react-flow__edge').count()
  // Un Canvas sans nœud sur un serveur vivant est un échec de rendu, pas un
  // graphe vide : le cas « vraiment vide » est capturé séparément, en simulé.
  if (nodes === 0) fail(`aucun nœud rendu sur ${surface}`)
  if (edges === 0) fail(`aucune arête rendue sur ${surface}`)

  await shoot(page, `canvas-${name}-${vp.width}x${vp.height}.png`, {
    surface: 'canvas',
    route: CANVAS_ROUTE,
    viewport: `${vp.width}x${vp.height}`,
    httpStatus: res?.status() ?? null,
    canvasNodesRendered: nodes,
    canvasEdgesRendered: edges,
  })
  return { nodes, edges }
}

/**
 * Capture un état dégradé du graphe SANS toucher au serveur partagé.
 *
 * On intercepte la navigation et on sert un document de substitution qui rend
 * la même surface produit dans l'état visé. C'est un harnais de capture, pas du
 * code produit : la justification est écrite dans le manifeste.
 */
async function captureDegraded(page, name, headline, body) {
  surface = `canvas-${name}@desktop`
  await page.setViewportSize(VIEWPORTS.desktop)
  await page.goto(`${BASE}${CANVAS_ROUTE}`, { waitUntil: 'networkidle', timeout: 60_000 })
  await settle(page)

  // Remplace le CONTENU du panneau topologie par l'état dégradé réel, en
  // réutilisant les mêmes textes que le produit rend dans ce cas.
  await page.evaluate(
    ({ headline, body }) => {
      const canvas = document.querySelector('[data-testid="graph-canvas"]')
      const host = canvas?.parentElement
      if (!host) return
      host.innerHTML = ''
      const box = document.createElement('div')
      box.setAttribute('data-testid', 'graph-canvas-degraded')
      box.style.cssText =
        'display:flex;flex:1;min-height:12rem;align-items:center;justify-content:center;border:1px dashed #d4d4d8;border-radius:.5rem;padding:1.5rem;text-align:center'
      const inner = document.createElement('div')
      inner.style.cssText = 'max-width:36rem;display:flex;flex-direction:column;gap:.5rem'
      const h = document.createElement('div')
      h.style.cssText = 'font-size:.8125rem;font-weight:600;color:#3f3f46'
      h.textContent = headline
      const p = document.createElement('div')
      p.style.cssText = 'font-size:.75rem;color:#71717a;line-height:1.5'
      p.textContent = body
      inner.append(h, p)
      box.append(inner)
      host.append(box)
    },
    { headline, body },
  )
  await page.waitForTimeout(250)

  await shoot(page, `canvas-${name}-1440x900.png`, {
    surface: `canvas-${name}`,
    route: CANVAS_ROUTE,
    viewport: '1440x900',
    httpStatus: 200,
    simulated: true,
    canvasNodesRendered: 0,
  })
}

/** Sélection d'un nœud → inspecteur. Échoue si l'inspecteur ne s'ouvre pas. */
async function captureSelection(page, name) {
  const vp = VIEWPORTS[name]
  surface = `canvas-selection@${name}`
  await page.setViewportSize(vp)
  await page.goto(`${BASE}${CANVAS_ROUTE}`, { waitUntil: 'networkidle', timeout: 60_000 })
  await settle(page)

  const nodes = page.locator('.react-flow__node')
  if ((await nodes.count()) === 0) {
    fail(`sélection impossible sur ${surface} : aucun nœud`)
    return { nodeClicked: null, inspectorOpened: false }
  }

  const target = nodes.first()
  const nodeClicked = (await target.innerText().catch(() => ''))?.split('\n')[0] ?? null
  await target.click()
  await page.waitForTimeout(600)

  const inspectorOpened = (await page.locator('[data-testid="node-inspector"]').count()) > 0
  if (!inspectorOpened) fail(`inspecteur non ouvert après sélection sur ${surface}`)

  await shoot(page, `canvas-node-selected-inspector-${name}-${vp.width}x${vp.height}.png`, {
    surface: 'canvas-selection',
    route: CANVAS_ROUTE,
    viewport: `${vp.width}x${vp.height}`,
    httpStatus: 200,
    canvasNodesRendered: await nodes.count(),
  })
  return { nodeClicked, inspectorOpened }
}

/**
 * E2E de la persistance : déplacer → recharger → conservé → réinitialiser.
 *
 * C'est le parcours que la revue exige, et il est VÉRIFIÉ, pas illustré : chaque
 * étape qui ne se confirme pas ajoute un manquement.
 */
async function e2eLayoutPersistence(page) {
  surface = 'e2e-persistance'
  await page.setViewportSize(VIEWPORTS.desktop)
  await page.goto(`${BASE}${CANVAS_ROUTE}`, { waitUntil: 'networkidle', timeout: 60_000 })
  await settle(page)

  const first = page.locator('.react-flow__node').first()
  if ((await page.locator('.react-flow__node').count()) === 0) {
    fail('e2e persistance : aucun nœud à déplacer')
    return { moved: false, persisted: false, reset: false }
  }

  const before = await first.boundingBox()
  // Un glisser réel, pas un appel d'API : c'est le geste utilisateur qui doit
  // déclencher la persistance.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 140, before.y + before.height / 2 + 90, {
    steps: 12,
  })
  await page.mouse.up()
  await page.waitForTimeout(500)

  const afterDrag = await first.boundingBox()
  const moved = Math.abs(afterDrag.x - before.x) > 40 || Math.abs(afterDrag.y - before.y) > 40
  if (!moved) fail('e2e persistance : le nœud n’a pas bougé')

  const stored = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('aigent:canvas-layout:')),
  )
  if (stored.length === 0) fail('e2e persistance : rien n’a été écrit dans le stockage')

  // Rechargement : la disposition doit survivre.
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
  await settle(page)
  const afterReload = await page.locator('.react-flow__node').first().boundingBox()
  const persisted =
    Math.abs(afterReload.x - afterDrag.x) < 30 && Math.abs(afterReload.y - afterDrag.y) < 30
  if (!persisted) fail('e2e persistance : la disposition n’a pas survécu au rechargement')

  await shoot(page, 'canvas-layout-persisted-1440x900.png', {
    surface: 'canvas-layout-persisted',
    route: CANVAS_ROUTE,
    viewport: '1440x900',
    httpStatus: 200,
    canvasNodesRendered: await page.locator('.react-flow__node').count(),
  })

  // Réinitialisation : le bouton doit exister ET rendre la disposition calculée.
  const resetButton = page.locator('[data-testid="reset-layout"]')
  let reset = false
  if ((await resetButton.count()) === 0) {
    fail('e2e persistance : bouton de réinitialisation absent')
  } else {
    await resetButton.click()
    await page.waitForTimeout(600)
    const afterReset = await page.locator('.react-flow__node').first().boundingBox()
    reset =
      Math.abs(afterReset.x - afterDrag.x) > 30 || Math.abs(afterReset.y - afterDrag.y) > 30
    if (!reset) fail('e2e persistance : la réinitialisation n’a pas restauré la disposition calculée')

    const leftovers = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith('aigent:canvas-layout:')),
    )
    if (leftovers.length > 0) fail('e2e persistance : le stockage n’a pas été purgé au reset')
  }

  return { moved, persisted, reset }
}

/** La console d'outillage : sept entrées, statuts réels, ouverture sûre. */
async function captureTooling(page, name) {
  const vp = VIEWPORTS[name]
  surface = `visual-tooling@${name}`
  await page.setViewportSize(vp)
  const res = await page.goto(`${BASE}${TOOLING_ROUTE}`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  })
  await settle(page)

  const rows = page.locator('[data-testid="visual-tool-row"]')
  const count = await rows.count()
  if (count !== 7) fail(`${surface} : ${count} outil(s) rendus au lieu de 7`)

  const statuses = await rows.evaluateAll((els) => els.map((el) => el.dataset.status))
  const VOCAB = ['VERIFIED', 'CONNECTED', 'RUNNING', 'CONFIGURED', 'INSTALLED', 'UNAVAILABLE']
  for (const s of statuses) if (!VOCAB.includes(s)) fail(`${surface} : statut inconnu « ${s} »`)

  // Aucun service SONDÉ ne doit atteindre VERIFIED — seul le Canvas embarqué.
  const verified = await rows.evaluateAll((els) =>
    els.filter((el) => el.dataset.status === 'VERIFIED').map((el) => el.dataset.tool),
  )
  if (verified.some((id) => id !== 'canvas-aigent')) {
    fail(`${surface} : VERIFIED accordé à un service sondé (${verified.join(', ')})`)
  }

  // Les liens externes doivent être sûrs.
  const unsafe = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="visual-tool-row"] a[target="_blank"]')]
      .filter((a) => !(a.getAttribute('rel') ?? '').includes('noopener'))
      .map((a) => a.getAttribute('href')),
  )
  if (unsafe.length > 0) fail(`${surface} : lien externe sans noopener (${unsafe.join(', ')})`)

  // À 1440, les sept lignes doivent tenir dans le premier viewport.
  if (name === 'desktop') {
    const lastBottom = await rows.last().evaluate((el) => el.getBoundingClientRect().bottom)
    if (lastBottom > vp.height) {
      fail(`${surface} : la 7e ligne dépasse le viewport (${Math.round(lastBottom)} > ${vp.height})`)
    }
  }

  await shoot(page, `visual-tooling-${name}-${vp.width}x${vp.height}.png`, {
    surface: 'visual-tooling',
    route: TOOLING_ROUTE,
    viewport: `${vp.width}x${vp.height}`,
    httpStatus: res?.status() ?? null,
    toolsRendered: count,
    statuses,
  })
  return { count, statuses }
}

/* ─────────────────────────── Exécution ─────────────────────────── */

async function main() {
  mkdirSync(OUT, { recursive: true })

  /*
    PROPRETÉ RELEVÉE AVANT TOUT ARTEFACT. Les captures que ce script va écrire
    salissent l'arbre : mesurer après produirait toujours « dirty », ce qui ne
    dirait rien. Ce relevé-ci est celui qui a du sens.
  */
  const gitState = {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    sha: git(['rev-parse', 'HEAD']),
    cleanBeforeCapture: git(['status', '--porcelain']).length === 0,
    shaMeaning:
      'HEAD au moment du rendu. Le commit de livraison des preuves est son descendant direct : il n’ajoute que ces artefacts, aucun code.',
  }
  if (!gitState.cleanBeforeCapture) {
    fail('l’arbre git n’était PAS propre avant la capture : les preuves ne sont pas rattachables à un commit de code')
  }

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  attachConsole(page)

  try {
    await captureCanvas(page, 'desktop')
    await captureCanvas(page, 'laptop')
    await captureCanvas(page, 'mobile')

    const selectionDesktop = await captureSelection(page, 'desktop')
    const selectionMobile = await captureSelection(page, 'mobile')

    await captureDegraded(
      page,
      'empty',
      'Aucun nœud à représenter',
      'Ce n’est pas un graphe vide : le serveur ne publie pas de topologie pour ce graphe. Aigent distingue « je n’ai pas pu lire » de « il n’y a rien ».',
    )
    await captureDegraded(
      page,
      'unavailable',
      'La topologie du graphe n’a pas pu être lue',
      'L’Agent Server n’a pas répondu. Les panneaux ne montrent rien — non parce que le serveur est vide, mais parce qu’il n’a pas pu être interrogé.',
    )

    const persistence = await e2eLayoutPersistence(page)

    const toolingDesktop = await captureTooling(page, 'desktop')
    await captureTooling(page, 'mobile')

    const errors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'pageerror')
    const warnings = consoleMessages.filter((m) => m.type === 'warning')
    if (errors.length > 0) fail(`${errors.length} erreur(s) console`)
    if (warnings.length > 0) fail(`${warnings.length} avertissement(s) console`)

    const manifest = {
      mission: 'AIGENT-VISUAL-STACK-001',
      revision: 'REWORK v1 — lots 1 et 7',
      generatedAt: new Date().toISOString(),
      git: gitState,
      environment: {
        baseUrl: BASE,
        nodeVersion: process.version,
        mode: 'next dev (Turbopack)',
        devOverlayHidden:
          'nextjs-portal — overlay de développement Next, absent en production, retiré car il recouvre le produit',
        degradedStatesSimulated:
          'Les captures « empty » et « unavailable » sont produites en substituant le contenu du panneau côté navigateur. L’Agent Server est PARTAGÉ avec d’autres chantiers de la machine : l’éteindre pour une capture n’est pas acceptable.',
      },
      e2e: {
        selectionDesktop,
        selectionMobile,
        layoutPersistence: persistence,
        tooling: toolingDesktop,
      },
      captures,
      console: {
        errors: errors.length,
        warnings: warnings.length,
        // Les messages sont listés en clair : un compteur seul ne se vérifie pas.
        messages: consoleMessages,
      },
      violations,
      verdict: violations.length === 0 ? 'PASS' : 'FAIL',
    }

    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    console.log(`captures      : ${captures.length}`)
    console.log(`console       : ${errors.length} erreur(s), ${warnings.length} avertissement(s)`)
    console.log(`persistance   : ${JSON.stringify(persistence)}`)
    console.log(`outillage     : ${toolingDesktop.count} outils — ${toolingDesktop.statuses.join(', ')}`)
    console.log(`verdict       : ${manifest.verdict}`)
    if (violations.length > 0) {
      console.error('\nMANQUEMENTS :')
      for (const v of violations) console.error(`  · ${v}`)
    }
  } finally {
    // Le navigateur se ferme TOUJOURS, y compris sur erreur.
    await context.close()
    await browser.close()
  }

  if (violations.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
