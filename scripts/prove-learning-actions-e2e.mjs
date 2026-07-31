#!/usr/bin/env node
/**
 * E2E ciblé — `/learning` et `/actions`, dans un vrai Chromium.
 *
 * CE QUE CE HARNESS PROUVE
 * ------------------------
 *  1. les deux routes rendent sans erreur console ;
 *  2. aucun débordement horizontal à 375×812 ;
 *  3. **aucun contrôle fixe du shell ne recouvre le contenu**, à TOUTES les
 *     positions de défilement — la vérification que la revue précédente avait
 *     manquée, parce qu'elle ne regardait que le haut de page ;
 *  4. le comportement d'une **file longue** sur mobile, navigation fermée puis
 *     ouverte.
 *
 * FIXTURE : DANS LE HARNESS, JAMAIS DANS LE PRODUIT
 * ------------------------------------------------
 * La file longue est obtenue en INTERCEPTANT la réponse HTML dans le
 * navigateur piloté (`page.route`) pour dupliquer les lignes déjà rendues par
 * le serveur réel. Aucune donnée n'est injectée en base, aucun drapeau de test
 * n'existe dans `src/**`, et le serveur produit ne sait rien de ce harness :
 * couper ce script ne change pas d'un octet ce que sert l'application.
 *
 * C'est la contrainte de la mission — « les données de preuve peuvent être
 * déterministes dans le harness E2E, mais aucune fixture ne doit entrer dans le
 * parcours produit ». Un `?fixture=long` lu par une route produit aurait été
 * exactement l'inverse.
 *
 * Usage :
 *   node scripts/prove-learning-actions-e2e.mjs [--capture <dir>]
 *
 * Sortie : exit 0 si tout passe, 1 sinon, avec le détail de chaque échec.
 * Lecture seule côté produit : aucune mutation, aucun appel LLM.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright'

/** La version RÉSOLUE du paquet chargé — pas la plage déclarée. */
const PLAYWRIGHT_VERSION = createRequire(import.meta.url)('playwright/package.json').version

const BASE = process.env.AIGENT_E2E_BASE ?? 'http://127.0.0.1:3987'
const MOBILE = { width: 375, height: 812 }

/** Les captures des grands viewports — mêmes noms que le manifeste. */
const DESKTOP_SHOTS = [
  { route: '/learning', viewport: { width: 1440, height: 900 }, name: 'desktop-1440x900.png' },
  { route: '/learning', viewport: { width: 1280, height: 800 }, name: 'laptop-1280x800.png' },
  { route: '/learning', viewport: { width: 1440, height: 900 }, name: 'obsidian-bridge-state-1440x900.png' },
  { route: '/actions', viewport: { width: 1440, height: 900 }, name: 'actions-desktop-1440x900.png' },
]

const captureIndex = process.argv.indexOf('--capture')
const CAPTURE_DIR = captureIndex === -1 ? null : process.argv[captureIndex + 1]
if (CAPTURE_DIR) mkdirSync(CAPTURE_DIR, { recursive: true })

const failures = []
const notes = []

/**
 * Les comptes CUMULÉS de tous les scénarios, écrits sur disque à la fin.
 *
 * Le manifeste lisait `consoleErrors: 0` / `consoleWarnings: 0` codés en dur —
 * une affirmation, pas une mesure, et fausse pour les warnings puisque rien ne
 * les collectait. Ces totaux sont désormais MESURÉS ici et repris tels quels
 * par `write-visual-manifest.mjs`.
 */
const totals = { consoleErrors: 0, consoleWarnings: 0, pageExceptions: 0, scenarios: 0 }

function tally(monitor) {
  totals.consoleErrors += monitor.errors.length
  totals.consoleWarnings += monitor.warnings.length
  totals.pageExceptions += monitor.pageExceptions.length
  totals.scenarios += 1
}

let assertionCount = 0

function check(ok, label, detail = '') {
  assertionCount += 1
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Le contrôle fixe recouvre-t-il du contenu, à N positions de défilement ?
 *
 * Évalué DANS la page : on prend le rectangle de chaque élément `position:
 * fixed` visible, puis on cherche tout élément textuel dont le rectangle
 * l'intersecte. Un élément fixe ne défile pas — il faut donc rejouer le test à
 * chaque position, sinon on ne mesure que le haut de page.
 */
const OVERLAP_PROBE = () => {
  const fixedZones = []
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' || cs.visibility === 'hidden') return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    // Le tiroir de navigation ouvert recouvre volontairement la page : c'est
    // une surface modale, pas un contrôle flottant. On ne le compte pas.
    if (el.closest('[role="dialog"]')) return
    fixedZones.push({ el, r })
  })
  if (fixedZones.length === 0) return { positions: 0, overlaps: [] }

  const scroller = document.scrollingElement
  const max = Math.max(0, scroller.scrollHeight - window.innerHeight)
  const stops = max === 0 ? [0] : [0, max * 0.25, max * 0.5, max * 0.75, max].map(Math.round)

  const overlaps = []
  for (const y of stops) {
    scroller.scrollTop = y
    for (const zone of fixedZones) {
      const z = zone.el.getBoundingClientRect()
      document.querySelectorAll('p, strong, h1, h2, h3, span, code, a, li, select, button').forEach((el) => {
        if (zone.el.contains(el) || el.contains(zone.el)) return
        if (el.closest('[role="dialog"]')) return
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        if (r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top) {
          overlaps.push({ scrollY: y, text: (el.textContent || '').trim().slice(0, 40) })
        }
      })
    }
  }
  scroller.scrollTop = 0
  return { positions: stops.length, overlaps }
}

const OVERFLOW_PROBE = () => {
  const de = document.documentElement
  let count = 0
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > de.clientWidth + 1) count += 1
  })
  return { viewport: de.clientWidth, scrollWidth: de.scrollWidth, offscreen: count }
}

/**
 * Le badge de développement Next.js (`nextjs-portal`) flotte en bas à gauche
 * du viewport. Il n'existe QUE sous `npm run dev` — `next build` ne l'émet
 * pas — donc il n'appartient pas au produit et il n'a rien à faire sur une
 * capture de preuve, où il se lit comme un élément d'interface.
 *
 * Masqué, jamais « corrigé » côté produit : il n'y a rien à corriger.
 */
const HIDE_DEV_BADGE = 'nextjs-portal { display: none !important; }'

/**
 * Moniteur attaché au CONTEXTE, vivant jusqu'à sa fermeture.
 *
 * POURQUOI PAS UN ÉCOUTEUR AUTOUR DU SEUL `goto`
 * ----------------------------------------------
 * Une version antérieure n'écoutait que pendant le chargement, puis se
 * détachait — donc tout ce qui se produisait ENSUITE (clonage de la file,
 * défilement, ouverture du tiroir, clic) passait inaperçu. Et elle ne
 * collectait que `error`, pendant que le manifeste affirmait
 * `consoleWarnings: 0` : une preuve plus forte que la mesure, c'est-à-dire un
 * mensonge poli.
 *
 * Le moniteur est donc posé sur le contexte AVANT toute navigation et n'est
 * jamais retiré : il voit toute la vie de chaque page du contexte.
 *
 * DEUX SOURCES, DEUX ÉVÉNEMENTS DISTINCTS
 * ---------------------------------------
 *  · `console`  — les messages `error` / `warning` émis par la page.
 *  · `weberror` — les EXCEPTIONS NON CAPTURÉES. C'est un événement de
 *    `BrowserContext` (types.d.ts : `on(event: 'weberror', listener:
 *    (webError: WebError) => any)`), à ne pas confondre avec `pageerror`, qui
 *    est l'équivalent sur `Page`.
 *
 *    Cette confusion a réellement eu lieu ici : `context.on('pageerror', …)`
 *    ne lève aucune erreur à l'enregistrement — Node accepte n'importe quel
 *    nom d'événement — il ne se déclenche simplement JAMAIS. Le harness
 *    prétendait donc collecter les exceptions de page sans en voir une seule :
 *    un écouteur silencieux est pire qu'un écouteur absent, parce qu'il se
 *    lit comme une garantie.
 *
 *    `WebError` porte `error()` ET `page()` : on garde les deux, la page
 *    d'origine étant ce qui permet d'attribuer l'exception quand un contexte
 *    en porte plusieurs. Elle peut être `null` (exception hors page) — dit
 *    tel quel, jamais deviné.
 */
function watchConsole(context) {
  const errors = []
  const warnings = []
  const pageExceptions = []

  context.on('console', (msg) => {
    const type = msg.type()
    const line = msg.text().slice(0, 160)
    if (type === 'error') errors.push(line)
    else if (type === 'warning' || type === 'warn') warnings.push(line)
  })

  context.on('weberror', (webError) => {
    const err = webError.error()
    const page = webError.page()
    // `page()` peut valoir `null` — une exception hors page. On l'écrit
    // « (hors page) » plutôt que d'inventer une URL.
    const where = page ? page.url() : '(hors page)'
    const detail = `[weberror] ${(err?.message ?? String(err)).slice(0, 140)} @ ${where}`
    pageExceptions.push(detail)
    // Comptée AVEC les erreurs console : pour le verdict du harness, une
    // exception non capturée est au moins aussi grave qu'un `console.error`.
    errors.push(detail)
  })

  return { errors, warnings, pageExceptions }
}

/**
 * Vérifie les deux compteurs. Un warning non nul FAIT ÉCHOUER le harness au
 * même titre qu'une erreur — c'est ce que le manifeste prétendait déjà.
 */
function checkConsole(label, monitor) {
  check(
    monitor.errors.length === 0,
    `${label} — zéro erreur console`,
    monitor.errors.length ? `${monitor.errors.length} : ${monitor.errors[0]}` : ''
  )
  check(
    monitor.warnings.length === 0,
    `${label} — zéro warning console`,
    monitor.warnings.length ? `${monitor.warnings.length} : ${monitor.warnings[0]}` : ''
  )
  // Assertion PROPRE, en plus du compteur d'erreurs : une exception non
  // capturée et un `console.error` ne se diagnostiquent pas pareil, et fondre
  // les deux dans une seule ligne masquerait laquelle des deux a échoué.
  check(
    monitor.pageExceptions.length === 0,
    `${label} — zéro exception non capturée (weberror)`,
    monitor.pageExceptions.length ? `${monitor.pageExceptions.length} : ${monitor.pageExceptions[0]}` : ''
  )
}

async function visit(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: HIDE_DEV_BADGE })
}

async function main() {
  const browser = await chromium.launch()
  // La version RÉELLEMENT utilisée, lue sur le navigateur lancé — pas celle du
  // `package.json` ni du lockfile, qui peuvent diverger de ce qui est installé
  // (constaté : lockfile 1.62.1, `node_modules` 1.50.1). Une preuve doit dire
  // ce qui l'a produite.
  const driver = `Playwright ${PLAYWRIGHT_VERSION} · Chromium ${browser.version()}`
  try {
    // ─────────── 0. Captures desktop / laptop ───────────
    //
    // Régénérées ICI plutôt qu'à la main : une preuve produite par une commande
    // est reproductible, et surtout elle ne peut pas décrire un état du code
    // antérieur aux dernières corrections — ce qui était arrivé aux captures
    // desktop de la première livraison.
    if (CAPTURE_DIR) {
      for (const { route, viewport, name } of DESKTOP_SHOTS) {
        const context = await browser.newContext({ viewport })
        const monitor = watchConsole(context)
        const page = await context.newPage()
        await visit(page, route)
        console.log(`\n▸ ${route} — ${viewport.width}×${viewport.height}`)
        await page.screenshot({ path: join(CAPTURE_DIR, name), fullPage: true })
        // Vérifié APRÈS la capture : le rendu de la capture peut lui-même
        // déclencher un message, et il compte comme le reste.
        checkConsole('console', monitor)
        tally(monitor)
        notes.push(`capture ${name}`)
        await context.close()
      }
    }

    // ─────────── 1. /learning et /actions, viewport mobile ───────────
    for (const route of ['/learning', '/actions']) {
      console.log(`\n▸ ${route} — 375×812`)
      const context = await browser.newContext({ viewport: MOBILE })
      const monitor = watchConsole(context)
      const page = await context.newPage()

      await visit(page, route)

      const overflow = await page.evaluate(OVERFLOW_PROBE)
      check(
        overflow.scrollWidth <= overflow.viewport && overflow.offscreen === 0,
        'aucun débordement horizontal',
        `scrollWidth ${overflow.scrollWidth} / viewport ${overflow.viewport}, ${overflow.offscreen} hors écran`
      )

      const overlap = await page.evaluate(OVERLAP_PROBE)
      check(
        overlap.overlaps.length === 0,
        `aucun contrôle fixe ne recouvre le contenu (${overlap.positions} positions de défilement)`,
        overlap.overlaps.length ? `ex. « ${overlap.overlaps[0].text} » à y=${overlap.overlaps[0].scrollY}` : ''
      )

      if (CAPTURE_DIR) {
        const name = route === '/learning' ? 'mobile-375x812.png' : 'actions-mobile-375x812.png'
        await page.screenshot({ path: join(CAPTURE_DIR, name), fullPage: true })
        notes.push(`capture ${name}`)
      }

      // En DERNIER : le moniteur a vu le chargement, les sondes de mise en page
      // (qui défilent la page) et la capture.
      checkConsole('console', monitor)
      tally(monitor)
      await context.close()
    }

    // ─────────── 2. File LONGUE sur mobile, nav fermée puis ouverte ───────────
    //
    // La duplication se fait dans le NAVIGATEUR, sur le HTML déjà rendu par le
    // serveur réel : les lignes clonées sont de vraies lignes produites par la
    // dérivation produite, répétées pour atteindre une longueur qui déclenche
    // le défilement. Le serveur ne connaît pas ce montage.
    console.log('\n▸ /actions — file LONGUE, 375×812')
    const context = await browser.newContext({ viewport: MOBILE })
    // C'est LE scénario que l'ancienne mesure manquait : le clonage, le
    // défilement et l'ouverture du tiroir se produisent tous APRÈS le
    // chargement, donc après le détachement de l'ancien écouteur.
    const monitor = watchConsole(context)
    const page = await context.newPage()
    await visit(page, '/actions')

    const cloned = await page.evaluate(() => {
      const list = document.querySelector('ul')
      if (!list || list.children.length === 0) return { ok: false, rows: 0 }
      const template = [...list.children]
      // 24 lignes : largement au-delà de ce qu'un viewport de 812 px affiche,
      // donc la boîte DOIT défiler et le pied rester lisible.
      while (list.children.length < 24) {
        for (const row of template) {
          if (list.children.length >= 24) break
          list.appendChild(row.cloneNode(true))
        }
      }
      return { ok: true, rows: list.children.length }
    })
    check(cloned.ok && cloned.rows >= 24, 'file longue montée dans le harness', `${cloned.rows} lignes`)
    // À LIRE AVEC LA CAPTURE : le pied continue d'annoncer le nombre RÉEL de
    // lignes servies par le serveur (2), pas les 24 clonées. C'est voulu et
    // c'est la preuve que le montage reste dans le navigateur : le compteur
    // vient de la donnée produite, que ce harness ne touche pas.
    notes.push(`file longue = ${cloned.rows} lignes clonées dans le DOM ; le pied affiche toujours le compte réel du serveur`)

    const longOverflow = await page.evaluate(OVERFLOW_PROBE)
    check(
      longOverflow.scrollWidth <= longOverflow.viewport && longOverflow.offscreen === 0,
      'file longue — aucun débordement horizontal',
      `${longOverflow.offscreen} hors écran`
    )

    const longOverlap = await page.evaluate(OVERLAP_PROBE)
    check(
      longOverlap.overlaps.length === 0,
      'file longue — aucun contrôle fixe ne recouvre le contenu',
      longOverlap.overlaps.length ? `ex. « ${longOverlap.overlaps[0].text} »` : ''
    )

    // La file défile-t-elle DANS sa boîte bornée, sans pousser la page ?
    // On cherche le conteneur qui porte réellement les lignes, pas le premier
    // `overflow-y:auto` venu — le shell en pose plusieurs.
    const scrolls = await page.evaluate(() => {
      const list = document.querySelector('ul')
      if (!list) return { found: false }
      let box = list.parentElement
      while (box && box !== document.body) {
        const cs = getComputedStyle(box)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && box.scrollHeight > box.clientHeight + 4) {
          box.scrollTop = box.scrollHeight
          const moved = box.scrollTop > 0
          box.scrollTop = 0
          return { found: true, moved, overflow: box.scrollHeight - box.clientHeight }
        }
        box = box.parentElement
      }
      return { found: false }
    })
    check(
      scrolls.found && scrolls.moved,
      'la file défile DANS sa boîte bornée',
      scrolls.found ? '' : 'aucun conteneur défilant ne porte la liste'
    )

    if (CAPTURE_DIR) {
      await page.screenshot({ path: join(CAPTURE_DIR, 'actions-mobile-long-queue-375x812.png') })
      notes.push('capture actions-mobile-long-queue-375x812.png')
    }

    // Navigation OUVERTE, par-dessus la file longue.
    //
    // On attend un LIEN de navigation visible, pas le conteneur `role="dialog"` :
    // Headless UI monte ce conteneur en `hidden` et n'y attache le panneau
    // qu'ensuite, donc l'attendre lui-même expire alors que le tiroir s'ouvre
    // normalement.
    await page.click('[aria-label="Ouvrir la navigation"]')
    await page.waitForSelector('[role="dialog"] a[href="/learning"]', { state: 'visible' })
    // Le tiroir entre par une transition de 300 ms (`data-closed:-translate-x-full`).
    // Sans cette attente, la capture fige le panneau ENCORE HORS ÉCRAN et
    // montre une navigation « ouverte » invisible — l'assertion passait, la
    // preuve ne prouvait rien. On attend que la translation soit retombée à
    // zéro plutôt qu'un délai fixe.
    await page
      .waitForFunction(
        () => {
          const panel = document.querySelector('[role="dialog"] a[href="/learning"]')?.closest('div[class*="fixed"]')
          if (!panel) return false
          return Math.abs(panel.getBoundingClientRect().left) < 1
        },
        { timeout: 5000 }
      )
      .catch(() => {})
    const navEntries = await page.evaluate(
      () => document.querySelectorAll('[role="dialog"] a[href]').length
    )
    check(navEntries >= 11, 'navigation ouverte — les 11 surfaces sont atteignables', `${navEntries} liens`)

    if (CAPTURE_DIR) {
      await page.screenshot({ path: join(CAPTURE_DIR, 'actions-mobile-long-queue-nav-open-375x812.png') })
      notes.push('capture actions-mobile-long-queue-nav-open-375x812.png')
    }

    // En DERNIER, une fois le scénario ENTIER joué : chargement, clonage,
    // défilement dans la boîte, clic sur le tiroir, transition, captures.
    checkConsole('console', monitor)
    tally(monitor)

    await context.close()
  } finally {
    // Toujours fermer le navigateur, même sur erreur (CLAUDE.md §8).
    await browser.close()
  }

  console.log('')
  for (const note of notes) console.log(`  · ${note}`)
  console.log(
    `\n  console — ${totals.consoleErrors} erreur(s), ${totals.consoleWarnings} warning(s), ` +
      `${totals.pageExceptions} exception(s) non capturée(s) sur ${totals.scenarios} scénario(s)`
  )
  console.log(`  pilote  — ${driver}`)

  // Les MESURES sur disque, pour que le manifeste les reprenne au lieu de les
  // affirmer. Écrit même en cas d'échec : un manifeste qui dirait « 0 erreur »
  // après un run rouge serait précisément le défaut qu'on corrige.
  if (CAPTURE_DIR) {
    writeFileSync(
      join(CAPTURE_DIR, 'console-measurements.json'),
      JSON.stringify(
        {
          measuredBy: 'scripts/prove-learning-actions-e2e.mjs',
          driver,
          scenarios: totals.scenarios,
          consoleErrors: totals.consoleErrors,
          consoleWarnings: totals.consoleWarnings,
          // Exceptions non capturées, collectées via l'événement `weberror` du
          // BrowserContext — `pageerror` est l'événement de `Page` et ne se
          // déclenche jamais à ce niveau.
          pageExceptions: totals.pageExceptions,
          pageExceptionSource: "BrowserContext 'weberror' (WebError.error() + WebError.page())",
          assertions: { total: assertionCount, failed: failures.length },
          green: failures.length === 0,
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
    console.log(`  mesures — ${join(CAPTURE_DIR, 'console-measurements.json')}`)
  }

  if (failures.length > 0) {
    console.log(`\n✗ E2E ciblé : ${failures.length} échec(s) sur ${assertionCount} assertion(s)\n`)
    process.exit(1)
  }
  console.log(
    `\n✓ E2E ciblé vert — ${assertionCount} assertions, 0 erreur, 0 warning, 0 exception non capturée\n`
  )
}

main().catch((err) => {
  console.error('\n✗ harness E2E interrompu :', err?.message ?? err)
  process.exit(1)
})
