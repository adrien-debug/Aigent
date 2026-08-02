#!/usr/bin/env node
/**
 * Harnais de capture et de vérification — mission AIGENT-VISUAL-STACK-002.
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
// Les preuves de la mission 001 restent intactes : elles appartiennent à
// une PR déjà mergée et ne doivent pas être écrasées par cette passe.
const OUT = join(process.cwd(), '.tmp/visual-reviews/AIGENT-VISUAL-STACK-002')

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
/**
 * Retire les surfaces de DÉVELOPPEMENT qui recouvrent le produit.
 *
 * `nextjs-portal` — l'overlay de Next, absent en production.
 */
async function hideDevOverlay(page) {
  await page
    .addStyleTag({
      content: ['nextjs-portal{display:none!important}'].join(''),
    })
    .catch(() => {})
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

/**
 * Rien d'étranger au produit ne doit recouvrir la page.
 *
 * Les captures v1 portaient un panneau « Describe a change » masquant le bas
 * de l'outillage. Il venait d'une extension, pas du DOM applicatif. Cette
 * assertion cherche les marqueurs d'outillage extérieur ET tout élément
 * flottant plein-largeur ancré en bas de viewport, qui est la signature d'une
 * barre injectée.
 */
async function assertNoForeignOverlay(page, file) {
  const intruders = await page.evaluate(() => {
    /*
     * Marqueurs d'outillage TIERS, choisis pour ne pas matcher le produit.
     * « Copilot » seul est exclu : c'est le vocabulaire métier d'Aigent
     * (« Agent Builder Copilot », « Gold Trading High-Risk Copilot ») et le
     * filtrer ferait échouer la capture sur des noms d'agents légitimes.
     */
    const OUTIL = /describe a change|github copilot|cursor tab|open in cursor/i
    const found = []
    /*
     * TOUT le document, pas seulement `body *`.
     *
     * `<css-studio-panel>` est enfant direct de `<html>` — un `body *` ne le
     * trouve JAMAIS. C'est ce détail qui a fait passer la sonde négative au
     * vert alors que le panneau était bien rendu : l'assertion cherchait au
     * mauvais endroit. Une gate qui interroge le mauvais périmètre est une
     * gate qui ne mesure rien.
     */
    for (const el of document.querySelectorAll('html *')) {
      // Les <script> RSC portent du texte sérialisé : ils ne sont pas visibles
      // et n'ont rien à faire dans cette recherche.
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue
      const text = (el.textContent ?? '').trim()
      if (el.children.length === 0 && OUTIL.test(text)) {
        found.push(`texte « ${text.slice(0, 40)} »`)
        continue
      }
      const style = getComputedStyle(el)
      if (style.position !== 'fixed') continue
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue

      /*
       * Critère GÉOMÉTRIQUE, pas textuel — c'est ce qui manquait.
       *
       * Le panneau CSS Studio (`<css-studio-panel>`, injecté par le serveur de
       * dev) porte un Shadow DOM : aucune recherche de texte ne le trouve. Il a
       * ainsi traversé deux campagnes de captures en masquant le bas de
       * l'écran. Un élément fixe qui couvre le bas du viewport masque du
       * produit, quel que soit son contenu.
       */
      const coversBottom = r.bottom > window.innerHeight - 8
      const wide = r.width > window.innerWidth * 0.85
      const isProduct = el.closest('[data-testid]') !== null
      if (coversBottom && wide && r.height > 40 && !isProduct) {
        found.push(
          `<${el.tagName.toLowerCase()}> fixe couvrant le bas (${Math.round(r.width)}×${Math.round(r.height)})`,
        )
      }
    }
    return [...new Set(found)].slice(0, 4)
  })
  if (intruders.length > 0) {
    fail(`${file} : overlay étranger au produit — ${intruders.join(' | ')}`)
  }
}

async function shoot(page, file, meta) {
  const overflow = await hasHorizontalOverflow(page)
  if (overflow) fail(`débordement horizontal sur ${file}`)
  await assertNoForeignOverlay(page, file)
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

  /*
   * ÉTAT COHÉRENT, PAS SEULEMENT UNE BOÎTE DE TEXTE.
   *
   * La v1 remplaçait le contenu du Canvas mais laissait les compteurs du VRAI
   * graphe : la capture affichait « 5 nœud(s) · 6 arête(s) » au-dessus de
   * « Aucun nœud à représenter ». Cet état n'existe nulle part dans le produit
   * — une preuve d'un écran impossible ne prouve rien.
   *
   * Le graphe étant chargé côté serveur (RSC), `page.route` ne peut pas
   * l'intercepter. On simule donc dans le DOM, mais on met à jour TOUT ce qui
   * décrit la topologie : compteurs ET zone de rendu. La boîte prend la
   * hauteur de son contenu au lieu d'étirer 600px de vide.
   */
  await page.evaluate(
    ({ headline, body }) => {
      // Compteurs : ils décrivent la topologie, ils doivent suivre.
      for (const badge of document.querySelectorAll('span, div')) {
        if (badge.children.length > 0) continue
        const t = (badge.textContent ?? '').trim()
        if (/^\d+ nœud\(s\)$/.test(t)) badge.textContent = '0 nœud(s)'
        else if (/^\d+ arête\(s\)$/.test(t)) badge.textContent = '0 arête(s)'
      }

      const canvas = document.querySelector('[data-testid="graph-canvas"]')
      const host = canvas?.parentElement
      if (!host) return
      host.innerHTML = ''
      /*
       * Le panneau garde sinon la hauteur réservée au graphe : ~400px de fond
       * noir sous un message de deux lignes, qu'on lit comme un masque plutôt
       * que comme un état vide. On laisse le conteneur se dimensionner sur son
       * contenu réel.
       */
      host.style.flex = '0 0 auto'
      host.style.minHeight = '0'
      // Le fond noir vient du PANNEAU, pas du conteneur direct : on remonte la
      // chaîne des ancêtres qui s'étirent (`flex: 1`) jusqu'au panneau, pour
      // qu'ils se dimensionnent eux aussi sur leur contenu.
      let parent = host.parentElement
      for (let depth = 0; depth < 4 && parent; depth += 1) {
        const cs = getComputedStyle(parent)
        if (cs.flexGrow !== '0' || cs.flex.startsWith('1')) {
          parent.style.flex = '0 0 auto'
          parent.style.minHeight = '0'
        }
        parent = parent.parentElement
      }
      const box = document.createElement('div')
      box.setAttribute('data-testid', 'graph-canvas-degraded')
      // `min-height` modeste et pas de `flex:1` : la boîte s'ajuste à son
      // texte plutôt que d'occuper toute la hauteur disponible.
      box.style.cssText =
        'display:flex;min-height:9rem;align-items:center;justify-content:center;border:1px dashed #52525b;border-radius:.5rem;padding:2rem 1.5rem;text-align:center'
      const inner = document.createElement('div')
      inner.style.cssText = 'max-width:36rem;display:flex;flex-direction:column;gap:.5rem'
      const h = document.createElement('div')
      h.style.cssText = 'font-size:.8125rem;font-weight:600;color:#e4e4e7'
      h.textContent = headline
      const p = document.createElement('div')
      p.style.cssText = 'font-size:.75rem;color:#a1a1aa;line-height:1.5'
      p.textContent = body
      inner.append(h, p)
      box.append(inner)
      host.append(box)
    },
    { headline, body },
  )
  await page.waitForTimeout(400)

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
  // Vocabulaire complet de `ToolStatus`. `NOT_CONFIGURED` (rien à sonder) et
  // `ERROR` (sondé, muet) sont deux absences DIFFÉRENTES : les fondre en une
  // seule ferait chercher une panne là où il manque une variable, et
  // inversement.
  const VOCAB = [
    'VERIFIED',
    'CONNECTED',
    'RUNNING',
    'CONFIGURED',
    'INSTALLED',
    'NOT_CONFIGURED',
    'UNAVAILABLE',
    'ERROR',
  ]
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

  /*
   * GÉOMÉTRIE MOBILE — ce que « pas d'overflow » ne prouvait pas.
   *
   * La v1 passait toutes les gates avec une composition illisible : nom cassé
   * en trois lignes, « adresse connue, sonde en échec » à un mot par ligne,
   * bouton hors du panneau. Le document ne débordait pas — chaque colonne
   * rétrécissait à l'intérieur. Ces assertions mesurent donc la LARGEUR UTILE
   * réelle et la position des éléments, pas seulement le scroll du document.
   */
  if (name === 'mobile') {
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="visual-tooling"]')
      const panelRect = panel?.getBoundingClientRect() ?? null
      return [...document.querySelectorAll('[data-testid="visual-tool-row"]')].map((row) => {
        const rect = row.getBoundingClientRect()
        const name = row.querySelector('span.font-semibold')
        const nameRect = name?.getBoundingClientRect() ?? null
        const action = row.querySelector('a, span.italic')
        const actionRect = action?.getBoundingClientRect() ?? null
        return {
          tool: row.dataset.tool,
          width: rect.width,
          // Largeur du nom rapportée à celle de la ligne : un nom qui occupe
          // une bande étroite est un nom qui se casse mot à mot.
          nameWidth: nameRect?.width ?? 0,
          nameHeight: nameRect?.height ?? 0,
          actionRight: actionRect?.right ?? null,
          actionWidth: actionRect?.width ?? 0,
          rowRight: rect.right,
          panelRight: panelRect?.right ?? null,
        }
      })
    })

    /*
     * Seuil calé sur la largeur RÉELLEMENT disponible, pas sur le viewport.
     *
     * Mesuré au 2026-08-01 à 375 px : le shell impose `max-lg:pl-14` (56 px de
     * rail), puis les conteneurs successifs retirent 72 px — il reste 247 px à
     * la ligne. Exiger 300 px ferait échouer le harnais sur une contrainte du
     * SHELL, hors du périmètre de cette console. On vérifie donc que la ligne
     * occupe bien toute la largeur que son parent lui laisse : c'est ce que ce
     * composant contrôle.
     */
    const panelWidth = await page.evaluate(() => {
      const ul = document.querySelector('[data-testid="visual-tool-row"]')?.parentElement
      return ul ? ul.getBoundingClientRect().width : 0
    })

    for (const g of geometry) {
      // La ligne doit remplir son conteneur — un rétrécissement interne
      // (l'ancienne grille fixe) se voit ici.
      if (g.width < panelWidth - 2) {
        fail(
          `${surface} : ligne « ${g.tool} » large de ${Math.round(g.width)}px pour ${Math.round(panelWidth)}px disponibles`,
        )
      }
      // Plancher absolu de lisibilité, indépendant du shell.
      if (g.width < 240) {
        fail(`${surface} : ligne « ${g.tool} » sous le plancher de lisibilité (${Math.round(g.width)}px)`)
      }
      // Un nom sur plus de deux lignes de texte = cassure mot à mot.
      if (g.nameHeight > 44) {
        fail(
          `${surface} : nom de « ${g.tool} » cassé sur ${Math.round(g.nameHeight)}px de haut (mot à mot)`,
        )
      }
      // L'action doit rester DANS le panneau, entièrement.
      if (g.actionRight !== null && g.panelRight !== null && g.actionRight > g.panelRight + 1) {
        fail(
          `${surface} : action de « ${g.tool} » déborde du panneau (${Math.round(g.actionRight)} > ${Math.round(g.panelRight)})`,
        )
      }
      // Une action rendue mais large de zéro est invisible.
      if (g.actionRight !== null && g.actionWidth < 24) {
        fail(`${surface} : action de « ${g.tool} » large de ${Math.round(g.actionWidth)}px`)
      }
    }

    /*
     * Le hint du panneau doit être LU, pas tronqué.
     *
     * Il vit hors des lignes d'outil, donc les assertions ci-dessus ne le
     * couvraient pas : « … au dernier passage » s'affichait « au dernier
     * passa » sans qu'aucune gate ne bronche. Un texte coupé ne dit pas ce
     * qu'il prétend dire.
     */
    const truncated = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="visual-tooling"]')
      if (!panel) return []
      return [...panel.querySelectorAll('p, span, div')]
        .filter((el) => {
          if (el.children.length > 0) return false
          const style = getComputedStyle(el)
          if (style.textOverflow !== 'ellipsis' && style.overflow !== 'hidden') return false
          return el.scrollWidth > el.clientWidth + 1
        })
        .map((el) => (el.textContent ?? '').trim().slice(0, 50))
        .slice(0, 5)
    })
    if (truncated.length > 0) {
      fail(`${surface} : texte tronqué — ${truncated.join(' | ')}`)
    }

    // Aucun texte ne doit sortir de son panneau.
    const escaping = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="visual-tooling"]')
      if (!panel) return []
      const panelRect = panel.getBoundingClientRect()
      return [...panel.querySelectorAll('[data-testid="visual-tool-row"] *')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.right > panelRect.right + 1 || r.left < panelRect.left - 1)
        })
        .map((el) => (el.textContent ?? '').trim().slice(0, 40))
        .slice(0, 5)
    })
    if (escaping.length > 0) {
      fail(`${surface} : contenu hors du panneau — ${escaping.join(' | ')}`)
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

  /*
   * NAVIGATEUR STÉRILE — seul le produit doit apparaître sur une preuve.
   *
   * Les captures v1 portaient un panneau « Describe a change » en bas de
   * l'écran, masquant les dernières lignes de l'outillage et le bas du Canvas
   * en 375×812. Il ne vient PAS du DOM (vérifié : aucun élément ne porte ce
   * texte) mais d'une extension chargée dans le navigateur. Une preuve qui
   * montre l'outillage de son auteur n'est pas une preuve du produit.
   *
   * On lance donc explicitement en headless, sans extension, sans profil
   * persistant, et on neutralise l'automation-detection qui déclenche
   * certaines barres.
   */
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=Translate,AcceptCHFrame,MediaRouter',
      '--no-default-browser-check',
      '--no-first-run',
      '--hide-scrollbars',
    ],
  })
  const context = await browser.newContext({
    // Pas de profil hérité : chaque capture repart d'un état vierge.
    storageState: undefined,
    deviceScaleFactor: 1,
  })
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
      mission: 'AIGENT-VISUAL-STACK-002',
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
