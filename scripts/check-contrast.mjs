#!/usr/bin/env node
/**
 * Contrast gate — fails when RENDERED text falls under WCAG AA.
 *
 * ── Why this is not a grep ──────────────────────────────────────────────────
 * A static rule ("no `text-zinc-500`") is both wrong and useless here. Wrong,
 * because the same class passes on one plane and fails on another: zinc-500
 * measures 4.12 on the canvas (#09090b) and 3.24 on a raised inset (#232327) —
 * one class, two verdicts. Useless, because most of this dashboard's colour
 * never appears as a class at all: it arrives through `--color-*` tokens,
 * `color-mix()`, ring/overlay alphas stacked three deep, and `opacity` on an
 * ancestor. The only honest number is the one measured on the composited
 * pixels, so this gate drives a real browser and reads real computed styles.
 *
 * ── How the integrator runs it ──────────────────────────────────────────────
 *   1. Dev server already up on 3210 (never 3000 — see AGENTS.md).
 *   2. Capture + verdict in one pass (this LAUNCHES a browser):
 *        node scripts/check-contrast.mjs
 *   3. Keep the capture for a later re-verdict without a browser:
 *        node scripts/check-contrast.mjs --emit /tmp/contrast.json
 *        node scripts/check-contrast.mjs --input /tmp/contrast.json
 *
 * Useful flags:
 *   --base <url>        default http://localhost:3210
 *   --viewport <WxH>    default 1440x900 (repeatable: --viewport 390x844)
 *   --route <path>      replace the default route set (repeatable)
 *   --settle <ms>       default 1200, time given to the page before probing
 *   --json              machine-readable report on stdout
 *   --input <file>      verdict only, from a previous --emit (no browser)
 *   --emit <file>       write the raw capture next to the verdict
 *
 * Exit code is 0 only when every measured text node clears its threshold.
 *
 * ── Thresholds (WCAG 2.2 SC 1.4.3) ──────────────────────────────────────────
 * 3.0 for large text — >= 24px, or >= 18.66px at font-weight >= 700 — and 4.5
 * for everything else. The size is read off the rendered node, never guessed
 * from a class name.
 *
 * ── Measurement notes ───────────────────────────────────────────────────────
 * The in-page collector is a descendant of the audit probe used by
 * AIGENT-UI-AUDIT-025; the WCAG relative-luminance and alpha-compositing math
 * is that probe's, unchanged, because it is the part that was already proven
 * against hand-computed values.
 *
 * Two things it does that a naive reading of `getComputedStyle().color` does
 * not:
 *   - Colour parsing goes through a 1x1 canvas. Chromium serialises Tailwind v4
 *     tokens as `lab(47.8878 1.65477 -5.77283)` and `oklch(...)`, which no
 *     `rgba()` regex will ever match; painting the value and reading the pixel
 *     back gets sRGB for ANY colour function the browser accepts, including
 *     `color-mix()`.
 *   - `opacity` on the element or any ancestor multiplies into the foreground
 *     alpha. That is what makes a `data-disabled:opacity-50` control measurable
 *     at all: the class list still says `text-accent-300`, but the pixels are
 *     half way to the background.
 *
 * Known approximation, stated rather than hidden: the effective background is
 * composited from ancestor `background-color` values WITHOUT re-applying those
 * ancestors' own `opacity`. Every background plane in this dashboard sits on a
 * fully opaque element, so the two agree here; on a design that fades a whole
 * panel, this gate would read slightly optimistic. It never reads pessimistic,
 * so a PASS is not manufactured by the shortcut.
 */

import { readFile, writeFile } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_BASE = process.env.AIGENT_CONTRAST_BASE ?? 'http://localhost:3210'

/**
 * Reference routes. One per distinct surface family, not one per URL: the whole
 * point is to cover every PLANE the design system paints on (canvas, raised,
 * sunken, overlay, workspace) and every text role that rides on them.
 */
const DEFAULT_ROUTES = [
  ['dashboard', '/admin'],
  ['project-tradeagent', '/admin/projects/proj-tradeagent'],
  ['project-tradeagent-team', '/admin/projects/proj-tradeagent/team'],
  ['agent-overview', '/admin/agents/copilot-market-intelligence'],
  ['performance', '/admin/performance'],
  ['settings', '/admin/settings'],
]

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    viewports: [],
    routes: [],
    settle: 1200,
    json: false,
    input: null,
    emit: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      return value
    }
    if (arg === '--base') options.base = next()
    else if (arg === '--viewport') options.viewports.push(parseViewport(next()))
    else if (arg === '--route') options.routes.push(next())
    else if (arg === '--settle') options.settle = Number(next())
    else if (arg === '--json') options.json = true
    else if (arg === '--input') options.input = next()
    else if (arg === '--emit') options.emit = next()
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(readHelp())
      process.exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  if (options.viewports.length === 0) options.viewports = [[1440, 900]]
  if (!Number.isFinite(options.settle) || options.settle < 0) fail('--settle must be a positive number')
  return options
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) fail(`--viewport expects WxH, got "${value}"`)
  return [Number(match[1]), Number(match[2])]
}

function fail(message) {
  process.stderr.write(`check:contrast — ${message}\n`)
  process.exit(2)
}

function readHelp() {
  return [
    'Usage: node scripts/check-contrast.mjs [options]',
    '',
    '  --base <url>       default http://localhost:3210',
    '  --viewport <WxH>   default 1440x900, repeatable',
    '  --route <path>     replace the default route set, repeatable',
    '  --settle <ms>      default 1200',
    '  --json             machine-readable report',
    '  --input <file>     verdict from a previous capture, no browser',
    '  --emit <file>      write the raw capture',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// In-page collector
//
// Serialised into the page by Playwright, so it may close over NOTHING from
// this module. Returns one entry per distinct (colour, background, size,
// weight, selector) combination, with an occurrence count — a page renders the
// same failing pair hundreds of times and a per-node list is unreadable.
// ---------------------------------------------------------------------------

const COLLECT = function collectContrast() {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const colorCache = new Map()

  /**
   * Any CSS colour the browser accepts → sRGB + alpha, via a real paint.
   * `lab()`, `oklch()`, `color-mix()` and `color(display-p3 …)` all arrive here
   * from `getComputedStyle` in Chromium; none of them is regex-parseable.
   */
  function toRgba(value) {
    if (!value) return null
    const hit = colorCache.get(value)
    if (hit !== undefined) return hit
    // A value the canvas rejects leaves `fillStyle` at whatever it already was,
    // which would silently inherit the previous colour. Assigning it over TWO
    // different seeds tells the two cases apart exactly: a valid colour lands
    // on the same serialisation from either seed, a rejected one keeps both.
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    const fromBlack = ctx.fillStyle
    ctx.fillStyle = '#ffffff'
    ctx.fillStyle = value
    if (ctx.fillStyle !== fromBlack) {
      colorCache.set(value, null)
      return null
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    const out = { r, g, b, a: a / 255 }
    colorCache.set(value, out)
    return out
  }

  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  const composite = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  /** First fully opaque plane under `el`, with every translucent layer above it folded in. */
  function effectiveBackground(el) {
    let node = el
    let acc = null
    while (node) {
      const parsed = toRgba(getComputedStyle(node).backgroundColor)
      if (parsed && parsed.a > 0) {
        acc = acc ? composite(acc, parsed) : parsed
        if (acc.a >= 0.999) return acc
      }
      node = node.parentElement
    }
    // Root fallback: the app paints `--color-surface-canvas` on <body>, but a
    // node can be probed before that resolves. Reading the real body colour is
    // still better than assuming black.
    const body = toRgba(getComputedStyle(document.body).backgroundColor)
    if (body && body.a >= 0.999) return body
    return acc && acc.a >= 0.999 ? acc : { r: 0, g: 0, b: 0, a: 1 }
  }

  /** Product of `opacity` from `el` up to the root — what actually reaches the pixel. */
  function cumulativeOpacity(el) {
    let value = 1
    let node = el
    while (node && node !== document.documentElement) {
      const own = parseFloat(getComputedStyle(node).opacity)
      if (Number.isFinite(own)) value *= own
      node = node.parentElement
    }
    return value
  }

  function describe(el) {
    let out = el.tagName.toLowerCase()
    if (el.id) out += `#${el.id}`
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 6)
    if (classes.length) out += `.${classes.join('.')}`
    return out.slice(0, 200)
  }

  const findings = new Map()

  for (const el of document.querySelectorAll('body *')) {
    // Only elements that OWN visible text: a wrapper inherits its child's
    // colour and would triple-count the same pixels.
    const own = Array.from(el.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 1
    )
    if (own.length === 0) continue

    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue

    const rect = el.getBoundingClientRect()
    // `sr-only` collapses to a clipped 1x1 box. It is not rendered text and has
    // no contrast requirement; anything genuinely visible is larger than that.
    if (rect.width <= 1 || rect.height <= 1) continue

    const opacity = cumulativeOpacity(el)
    if (opacity < 0.05) continue

    const rawColor = toRgba(style.color)
    if (!rawColor) continue
    const alpha = rawColor.a * opacity
    // Fully transparent text (bg-clip-text, fade-out) paints no glyph.
    if (alpha < 0.05) continue

    const background = effectiveBackground(el)
    const foreground = composite({ ...rawColor, a: alpha }, background)
    const ratio = contrast(foreground, background)

    const fontSize = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700)
    const required = large ? 3 : 4.5
    if (ratio >= required) continue

    const selector = describe(el)
    const key = `${style.color}|${Math.round(background.r)},${Math.round(background.g)},${Math.round(background.b)}|${fontSize}|${weight}|${Math.round(opacity * 100)}|${selector}`
    const existing = findings.get(key)
    const sample = own.map((n) => n.textContent.trim()).join(' ').slice(0, 60)
    if (existing) {
      existing.count += 1
      if (existing.samples.length < 3 && !existing.samples.includes(sample)) existing.samples.push(sample)
      continue
    }
    findings.set(key, {
      ratio: Math.round(ratio * 100) / 100,
      required,
      fontSize,
      weight,
      opacity: Math.round(opacity * 100) / 100,
      color: style.color,
      background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
      selector,
      samples: [sample],
      count: 1,
    })
  }

  return {
    title: document.title,
    findings: Array.from(findings.values()).sort((a, b) => a.ratio - b.ratio),
  }
}

// ---------------------------------------------------------------------------
// Capture (browser) — skipped entirely in --input mode
// ---------------------------------------------------------------------------

async function capture(options) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    fail(
      'playwright is not installed. Either install it, or re-run with --input <capture.json> ' +
        'produced on a machine that has it.'
    )
  }

  const routes = options.routes.length
    ? options.routes.map((path) => [path, path])
    : DEFAULT_ROUTES

  const browser = await chromium.launch()
  const pages = []
  try {
    for (const [width, height] of options.viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: 'dark',
        // A reduced-motion context settles faster and, more importantly, is the
        // state a real fitness-for-purpose check should measure: nothing here
        // should depend on an animation having finished.
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      for (const [name, route] of routes) {
        const url = `${options.base}${route}`
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        const status = response ? response.status() : null
        await page.waitForTimeout(options.settle)
        try {
          await page.waitForLoadState('networkidle', { timeout: 6_000 })
        } catch {
          // A page that keeps a poll open never goes idle. Not an error: the
          // settle above already gave it time to paint.
        }
        const probe = await page.evaluate(COLLECT)
        pages.push({ name, route, viewport: [width, height], status, ...probe })
      }
      await context.close()
    }
  } finally {
    // RULE from AGENTS.md §7: a driven browser is ALWAYS closed, including on
    // the error path. A gate that leaves Chromium alive is worse than no gate.
    await browser.close()
  }
  return { base: options.base, capturedAt: new Date().toISOString(), pages }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function report(capture_, json) {
  const failing = capture_.pages.filter((page) => page.findings.length > 0)
  const glyphs = capture_.pages.reduce(
    (total, page) => total + page.findings.reduce((n, f) => n + f.count, 0),
    0
  )

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...capture_, glyphs }, null, 2)}\n`)
    return failing.length === 0
  }

  const lines = []
  for (const page of capture_.pages) {
    const measured = page.findings.reduce((n, f) => n + f.count, 0)
    const size = page.viewport.join('x')
    if (page.findings.length === 0) {
      lines.push(`PASS  ${page.name} @${size}  ${page.route}`)
      continue
    }
    lines.push(`FAIL  ${page.name} @${size}  ${page.route} — ${measured} glyph runs under AA`)
    for (const f of page.findings) {
      const opacity = f.opacity < 1 ? ` opacity=${f.opacity}` : ''
      lines.push(
        `        ${f.ratio.toFixed(2)} / ${f.required}  ${f.fontSize}px w${f.weight}${opacity}  x${f.count}`
      )
      lines.push(`        fg ${f.color}  on ${f.background}`)
      lines.push(`        ${f.selector}`)
      lines.push(`        e.g. ${f.samples.join(' | ')}`)
    }
  }
  lines.push('')
  lines.push(
    failing.length === 0
      ? `check:contrast PASS — ${capture_.pages.length} page renders, every text node clears WCAG AA.`
      : `check:contrast FAIL — ${glyphs} glyph runs under WCAG AA across ${failing.length} of ${capture_.pages.length} page renders.`
  )
  process.stdout.write(`${lines.join('\n')}\n`)
  return failing.length === 0
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const captured = options.input
    ? JSON.parse(await readFile(options.input, 'utf8'))
    : await capture(options)

  if (!Array.isArray(captured?.pages)) fail('capture has no `pages` array')
  if (options.emit) await writeFile(options.emit, `${JSON.stringify(captured, null, 2)}\n`)

  process.exit(report(captured, options.json) ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`check:contrast — ${error?.stack ?? error}\n`)
  process.exit(2)
})
