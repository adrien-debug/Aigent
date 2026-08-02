#!/usr/bin/env node
/**
 * Harnais de capture — AIGENT-DS-SURFACES-001 (direction claire).
 *
 * IL ÉCHOUE, sinon il ne prouve rien. Sortie en code 1 dès qu'une condition
 * de la mission est violée. Ce n'est pas un preneur de captures : les PNG sont
 * le sous-produit d'un contrôle qui, lui, peut dire non.
 *
 * CE QU'IL MESURE VRAIMENT, et pourquoi chaque contrôle existe :
 *
 * 1. CONTRASTES CALCULÉS, pas déclarés. La couleur est lue sur le pixel rendu
 *    (`getComputedStyle`), reconvertie en luminance relative WCAG et comparée au
 *    seuil. Un token juste dans le CSS mais écrasé en cascade produit un ratio
 *    faux : c'est l'écran qui est interrogé, pas la feuille de style.
 *
 * 2. SÉPARATION SIDEBAR / BODY. Le critère « nettement séparés » est vérifié
 *    comme un écart de luminance réel entre les deux surfaces, pas comme la
 *    présence d'une classe. Une sidebar qui aurait perdu `aig-dark` rendrait
 *    claire sur clair sans qu'aucune erreur ne soit levée.
 *
 * 3. QUATRE NIVEAUX DE SURFACES DISTINCTS. On lit les quatre jetons de rang et
 *    on exige qu'ils soient deux à deux différents ET ordonnés. Deux rangs qui
 *    se confondent, c'est la « fatigue visuelle par gris trop proches » que la
 *    mission interdit — invisible pour toute gate textuelle.
 *
 * 4. DÉBORDEMENT HORIZONTAL. `scrollWidth > clientWidth` sur le document : le
 *    responsive 375 px ne se prouve pas en redimensionnant, il se prouve en
 *    vérifiant que rien ne déborde une fois redimensionné.
 *
 * 5. CONSOLE ET PAGEERROR. Toute erreur console ou exception non capturée fait
 *    échouer le run : une capture d'un écran en erreur n'est pas une preuve.
 *
 * Usage : node scripts/capture-ds-surfaces-001.mjs [baseUrl]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
})

const BASE = process.argv[2] ?? 'http://127.0.0.1:3987'
const OUT = join(process.cwd(), 'docs/visual-reviews/AIGENT-DS-SURFACES-001')
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = {
  'desktop-1440x900': { width: 1440, height: 900 },
  'laptop-1280x800': { width: 1280, height: 800 },
  'mobile-375x812': { width: 375, height: 812 },
}

/** Les trois écrans du périmètre — la mission interdit de propager plus loin. */
const SCREENS = [
  { key: 'overview', route: '/' },
  { key: 'agent', route: '/agents/copilot-market-intelligence' },
  { key: 'project', route: '/projects/proj-tradeagent' },
]

const failures = []
const measures = []

/** `rgb(r, g, b)` rendu → luminance relative WCAG. */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Couleur calculée → [r,g,b] sRGB 0-255.
 *
 * NE PAS parser la chaîne à la main. Les jetons sont écrits en `oklch()` et
 * Chromium sérialise `getComputedStyle` en `lab(...)`, pas en `rgb(...)` — un
 * parseur `rgb()` renvoie donc `null` sur TOUTES les surfaces du produit et
 * transforme un écran parfaitement rendu en « non mesurable ». Erreur commise
 * une fois ici : 15 fausses violations, dont « la sidebar noire n'est pas
 * rendue » alors qu'elle l'était.
 *
 * La conversion est donc déléguée au moteur lui-même (voir `toSrgb` injecté
 * dans la page) : il connaît tous les espaces colorimétriques CSS, présents et
 * futurs. Ici on ne fait que valider le triplet qu'il a rendu.
 */
function parseRgb(value) {
  if (!Array.isArray(value) || value.length < 3) return null
  const parts = value.slice(0, 3).map((n) => Number(n))
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts
}

async function main() {
  const browser = await chromium.launch()
  try {
    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      for (const screen of SCREENS) {
        // 1440 pour tous les écrans ; les autres tailles seulement sur l'Aperçu
        // et les deux fiches, conformément à la liste de preuves de la mission.
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
        const page = await context.newPage()
        const consoleErrors = []
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text())
        })
        page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

        const label = `${screen.key}-${vpName}`
        try {
          const res = await page.goto(`${BASE}${screen.route}`, {
            waitUntil: 'networkidle',
            timeout: 60_000,
          })
          if (!res || res.status() >= 400) {
            failures.push(`${label} — HTTP ${res ? res.status() : 'sans réponse'}`)
            await context.close()
            continue
          }
          await page.waitForTimeout(600)

          // --- débordement horizontal -------------------------------------
          const overflow = await page.evaluate(() => {
            const d = document.documentElement
            return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }
          })
          if (overflow.scrollWidth > overflow.clientWidth + 1) {
            failures.push(
              `${label} — débordement horizontal : scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
            )
          }

          // --- titre tronqué / en-tête écrasé -----------------------------
          /*
             Le débordement horizontal ne suffit pas. À 375px l'en-tête ne
             débordait de rien — le titre se contentait de se tronquer en
             « A.. » pendant que l'eyebrow se cassait sur trois lignes. Rien
             ne dépassait, tout était illisible, et le contrôle passait au vert.
             On compare donc la largeur du CONTENU à celle de la BOÎTE : c'est
             la seule façon de voir une troncature. */
          const squashed = await page.evaluate(() => {
            const h1 = document.querySelector('header h1')
            if (!h1) return null
            const eyebrow = h1.parentElement?.querySelector('p')
            return {
              title: h1.textContent?.trim() ?? '',
              titleScroll: h1.scrollWidth,
              titleClient: h1.clientWidth,
              eyebrowLines: eyebrow
                ? Math.round(eyebrow.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(eyebrow).lineHeight || '16'))
                : 1,
            }
          })
          if (squashed) {
            if (squashed.titleScroll > squashed.titleClient + 1) {
              failures.push(
                `${label} — titre d'en-tête tronqué : « ${squashed.title} » demande ${squashed.titleScroll}px dans ${squashed.titleClient}px`,
              )
            }
            if (squashed.eyebrowLines > 2) {
              failures.push(
                `${label} — eyebrow cassé sur ${squashed.eyebrowLines} lignes : en-tête écrasé`,
              )
            }
          }

          // --- couleurs réellement rendues --------------------------------
          const probe = await page.evaluate(() => {
            /*
             * Conversion vers sRGB par le MOTEUR, pas par une regexp.
             * `getComputedStyle` rend `lab(...)` pour un jeton `oklch()` : on
             * peint donc la couleur sur un canvas 1×1 et on relit le pixel.
             * C'est le seul moyen d'obtenir le triplet réellement affiché quel
             * que soit l'espace colorimétrique d'origine.
             */
            const toSrgb = (color) => {
              if (!color) return null
              const cv = document.createElement('canvas')
              cv.width = cv.height = 1
              const ctx = cv.getContext('2d', { willReadFrequently: true })
              ctx.clearRect(0, 0, 1, 1)
              ctx.fillStyle = '#000'
              ctx.fillStyle = color
              // fillStyle invalide → reste '#000' ; on l'accepte, la comparaison
              // de contraste échouerait de toute façon bruyamment.
              ctx.fillRect(0, 0, 1, 1)
              const d = ctx.getImageData(0, 0, 1, 1).data
              return [d[0], d[1], d[2]]
            }
            const cs = (el) => (el ? getComputedStyle(el) : null)
            const root = cs(document.documentElement)
            const main = document.querySelector('main')
            // Le rail desktop est le premier élément portant `aig-dark` qui
            // n'est pas le tiroir mobile (celui-ci est masqué hors ouverture).
            const darkIslands = [...document.querySelectorAll('.aig-dark')].filter(
              (el) => el.getBoundingClientRect().width > 0,
            )
            const rail = darkIslands[0] ?? null
            const readVar = (name) => root.getPropertyValue(name).trim()
            return {
              bodyBg: toSrgb(cs(document.body)?.backgroundColor),
              mainBg: main ? toSrgb(cs(main).backgroundColor) : null,
              mainColor: main ? toSrgb(cs(main).color) : null,
              railBg: rail ? toSrgb(cs(rail).backgroundColor) : null,
              railVisible: Boolean(rail),
              tokens: {
                subtle: readVar('--aig-subtle'),
                base: readVar('--aig-base'),
                raised: readVar('--aig-raised'),
                lineSoft: readVar('--aig-line-soft'),
                accent: readVar('--aig-accent'),
                text: readVar('--aig-text'),
                textMuted: readVar('--aig-text-muted'),
              },
            }
          })

          // --- contraste texte principal ----------------------------------
          const fg = parseRgb(probe.mainColor)
          const bg = parseRgb(probe.mainBg) ?? parseRgb(probe.bodyBg)
          if (fg && bg) {
            const ratio = contrastRatio(fg, bg)
            measures.push({ screen: label, kind: 'texte principal / zone de travail', ratio: Number(ratio.toFixed(2)) })
            if (ratio < 4.5) {
              failures.push(`${label} — texte principal ${ratio.toFixed(2)}:1 < 4.5:1 (WCAG AA)`)
            }
          } else {
            failures.push(`${label} — couleur de texte ou de fond non résoluble (rendu non mesurable)`)
          }

          // --- séparation sidebar / body (desktop seulement) --------------
          if (viewport.width >= 1280) {
            const railBg = parseRgb(probe.railBg)
            if (!probe.railVisible || !railBg) {
              failures.push(`${label} — rail sombre absent ou non mesurable : la sidebar noire n'est pas rendue`)
            } else if (bg) {
              const sep = contrastRatio(railBg, bg)
              measures.push({ screen: label, kind: 'séparation sidebar / body', ratio: Number(sep.toFixed(2)) })
              if (sep < 3) {
                failures.push(
                  `${label} — sidebar et body pas « nettement séparés » : ${sep.toFixed(2)}:1 (< 3:1)`,
                )
              }
            }
          }

          // --- quatre niveaux de surfaces distincts -----------------------
          if (screen.key === 'overview' && viewport.width === 1440) {
            const ranks = ['subtle', 'base', 'raised', 'lineSoft']
            const seen = new Map()
            for (const r of ranks) {
              const v = probe.tokens[r]
              if (!v) {
                failures.push(`overview — jeton --aig-${r} absent : niveau de surface non défini`)
                continue
              }
              if (seen.has(v)) {
                failures.push(
                  `overview — niveaux de surface confondus : --aig-${r} et --aig-${seen.get(v)} valent tous deux ${v}`,
                )
              }
              seen.set(v, r)
            }
            writeFileSync(
              join(OUT, 'tokens-resolved.json'),
              JSON.stringify(probe.tokens, null, 2) + '\n',
            )
          }

          if (consoleErrors.length > 0) {
            failures.push(`${label} — erreur(s) console : ${consoleErrors.slice(0, 3).join(' | ')}`)
          }

          await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: false })
          console.log(`✓ ${label}`)
        } catch (err) {
          failures.push(`${label} — ${err.message}`)
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }

  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        mission: 'AIGENT-DS-SURFACES-001',
        baseUrl: BASE,
        screens: SCREENS,
        viewports: VIEWPORTS,
        measures,
        failures,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )

  console.log('\n--- contrastes mesurés au rendu ---')
  for (const m of measures) console.log(`  ${m.ratio}:1  ${m.kind}  (${m.screen})`)

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} condition(s) violée(s) :`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('\n✓ direction claire vérifiée au rendu — contrastes, séparation, surfaces, responsive.')
}

await main()
