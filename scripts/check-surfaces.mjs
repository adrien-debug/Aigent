#!/usr/bin/env node
/**
 * Surface gate — fails when a rendered plane contains an element of the SAME
 * plane (a raised card inside a raised card, a sunken well inside a sunken
 * well, an overlay over an overlay).
 *
 * ── Why this cannot be a grep ───────────────────────────────────────────────
 * The defect is never written in one file. `Section` paints `surfaceRaised`;
 * `EmptyStatePanel` paints `surfaceRaised`; both are correct on their own, and
 * the bug only exists in the third file that mounts the second inside the
 * first. That is exactly how five doubled panels shipped: the callers even
 * passed `className="border-0 bg-transparent"` to cancel the second plane, the
 * string landed on a content div that had neither a border nor a background,
 * and the ring + shadow + rounded fill kept painting a card inside a card while
 * the source looked deliberate. No per-file rule sees any of this; only the
 * composed DOM does.
 *
 * The visual cost is not cosmetic: the planes of this design system are three
 * steps of one ladder (#0d0d10 sunken → #1a1a1e raised → #232327 overlay).
 * Stacking a step on itself repeats the ring and the shadow at the same
 * elevation, so depth stops encoding hierarchy — everything reads as "one level
 * down" from something, and nothing reads as the level it actually is.
 *
 * ── How the integrator runs it ─────────────────────────────────────────────
 *   1. Dev server up on 3210 (never 3000 — see AGENTS.md).
 *   2. node scripts/check-surfaces.mjs            → verdict (LAUNCHES a browser)
 *   3. node scripts/check-surfaces.mjs --probe-nesting
 *      Self-test. Injects, in the live DOM, a clone of a raised plane INSIDE
 *      that same raised plane — the EmptyStatePanel-in-Section shape, rebuilt
 *      on the real page — and exits 0 only if the gate reported it on every
 *      route. A gate that cannot be made to fail is not a gate; run this
 *      whenever the detection logic is touched.
 *
 * Flags mirror check-contrast.mjs (same capture/verdict split):
 *   --base <url>        default http://localhost:3210
 *   --viewport <WxH>    default 1440x900 (repeatable)
 *   --route <path>      replace the default route set (repeatable)
 *   --settle <ms>       default 1200
 *   --json              machine-readable report
 *   --input <file>      verdict only, from a previous --emit (no browser)
 *   --emit <file>       write the raw capture next to the verdict
 *
 * ── Anti-tautology ─────────────────────────────────────────────────────────
 * A route that renders ZERO plane elements fails the gate as loudly as a
 * violation. Every admin route paints planes; measuring none means the page did
 * not render (redirect, error boundary, auth wall) and the green would be
 * manufactured by an empty measurement, not earned.
 */

import { readFile, writeFile } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_BASE = process.env.AIGENT_SURFACES_BASE ?? 'http://localhost:3210'

/** One route per composition family — every page that stacks panels for a living. */
const DEFAULT_ROUTES = [
  ['dashboard', '/admin'],
  ['factory', '/admin/factory'],
  ['factory-tools', '/admin/factory/tools'],
  ['projects', '/admin/projects'],
  ['project-tradeagent', '/admin/projects/proj-tradeagent'],
  ['agents', '/admin/agents'],
  ['performance', '/admin/performance'],
  ['telemetry', '/admin/telemetry'],
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
    probe: false,
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
    else if (arg === '--probe-nesting') options.probe = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(readHelp())
      process.exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  if (options.viewports.length === 0) options.viewports = [[1440, 900]]
  if (!Number.isFinite(options.settle) || options.settle < 0) fail('--settle must be a positive number')
  if (options.probe && options.input) fail('--probe-nesting needs a browser, it cannot run from --input')
  return options
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) fail(`--viewport expects WxH, got "${value}"`)
  return [Number(match[1]), Number(match[2])]
}

function fail(message) {
  process.stderr.write(`check:surfaces — ${message}\n`)
  process.exit(2)
}

function readHelp() {
  return [
    'Usage: node scripts/check-surfaces.mjs [options]',
    '',
    '  --base <url>       default http://localhost:3210',
    '  --viewport <WxH>   default 1440x900, repeatable',
    '  --route <path>     replace the default route set, repeatable',
    '  --settle <ms>      default 1200',
    '  --json             machine-readable report',
    '  --input <file>     verdict from a previous capture, no browser',
    '  --emit <file>      write the raw capture',
    '  --probe-nesting    self-test: inject a same-plane nesting, expect a FAIL',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// In-page injection — the red probe
//
// Rebuilds the real defect in the live DOM: a clone of a raised plane appended
// INSIDE that same raised plane. Same class list, so the same paint path; the
// gate has no way to tell it apart from a hand-written doubled panel, which is
// the whole point.
// ---------------------------------------------------------------------------

const INJECT_NESTING = function injectNesting() {
  const host = Array.from(document.querySelectorAll('[class]')).find((el) =>
    (el.getAttribute('class') || '')
      .split(/\s+/)
      .some((token) => token === 'dark:bg-surface-raised' || token === 'bg-surface-raised')
  )
  if (!host) return { injected: false }
  const clone = document.createElement('div')
  clone.setAttribute('class', host.getAttribute('class'))
  clone.setAttribute('data-surface-probe', 'injected')
  clone.textContent = 'surface probe'
  host.appendChild(clone)
  return { injected: true }
}

// ---------------------------------------------------------------------------
// In-page collector
//
// Serialised into the page by Playwright, so it may close over NOTHING from
// this module.
// ---------------------------------------------------------------------------

const COLLECT = function collectSurfaces() {
  /**
   * The plane an element paints, or null.
   *
   * Matched on the CLASS TOKEN, not on the computed background colour: the
   * colour of `surface-raised` and the colour a translucent tint happens to
   * composite to can coincide, and only the token states the design intent
   * ("this is the raised plane"). Exact token equality also rules out, on
   * purpose, the two things that are NOT a plane:
   *   - `bg-surface-raised-hover` — a transient state, painted under the cursor
   *     only, never a stacked surface;
   *   - `bg-surface-sunken/60` and friends — a translucent tint of a plane,
   *     deliberately used to shade a zone INSIDE its own plane.
   * `dark:` is the only variant accepted: a plane behind `hover:` or `md:` is
   * conditional, and a conditional plane is not what the ladder encodes.
   */
  function planeOf(el) {
    const raw = el.getAttribute('class')
    if (!raw) return null
    for (const token of raw.split(/\s+/)) {
      const bare = token.startsWith('dark:') ? token.slice(5) : token
      if (bare === 'bg-surface-raised') return 'raised'
      if (bare === 'bg-surface-sunken') return 'sunken'
      if (bare === 'bg-surface-overlay') return 'overlay'
      const arbitrary = /^bg-\[var\(--color-surface-(raised|sunken|overlay)\)\]$/.exec(bare)
      if (arbitrary) return arbitrary[1]
    }
    return null
  }

  function describe(el) {
    let out = el.tagName.toLowerCase()
    if (el.hasAttribute('data-surface-probe')) out += '[data-surface-probe]'
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 5)
    if (classes.length) out += `.${classes.join('.')}`
    return out.slice(0, 200)
  }

  /** First readable label inside the element — what a human needs to find it on screen. */
  function label(el) {
    const heading = el.querySelector('h1, h2, h3, h4')
    const text = (heading ?? el).textContent || ''
    return text.replace(/\s+/g, ' ').trim().slice(0, 70)
  }

  const violations = new Map()
  let planes = 0

  for (const el of document.querySelectorAll('body *')) {
    const plane = planeOf(el)
    if (!plane) continue

    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const rect = el.getBoundingClientRect()
    // A collapsed box paints nothing. The mobile shell is in the DOM at desktop
    // widths; counting it would report a nesting no one can see.
    if (rect.width <= 1 || rect.height <= 1) continue

    planes += 1

    let ancestor = el.parentElement
    while (ancestor && ancestor !== document.body) {
      if (planeOf(ancestor) === plane) break
      ancestor = ancestor.parentElement
    }
    if (!ancestor || ancestor === document.body) continue

    const key = `${plane}|${describe(el)}|${describe(ancestor)}`
    const existing = violations.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    violations.set(key, {
      plane,
      inner: describe(el),
      outer: describe(ancestor),
      innerLabel: label(el),
      outerLabel: label(ancestor),
      injected: el.hasAttribute('data-surface-probe'),
      count: 1,
    })
  }

  return {
    title: document.title,
    planes,
    violations: Array.from(violations.values()),
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

  const routes = options.routes.length ? options.routes.map((path) => [path, path]) : DEFAULT_ROUTES

  const browser = await chromium.launch()
  const pages = []
  try {
    for (const [width, height] of options.viewports) {
      const context = await browser.newContext({
        viewport: { width, height },
        // The planes are dark-mode tokens; a light-mode capture measures a
        // different ladder and would silently miss every `dark:` plane.
        colorScheme: 'dark',
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
          // A page holding a poll open never goes idle; the settle above already
          // gave it time to paint.
        }
        const injected = options.probe ? await page.evaluate(INJECT_NESTING) : { injected: false }
        const probe = await page.evaluate(COLLECT)
        pages.push({ name, route, viewport: [width, height], status, probed: injected.injected, ...probe })
      }
      await context.close()
    }
  } finally {
    // RULE from the global doctrine §6: a driven browser is ALWAYS closed,
    // including on the error path.
    await browser.close()
  }
  return { base: options.base, capturedAt: new Date().toISOString(), probe: options.probe, pages }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function report(captured, options) {
  const probe = Boolean(captured.probe)
  const lines = []
  let failed = false

  for (const page of captured.pages) {
    const size = page.viewport.join('x')
    const injectedHits = page.violations.filter((v) => v.injected).length
    const realHits = page.violations.filter((v) => !v.injected)

    if (page.planes === 0) {
      failed = true
      lines.push(`FAIL  ${page.name} @${size}  ${page.route} — 0 surface planes measured (page did not render?)`)
      continue
    }
    if (probe && injectedHits === 0) {
      failed = true
      lines.push(
        `FAIL  ${page.name} @${size}  ${page.route} — probe injected a same-plane nesting and the gate did NOT see it`
      )
    }

    if (realHits.length === 0) {
      if (!probe) lines.push(`PASS  ${page.name} @${size}  ${page.route} — ${page.planes} planes, none stacked on itself`)
      else if (injectedHits > 0) lines.push(`PROBE ${page.name} @${size}  ${page.route} — injected nesting caught`)
      continue
    }

    failed = true
    lines.push(`FAIL  ${page.name} @${size}  ${page.route} — ${realHits.length} same-plane nesting(s) of ${page.planes} planes`)
    for (const v of realHits) {
      lines.push(`        ${v.plane} inside ${v.plane}  x${v.count}`)
      lines.push(`        inner  ${v.inner}`)
      lines.push(`               “${v.innerLabel}”`)
      lines.push(`        outer  ${v.outer}`)
      lines.push(`               “${v.outerLabel}”`)
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...captured, failed }, null, 2)}\n`)
    return !failed
  }

  lines.push('')
  if (probe) {
    lines.push(
      failed
        ? 'check:surfaces PROBE FAILED — the gate did not catch an injected same-plane nesting (or the page is already broken).'
        : `check:surfaces PROBE PASSED — every one of ${captured.pages.length} routes reported the injected nesting.`
    )
  } else {
    lines.push(
      failed
        ? 'check:surfaces FAIL — a plane contains an element of the same plane; depth no longer encodes hierarchy.'
        : `check:surfaces PASS — ${captured.pages.length} routes, no plane stacked on itself.`
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return !failed
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const captured = options.input ? JSON.parse(await readFile(options.input, 'utf8')) : await capture(options)

  if (!Array.isArray(captured?.pages)) fail('capture has no `pages` array')
  if (options.emit) await writeFile(options.emit, `${JSON.stringify(captured, null, 2)}\n`)

  process.exit(report(captured, options) ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`check:surfaces — ${error?.stack ?? error}\n`)
  process.exit(2)
})
