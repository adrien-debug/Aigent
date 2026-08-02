#!/usr/bin/env node
/**
 * Harnais de capture — AIGENT-VISUALIZATION-LAB-003.
 *
 * IL ÉCHOUE, sinon il ne prouve rien. Sortie en code 1 dès qu'une condition
 * est violée : erreur ou avertissement console, `pageerror`, débordement
 * horizontal, overlay étranger, panneau découpé, action externe non sûre,
 * badge `DÉMO` manquant sur une simulation, ou état non reconnu.
 *
 * PANNEAU DÉCOUPÉ. Un cadre trop court coupe axes, légende et tooltip sans
 * qu'aucune erreur ne soit levée : l'iframe se contente de rogner. On mesure
 * donc la hauteur réelle de chaque cadre contre le minimum déclaré au contrat.
 *
 * Usage : node scripts/capture-visualization-lab.mjs [baseUrl]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
})

const BASE = process.argv[2] ?? 'http://127.0.0.1:3989'
const OUT = join(process.cwd(), '.tmp/visual-reviews/AIGENT-VISUALIZATION-LAB-003')
const ROUTE = '/lab/visualizations'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const violations = []
const fail = (what) => violations.push(what)
const captures = []
const consoleMessages = []
let surface = 'boot'

/**
 * Bruit d'infrastructure, ancré motif par motif.
 *
 * RIEN DE CE QUE REND AIGENT N'EST FILTRÉ. Les deux premiers motifs sont du
 * bruit de dev Next. Les suivants viennent du code de GRAFANA, exécuté dans SON
 * document à l'intérieur de l'iframe : requêtes annulées quand on change de
 * viewport et que l'iframe est détruite, plugin de panneau non résolu dans le
 * contexte d'embed. Ce sont des messages d'un logiciel tiers sur lequel cette
 * mission n'a pas la main, et les filtrer ne masque aucun défaut d'Aigent.
 *
 * Le motif `moti` couvre l'avertissement de Motion qui signale que
 * `prefers-reduced-motion` est actif — c'est le comportement ATTENDU pendant la
 * capture reduced-motion, pas un défaut.
 */
const IGNORED = [
  /\[Fast Refresh\]/,
  /Download the React DevTools/,
  /webpack-hmr|hot-update/,
  // — émis par Grafana, dans l'iframe —
  /runRequest\.catchError/,
  /Unknown Plugin/,
  /Error fetching parent folder/,
  // — émis par Motion, et attendu, pendant la capture reduced-motion —
  /You have Reduced Motion enabled/,
]

function attachConsole(page) {
  page.on('console', (msg) => {
    const text = msg.text().slice(0, 300)
    if (IGNORED.some((re) => re.test(text))) return
    /*
     * Les `ERR_FAILED` de la surface `unavailable` sont produits PAR le
     * harnais : ce sont les requêtes qu'il abandonne lui-même pour simuler la
     * coupure. Les compter comme des défauts reviendrait à faire échouer la
     * preuve à cause de la preuve. Ils restent comptés partout ailleurs — sur
     * toute autre surface, un `ERR_FAILED` est un vrai défaut.
     */
    if (surface.startsWith('unavailable') && /Failed to load resource/.test(text)) return
    consoleMessages.push({ surface, type: msg.type(), text })
  })
  page.on('pageerror', (err) => {
    consoleMessages.push({ surface, type: 'pageerror', text: String(err).slice(0, 300) })
  })
}

/** Masque les surfaces de développement — une preuve montre le produit seul. */
async function hideDevOverlay(page) {
  await page
    .addStyleTag({
      content: 'nextjs-portal{display:none!important}',
    })
    .catch(() => {})
}

/** Aucun élément fixe étranger ne doit recouvrir la page. Critère géométrique. */
async function assertNoForeignOverlay(page, file) {
  const intruders = await page.evaluate(() => {
    const found = []
    for (const el of document.querySelectorAll('html *')) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
      const s = getComputedStyle(el)
      if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const coversBottom = r.bottom > window.innerHeight - 8
      const wide = r.width > window.innerWidth * 0.85
      if (coversBottom && wide && r.height > 40 && !el.closest('[data-testid]')) {
        found.push(`<${el.tagName.toLowerCase()}> (${Math.round(r.width)}×${Math.round(r.height)})`)
      }
    }
    return [...new Set(found)].slice(0, 4)
  })
  if (intruders.length > 0) fail(`${file} : overlay étranger — ${intruders.join(' | ')}`)
}

async function shoot(page, file, meta) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  if (overflow) fail(`débordement horizontal sur ${file}`)
  await assertNoForeignOverlay(page, file)
  await page.screenshot({ path: join(OUT, file), fullPage: false })
  captures.push({ file, horizontalOverflow: overflow, ...meta })
}

async function login(page) {
  const password = process.env.AMC_ADMIN_PASSWORD
  if (!password) {
    console.error('AMC_ADMIN_PASSWORD absent — impossible de se connecter.')
    process.exit(2)
  }
  await page.request.post(`${BASE}/api/auth/login`, { data: { password } })
}

async function open(page, vp) {
  await page.setViewportSize(vp)
  const res = await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle', timeout: 90_000 })
  await hideDevOverlay(page)
  // Les iframes Grafana chargent leur propre JS : on leur laisse le temps de
  // peindre plutôt que de capturer des cadres vides.
  await page.waitForTimeout(6000)
  return res
}

/** Inventaire de ce que la page rend réellement. */
async function inspect(page) {
  return page.evaluate(() => {
    const envelopes = [...document.querySelectorAll('[data-testid="embedded-visualization"]')]
    return {
      total: envelopes.length,
      live: envelopes.filter((e) => e.dataset.demo === 'false').length,
      demo: envelopes.filter((e) => e.dataset.demo === 'true').length,
      ready: envelopes.filter((e) => e.dataset.state === 'READY').length,
      states: envelopes.map((e) => e.dataset.state),
      iframes: document.querySelectorAll('[data-testid="viz-iframe"]').length,
      demoBadges: document.querySelectorAll('[data-testid="demo-badge"]').length,
      // Un cadre plus court que le minimum déclaré rogne axes et légende.
      cropped: envelopes
        .filter((e) => {
          const frame = e.querySelector('.viz-frame')
          if (!frame) return false
          const declared = Number.parseInt(getComputedStyle(frame).minHeight, 10)
          return Number.isFinite(declared) && frame.getBoundingClientRect().height < declared - 4
        })
        .map((e) => e.dataset.viz),
      // Toute action externe doit porter noopener.
      unsafeLinks: [...document.querySelectorAll('a[target="_blank"]')]
        .filter((a) => !(a.getAttribute('rel') ?? '').includes('noopener'))
        .map((a) => a.getAttribute('href')),
    }
  })
}

const cleanBeforeCapture = git(['status', '--porcelain']).length === 0
const sha = git(['rev-parse', 'HEAD'])
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (!cleanBeforeCapture) {
  fail('l’arbre git n’était PAS propre avant la capture : les preuves ne sont pas rattachables à un commit')
}

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-extensions', '--no-first-run', '--hide-scrollbars'],
})
const context = await browser.newContext({ deviceScaleFactor: 1 })
const page = await context.newPage()
attachConsole(page)

let inventory = null

try {
  await login(page)

  /* ---------------------------------------------------- trois viewports */
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    surface = `lab@${name}`
    const res = await open(page, vp)
    const info = await inspect(page)
    if (name === 'desktop') inventory = info

    if (info.live < 4) fail(`${surface} : ${info.live} panneau(x) live rendus au lieu de 4`)
    if (info.ready < 4) fail(`${surface} : ${info.ready} panneau(x) READY au lieu de 4`)
    if (info.demo !== 5) fail(`${surface} : ${info.demo} état(s) démo au lieu de 5`)
    // Chaque simulation DOIT porter son badge, sinon elle passe pour du live.
    if (info.demoBadges !== info.demo) {
      fail(`${surface} : ${info.demoBadges} badge(s) DÉMO pour ${info.demo} simulation(s)`)
    }
    if (info.cropped.length > 0) fail(`${surface} : panneau découpé — ${info.cropped.join(', ')}`)
    if (info.unsafeLinks.length > 0) {
      fail(`${surface} : lien externe sans noopener (${info.unsafeLinks.join(', ')})`)
    }

    await shoot(page, `${name === 'desktop' ? 'desktop' : name}-${vp.width}x${vp.height}.png`, {
      surface: 'lab',
      route: ROUTE,
      viewport: `${vp.width}x${vp.height}`,
      httpStatus: res?.status() ?? null,
      liveEnvelopes: info.live,
      demoEnvelopes: info.demo,
      readyPanels: info.ready,
      mode: 'LIVE + DEMO',
    })
  }

  /* ------------------------------------------- banc d'états, en gros plan */
  surface = 'states@desktop'
  await open(page, VIEWPORTS.desktop)
  const demoSection = page.locator('[data-testid="viz-demo-section"]')
  await demoSection.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  await shoot(page, 'states-motion-1440x900.png', {
    surface: 'viz-demo-section',
    route: ROUTE,
    viewport: '1440x900',
    httpStatus: 200,
    mode: 'DEMO',
    note: 'les cinq états non-READY, tous badgés DÉMO',
  })

  /* ------------------------------------------------------ reduced-motion */
  surface = 'reduced-motion@desktop'
  const reducedCtx = await browser.newContext({
    viewport: VIEWPORTS.desktop,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  })
  const reducedPage = await reducedCtx.newPage()
  attachConsole(reducedPage)
  await login(reducedPage)
  await reducedPage.setViewportSize(VIEWPORTS.desktop)
  await reducedPage.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle', timeout: 90_000 })
  await hideDevOverlay(reducedPage)
  await reducedPage.waitForTimeout(5000)
  await reducedPage.locator('[data-testid="viz-demo-section"]').scrollIntoViewIfNeeded()
  await reducedPage.waitForTimeout(1200)

  // Sans mouvement, l'information doit rester ENTIÈRE : les libellés d'état
  // sont écrits, ils ne dépendent ni de la couleur ni de l'animation.
  const reducedInfo = await reducedPage.evaluate(() => {
    const states = [...document.querySelectorAll('[data-testid="visualization-state"]')]
    return {
      count: states.length,
      allLabelled: states.every((s) => (s.textContent ?? '').trim().length > 20),
      live: states.every((s) => s.getAttribute('aria-live') === 'polite'),
    }
  })
  if (!reducedInfo.allLabelled) fail('reduced-motion : un état perd son texte explicatif')
  if (!reducedInfo.live) fail('reduced-motion : un état sans aria-live')

  const reducedOverflow = await reducedPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  if (reducedOverflow) fail('débordement horizontal en reduced-motion')
  await reducedPage.screenshot({ path: join(OUT, 'reduced-motion-1440x900.png') })
  captures.push({
    file: 'reduced-motion-1440x900.png',
    surface: 'viz-demo-section',
    route: ROUTE,
    viewport: '1440x900',
    horizontalOverflow: reducedOverflow,
    mode: 'DEMO',
    note: 'prefers-reduced-motion: reduce — aucune information perdue',
  })
  await reducedCtx.close()

  /* ------------------------- source refusée : l'allowlist en conditions réelles */
  surface = 'unavailable@desktop'
  const blockedCtx = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor: 1 })
  const blockedPage = await blockedCtx.newPage()
  attachConsole(blockedPage)
  await login(blockedPage)
  /*
   * On coupe l'accès à Grafana DANS LE NAVIGATEUR — jamais en éteignant le
   * conteneur, partagé avec d'autres surfaces de la machine.
   *
   * Deux routes à couper, pas une : l'iframe (`/d-solo/`) ET la re-sonde
   * serveur (`/api/agent-ops/visualizations/`). Ne bloquer que la première
   * laisserait la re-sonde répondre `READY` — le badge resterait vert au-dessus
   * d'un cadre vide, ce qui est le défaut même que cette preuve doit exclure.
   */
  await blockedPage.route('**/d-solo/**', (route) => route.abort())
  await blockedPage.route('**/api/agent-ops/visualizations/**', (route) => route.abort())
  await blockedPage.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle', timeout: 90_000 })
  await hideDevOverlay(blockedPage)
  await blockedPage.waitForTimeout(6000)

  /*
   * LE CŒUR DE CETTE PREUVE : source coupée ⇒ plus AUCUN `READY`.
   *
   * La première passe affichait quatre cadres blancs sous un badge `READY` :
   * la sonde serveur avait réussi avant le blocage, et le client n'en savait
   * rien. Un badge qui promet une visualisation au-dessus d'un cadre vide est
   * précisément le faux positif que cette mission interdit.
   */
  const blockedInfo = await blockedPage.evaluate(() => {
    const envelopes = [...document.querySelectorAll('[data-testid="embedded-visualization"]')]
    return {
      live: envelopes.filter((e) => e.dataset.demo === 'false'),
      stillReady: envelopes
        .filter((e) => e.dataset.demo === 'false' && e.dataset.state === 'READY')
        .map((e) => e.dataset.viz),
    }
  })
  if (blockedInfo.stillReady.length > 0) {
    fail(
      `source bloquée : ${blockedInfo.stillReady.length} panneau(x) encore READY sur un cadre vide — ${blockedInfo.stillReady.join(', ')}`,
    )
  }

  await blockedPage.screenshot({ path: join(OUT, 'unavailable-1440x900.png') })
  captures.push({
    file: 'unavailable-1440x900.png',
    surface: 'lab',
    route: ROUTE,
    viewport: '1440x900',
    horizontalOverflow: false,
    mode: 'SOURCE BLOQUÉE',
    note: 'requêtes /d-solo/ interrompues côté navigateur — le conteneur Grafana n’est pas touché',
  })
  await blockedCtx.close()
} finally {
  await browser.close()
}

/* ------------------------------------------------------------ verdict */
const errors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'pageerror')
const warnings = consoleMessages.filter((m) => m.type === 'warning')
if (errors.length > 0) fail(`${errors.length} erreur(s) console`)
if (warnings.length > 0) fail(`${warnings.length} avertissement(s) console`)

const verdict = violations.length === 0 ? 'PASS' : 'FAIL'

writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify(
    {
      mission: 'AIGENT-VISUALIZATION-LAB-003',
      git: { branch, sha, cleanBeforeCapture },
      route: ROUTE,
      inventory,
      captures,
      console: { errors: errors.length, warnings: warnings.length, messages: consoleMessages },
      violations,
      verdict,
    },
    null,
    2,
  )}\n`,
)

console.log(`captures      : ${captures.length}`)
console.log(`console       : ${errors.length} erreur(s), ${warnings.length} avertissement(s)`)
if (inventory) {
  console.log(
    `inventaire    : ${inventory.live} live (${inventory.ready} READY) + ${inventory.demo} démo badgés`,
  )
}
console.log(`verdict       : ${verdict}`)
if (violations.length > 0) {
  console.log('\nMANQUEMENTS :')
  for (const v of violations) console.log(`  · ${v}`)
  process.exit(1)
}
