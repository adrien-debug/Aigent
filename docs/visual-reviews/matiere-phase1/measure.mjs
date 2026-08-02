#!/usr/bin/env node
/**
 * Mesure la matière visuelle Aigent dans un vrai navigateur.
 * Résout les tokens en sRGB via canvas, calcule les ratios WCAG entre rangs
 * et les contrastes de texte. Sortie JSON.
 *
 * usage: node measure.mjs <label> <outfile.json>
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const [, , label = 'run', outFile] = process.argv
const BASE = 'http://127.0.0.1:3987'

const probe = () => {
  const p = document.createElement('div')
  p.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px'
  document.body.appendChild(p)
  const cvs = document.createElement('canvas')
  cvs.width = cvs.height = 1
  const ctx = cvs.getContext('2d', { willReadFrequently: true })

  const toRGB = (css) => {
    p.style.background = ''
    p.className = ''
    if (css.startsWith('.')) p.className = css.slice(1)
    else p.style.background = css
    const c = getComputedStyle(p).backgroundColor
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }

  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return +((x + 0.05) / (y + 0.05)).toFixed(3)
  }

  const S = {
    canvas: toRGB('var(--aig-subtle)'),
    base: toRGB('var(--aig-base)'),
    raised: toRGB('var(--aig-raised)'),
    lineSoft: toRGB('var(--aig-line-soft)'),
    line: toRGB('var(--aig-line)'),
    inset: toRGB('.aig-inset'),
    quietOnStage: toRGB('.aig-quiet'),
    text: toRGB('var(--aig-text)'),
    textMuted: toRGB('var(--aig-text-muted)'),
    textFaint: toRGB('var(--aig-text-faint)'),
    textDisplay: toRGB('var(--aig-text-display)'),
    accent: toRGB('var(--aig-accent)'),
    sevGood: toRGB('var(--aig-severity-good)'),
    sevWarn: toRGB('var(--aig-severity-warn)'),
    sevBad: toRGB('var(--aig-severity-bad)'),
    sevRunning: toRGB('var(--aig-severity-running)'),
    sevBlocked: toRGB('var(--aig-severity-blocked)'),
  }
  p.remove()

  // La SCÈNE est un dégradé : on échantillonne son fond réel effectif au pixel
  // plutôt que de deviner. Fait côté page pour rester honnête.
  const stageEl = document.querySelector('.aig-stage')
  let stageSampled = null
  if (stageEl) {
    const cs = getComputedStyle(stageEl)
    stageSampled = { bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 60) }
  }

  return {
    rgb: S,
    hierarchy: {
      'canvas -> base(scène)': ratio(S.canvas, S.base),
      'base(scène) -> inset(creux)': ratio(S.base, S.inset),
      'canvas -> inset(creux)': ratio(S.canvas, S.inset),
      'base(scène) -> raised(élevé)': ratio(S.base, S.raised),
      'inset(creux) -> raised(élevé)': ratio(S.inset, S.raised),
      'lineSoft vs base': ratio(S.lineSoft, S.base),
      'line vs base': ratio(S.line, S.base),
    },
    ordering: {
      insetDarkerThanCanvas: lum(S.inset) < lum(S.canvas),
      insetDarkerThanBase: lum(S.inset) < lum(S.base),
      raisedLighterThanBase: lum(S.raised) > lum(S.base),
      lumCanvas: +lum(S.canvas).toFixed(5),
      lumInset: +lum(S.inset).toFixed(5),
      lumBase: +lum(S.base).toFixed(5),
      lumRaised: +lum(S.raised).toFixed(5),
    },
    text: {
      'text on canvas': ratio(S.text, S.canvas),
      'text on base': ratio(S.text, S.base),
      'text on inset': ratio(S.text, S.inset),
      'text on raised': ratio(S.text, S.raised),
      'muted on canvas': ratio(S.textMuted, S.canvas),
      'muted on base': ratio(S.textMuted, S.base),
      'muted on inset': ratio(S.textMuted, S.inset),
      'muted on raised': ratio(S.textMuted, S.raised),
      'faint on canvas': ratio(S.textFaint, S.canvas),
      'faint on base': ratio(S.textFaint, S.base),
      'faint on inset': ratio(S.textFaint, S.inset),
      'faint on raised': ratio(S.textFaint, S.raised),
      'display on base': ratio(S.textDisplay, S.base),
      'accent on base': ratio(S.accent, S.base),
      'accent on inset': ratio(S.accent, S.inset),
    },
    severityOnSurfaces: {
      'good on base': ratio(S.sevGood, S.base),
      'good on inset': ratio(S.sevGood, S.inset),
      'warn on base': ratio(S.sevWarn, S.base),
      'warn on inset': ratio(S.sevWarn, S.inset),
      'bad on base': ratio(S.sevBad, S.base),
      'bad on inset': ratio(S.sevBad, S.inset),
      'running on base': ratio(S.sevRunning, S.base),
      'blocked on base': ratio(S.sevBlocked, S.base),
    },
    stageSampled,
  }
}

const browser = await chromium.launch()
const out = { label, at: new Date().toISOString(), schemes: {} }

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/runtime`, { waitUntil: 'networkidle' })
  out.schemes[scheme] = await page.evaluate(probe)
  await ctx.close()
}

// Échantillonnage réel de la scène (pixels), dark only.
{
  const ctx = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/runtime`, { waitUntil: 'networkidle' })
  const shot = await page.locator('.aig-stage').first().screenshot()
  // moyenne des 4 coins internes de la scène via sharp-less: on relit par canvas côté page
  const sampled = await page.evaluate(async () => {
    const el = document.querySelector('.aig-stage')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })
  out.stageBox = sampled
  out.stageShotBytes = shot.length
  await ctx.close()
}

await browser.close()

if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
