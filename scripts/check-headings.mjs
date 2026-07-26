#!/usr/bin/env node
/**
 * Heading-hierarchy gate — fails when the RENDERED admin outline is not a
 * legal document outline.
 *
 * ── Why this cannot be a grep ───────────────────────────────────────────────
 * The dashboard never writes `<h2>`. It writes `<Section title=…>`, which
 * writes `<Subheading level={2}>`, which writes the tag; and `<EmptyState>`,
 * which writes its own `<Subheading>` with the level it happens to default to.
 * The rank a user's screen reader announces is therefore the product of three
 * components composed at runtime, and no static rule over the call sites can
 * see it. Worse, the interesting defect is RELATIVE — an empty state announced
 * at the same rank as the card that contains it reads, to a screen reader, as a
 * sibling section rather than as "this section has nothing in it". You only
 * find that by looking at the outline the browser actually built.
 *
 * So this gate drives a real browser, exactly like `check:contrast`, and reuses
 * that script's route set / capture / `--emit` / `--input` shape so the two
 * behave the same way for whoever runs them. Rule 3 below is the one part that
 * IS static, and it runs with or without a browser.
 *
 * ── How the integrator runs it ──────────────────────────────────────────────
 *   1. Dev server already up on 3210 (never 3000 — see AGENTS.md).
 *   2. Full verdict, static + rendered (this LAUNCHES a browser):
 *        node scripts/check-headings.mjs
 *   3. Static rule only, no server, no browser (safe in any CI stage):
 *        node scripts/check-headings.mjs --static-only
 *   4. Rendered rules alone, rule 3 not evaluated (DIAGNOSIS, not the CI call —
 *      useful while another lot is still migrating the raw tags):
 *        node scripts/check-headings.mjs --rendered-only
 *   5. Keep the capture for a later re-verdict without a browser:
 *        node scripts/check-headings.mjs --emit /tmp/headings.json
 *        node scripts/check-headings.mjs --input /tmp/headings.json
 *
 * Exit codes: 0 clean · 1 at least one heading violation · 2 the gate could not
 * run (no browser, route did not render, capture unusable). 2 is never silently
 * turned into 0 — a gate that cannot look must not report a pass.
 *
 * ── The four rules ──────────────────────────────────────────────────────────
 * 1. Exactly ONE h1 inside <main>, per route. Zero is as broken as two: zero
 *    leaves the page unnamed in a heading-list navigation, two make "the page
 *    title" ambiguous.
 * 2. No rank skip in document order (h1 then h3). Going back UP is always legal
 *    (h3 then h2 closes a subsection and opens the next section).
 * 3. No raw <h1>..<h6> in the dashboard scope outside the primitives. Static,
 *    and deliberately kept alongside the rendered rules: rules 1/2/4 only see
 *    the routes that were rendered, so a hand-written heading on a page nobody
 *    listed here would otherwise be invisible. Same scope as check:catalyst.
 * 4. An empty-state heading must rank BELOW the heading of the block that
 *    contains it. Detection is structural, not by component name: an empty
 *    state in this DS is a centered message block standing in for absent
 *    content (`EmptyState` → `mx-auto max-w-md text-center`), so the gate asks
 *    the browser for `text-align: center` on the heading's ancestors rather
 *    than matching a class string — a bespoke empty state built with different
 *    classes but the same centered grammar is caught too. Stated limit: an
 *    empty state that is NOT centered is not seen by this rule (a false
 *    negative, never a false positive).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const DEFAULT_BASE = process.env.AIGENT_HEADINGS_BASE ?? process.env.AIGENT_CONTRAST_BASE ?? 'http://localhost:3210'

/**
 * Dynamic routes need a real id, so they stay a curated list — the same six
 * surfaces `check:contrast` pins, for the same reason (one entry per surface
 * family, not one per URL). Everything static is DISCOVERED from the app
 * directory instead, so a new admin page is covered the day it lands rather
 * than the day someone remembers to add it here.
 */
const CURATED_DYNAMIC_ROUTES = [
  ['project-tradeagent', '/admin/projects/proj-tradeagent'],
  ['project-tradeagent-team', '/admin/projects/proj-tradeagent/team'],
  ['agent-overview', '/admin/agents/copilot-market-intelligence'],
]

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    viewport: [1440, 900],
    routes: [],
    settle: 1200,
    json: false,
    input: null,
    emit: null,
    staticOnly: false,
    renderedOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      return value
    }
    if (arg === '--base') options.base = next()
    else if (arg === '--viewport') options.viewport = parseViewport(next())
    else if (arg === '--route') options.routes.push(next())
    else if (arg === '--settle') options.settle = Number(next())
    else if (arg === '--json') options.json = true
    else if (arg === '--input') options.input = next()
    else if (arg === '--emit') options.emit = next()
    else if (arg === '--static-only') options.staticOnly = true
    else if (arg === '--rendered-only') options.renderedOnly = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(readHelp())
      process.exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  if (!Number.isFinite(options.settle) || options.settle < 0) fail('--settle must be a positive number')
  return options
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) fail(`--viewport expects WxH, got "${value}"`)
  return [Number(match[1]), Number(match[2])]
}

function fail(message) {
  process.stderr.write(`check:headings — ${message}\n`)
  process.exit(2)
}

function readHelp() {
  return [
    'Usage: node scripts/check-headings.mjs [options]',
    '',
    '  --base <url>       default http://localhost:3210',
    '  --viewport <WxH>   default 1440x900',
    '  --route <path>     replace the discovered route set, repeatable',
    '  --settle <ms>      default 1200',
    '  --json             machine-readable report',
    '  --static-only      rule 3 only: no server, no browser',
    '  --rendered-only    rules 1/2/4 only — diagnosis, NOT the CI entry point',
    '  --input <file>     verdict from a previous capture, no browser',
    '  --emit <file>      write the raw capture',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Rule 3 — static: no raw heading tags in the dashboard scope
//
// Same scope as check:catalyst (src/app/admin, components/agent-ops,
// components/views, components/shell), same exclusion (components/ui owns the
// native markup). Kept in sync by intent, not by import: check-catalyst.mjs
// exports nothing, and giving it an export surface just for this would make one
// gate able to break the other.
// ---------------------------------------------------------------------------

const DASHBOARD_DIRS = [
  join('app', 'admin'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]
const EXCLUDE_DIRS = [join('components', 'ui')]
const RAW_HEADING_RE = /<(h[1-6])(?=[\s/>]|$)/g

function isDashboardFile(relPath) {
  return DASHBOARD_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

function isExcluded(relPath) {
  return EXCLUDE_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

function lineIsComment(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.includes('{/*')
}

async function scanRawHeadings() {
  const violations = []
  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (!isDashboardFile(rel) || isExcluded(rel)) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (lineIsComment(line)) return
      RAW_HEADING_RE.lastIndex = 0
      let m
      while ((m = RAW_HEADING_RE.exec(line))) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          tag: m[1],
          text: line.trim().slice(0, 120),
        })
      }
    })
  }
  return violations
}

// ---------------------------------------------------------------------------
// Route discovery
//
// Same idea as check:contrast's curated list, but the static half is read off
// the App Router tree so it cannot go stale. Route groups `(x)` disappear from
// the URL; anything with a `[param]` segment is skipped here and covered by the
// curated list above, which carries real ids.
// ---------------------------------------------------------------------------

async function discoverStaticRoutes() {
  const adminDir = join(SRC, 'app', 'admin')
  const routes = []
  for await (const file of walk(adminDir)) {
    if (!/(^|[\\/])page\.tsx$/.test(file)) continue
    const segments = relative(join(SRC, 'app'), file)
      .split(/[\\/]/)
      .slice(0, -1)
      .filter((segment) => !/^\(.*\)$/.test(segment))
    if (segments.some((segment) => segment.includes('['))) continue
    const route = '/' + segments.join('/')
    routes.push([segments.join('-') || 'admin', route])
  }
  routes.sort((a, b) => a[1].localeCompare(b[1]))
  return routes
}

// ---------------------------------------------------------------------------
// In-page collector
//
// Serialised into the page by Playwright, so it may close over NOTHING from
// this module. Returns a FLAT, document-ordered heading list: every rule below
// is expressible on that list plus one derived field (`centeredBlock`), which
// keeps `--input` re-verdicts honest — the verdict never needs a DOM the
// capture did not record.
// ---------------------------------------------------------------------------

const COLLECT = function collectHeadings() {
  const mains = document.querySelectorAll('main')
  const root = mains[0] ?? null
  if (!root) return { mainCount: 0, headings: [] }

  const describe = (el) => {
    let out = el.tagName.toLowerCase()
    if (el.id) out += `#${el.id}`
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 5)
    if (classes.length) out += `.${classes.join('.')}`
    return out.slice(0, 160)
  }

  /**
   * Removed from the accessibility tree ⇒ not a heading for anyone. `display:
   * none` / `visibility: hidden` / `aria-hidden` all qualify. Note what is NOT
   * here: a zero-size box. `sr-only` collapses to a clipped 1x1 rect and is a
   * perfectly real heading — dropping it would let a page "lose" its h1 and
   * still pass.
   */
  const isHiddenFromAssistiveTech = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return true
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return true
      node = node.parentElement
    }
    return false
  }

  /**
   * Nearest ancestor that centres its text, identified by a stable key so two
   * headings inside the SAME centered block can be told apart from two headings
   * in two different ones. `root` itself is excluded: a page-wide centered
   * layout is a layout, not an empty state.
   */
  const centeredAncestorKey = (el) => {
    let node = el.parentElement
    while (node && node !== root && node !== document.documentElement) {
      if (getComputedStyle(node).textAlign === 'center') {
        if (!node.dataset.headingBlockKey) {
          node.dataset.headingBlockKey = `block-${++centeredAncestorKey.counter}`
        }
        return { key: node.dataset.headingBlockKey, selector: describe(node) }
      }
      node = node.parentElement
    }
    return null
  }
  centeredAncestorKey.counter = 0

  const nodes = root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')
  const headings = []
  for (const el of nodes) {
    if (isHiddenFromAssistiveTech(el)) continue
    // `role="heading"` overrides the tag for assistive tech, so the announced
    // rank comes from aria-level when present — that is the rank a user hears.
    const ariaLevel = Number(el.getAttribute('aria-level'))
    const tagLevel = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName.slice(1)) : null
    const level = Number.isInteger(ariaLevel) && ariaLevel >= 1 && ariaLevel <= 6 ? ariaLevel : tagLevel
    if (!level) continue
    const centered = centeredAncestorKey(el)
    headings.push({
      level,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      selector: describe(el),
      centeredBlock: centered ? centered.key : null,
      centeredSelector: centered ? centered.selector : null,
    })
  }

  return { mainCount: mains.length, headings }
}

// ---------------------------------------------------------------------------
// Capture (browser) — skipped entirely in --input / --static-only mode
// ---------------------------------------------------------------------------

async function capture(options, routes) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    fail(
      'playwright is not installed. Either install it, or re-run with --input <capture.json> ' +
        'produced on a machine that has it, or --static-only for rule 3 alone.'
    )
  }

  const [width, height] = options.viewport
  const browser = await chromium.launch()
  const pages = []
  try {
    const context = await browser.newContext({
      viewport: { width, height },
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
        // A page holding a poll open never goes idle. The settle above already
        // gave it time to paint; this is not an error.
      }
      const probe = await page.evaluate(COLLECT)
      pages.push({ name, route, viewport: [width, height], status, ...probe })
    }
    await context.close()
  } finally {
    // RULE from the global doctrine §6: a driven browser is ALWAYS closed,
    // including on the error path.
    await browser.close()
  }
  return { base: options.base, capturedAt: new Date().toISOString(), pages }
}

// ---------------------------------------------------------------------------
// Verdict — rules 1, 2 and 4, computed from the capture alone
// ---------------------------------------------------------------------------

function auditPage(page) {
  const problems = []
  const headings = Array.isArray(page.headings) ? page.headings : []

  if (page.status !== null && page.status !== undefined && page.status >= 400) {
    problems.push({ rule: 'render', message: `route returned HTTP ${page.status} — nothing to audit`, fatal: true })
    return problems
  }
  if (page.mainCount === 0) {
    problems.push({ rule: 'render', message: 'no <main> element — the page never mounted the admin shell', fatal: true })
    return problems
  }
  if (page.mainCount > 1) {
    problems.push({ rule: 1, message: `${page.mainCount} <main> elements — "the page heading" is ambiguous` })
  }

  // Rule 1 — exactly one h1 in main.
  const h1s = headings.filter((h) => h.level === 1)
  if (h1s.length !== 1) {
    problems.push({
      rule: 1,
      message:
        h1s.length === 0
          ? 'no h1 in <main> — the page is unnamed in a heading-list navigation'
          : `${h1s.length} h1 in <main>: ${h1s.map((h) => JSON.stringify(h.text)).join(', ')}`,
    })
  }

  // Rule 2 — no rank skip in document order. Going back up is always legal.
  for (let i = 1; i < headings.length; i++) {
    const previous = headings[i - 1]
    const current = headings[i]
    if (current.level > previous.level + 1) {
      problems.push({
        rule: 2,
        message: `h${previous.level} ${JSON.stringify(previous.text)} → h${current.level} ${JSON.stringify(current.text)} skips h${previous.level + 1}`,
        selector: current.selector,
      })
    }
  }

  // Rule 4 — an empty-state heading must rank below the heading of the block
  // that contains it. `enclosing` is the last heading in document order that is
  // in NO centered block: for a card, that is the card's own title, which is
  // exactly the rank the empty state must not match. Skipping OTHER centered
  // headings matters — a page with two empty states in a row would otherwise
  // compare one empty state against another and name the wrong block.
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i]
    if (!current.centeredBlock) continue
    let enclosing = null
    for (let j = i - 1; j >= 0; j--) {
      if (!headings[j].centeredBlock) {
        enclosing = headings[j]
        break
      }
    }
    if (!enclosing) continue
    if (current.level <= enclosing.level) {
      problems.push({
        rule: 4,
        message: `empty-state heading h${current.level} ${JSON.stringify(current.text)} is not below its block title h${enclosing.level} ${JSON.stringify(enclosing.text)}`,
        selector: current.selector,
      })
    }
  }

  return problems
}

function report({ captured, rawHeadings, json, staticOnly, renderedOnly }) {
  const audited = captured
    ? captured.pages.map((page) => ({ ...page, problems: auditPage(page) }))
    : []
  const fatal = audited.some((page) => page.problems.some((p) => p.fatal))
  const renderedFailures = audited.reduce((n, page) => n + page.problems.length, 0)
  const totalFailures = renderedFailures + rawHeadings.length

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ base: captured?.base ?? null, staticOnly, rawHeadings, pages: audited, totalFailures }, null, 2)}\n`
    )
    return { ok: totalFailures === 0, fatal }
  }

  const lines = []
  for (const page of audited) {
    if (page.problems.length === 0) {
      lines.push(`PASS  ${page.name}  ${page.route} — ${page.headings.length} headings, outline legal`)
      continue
    }
    lines.push(`FAIL  ${page.name}  ${page.route}`)
    for (const problem of page.problems) {
      lines.push(`        [rule ${problem.rule}] ${problem.message}`)
      if (problem.selector) lines.push(`                 ${problem.selector}`)
    }
    lines.push(`        outline: ${page.headings.map((h) => `h${h.level}`).join(' ') || '(none)'}`)
  }

  if (rawHeadings.length > 0) {
    lines.push('')
    lines.push(`FAIL  [rule 3] ${rawHeadings.length} raw heading tag(s) in the dashboard scope (use Heading/Subheading):`)
    for (const v of rawHeadings) lines.push(`        ${v.file}:${v.line}  <${v.tag}>  ${v.text}`)
  }

  lines.push('')
  if (totalFailures === 0) {
    if (staticOnly) lines.push('check:headings PASS — rule 3 only (static): no raw heading tag in the dashboard scope.')
    else if (renderedOnly) lines.push(`check:headings PASS — rules 1/2/4 only: ${audited.length} page renders, legal outline (rule 3 NOT evaluated).`)
    else lines.push(`check:headings PASS — ${audited.length} page renders, one h1 each, no rank skip, no empty state at section rank, no raw heading tag.`)
  } else {
    lines.push(`check:headings FAIL — ${totalFailures} heading violation(s).`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return { ok: totalFailures === 0, fatal }
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.staticOnly && (options.input || options.emit)) {
    fail('--static-only cannot be combined with --input/--emit (there is nothing to capture)')
  }
  if (options.staticOnly && options.renderedOnly) fail('--static-only and --rendered-only are exclusive')

  // `--rendered-only` exists so the rendered rules can be exercised against a
  // fixture (or a half-migrated tree) without the static rule's verdict mixed
  // in. It is a DIAGNOSIS flag: `npm run check:headings` passes no flag, so CI
  // always gets all four rules.
  const rawHeadings = options.renderedOnly ? [] : await scanRawHeadings()

  let captured = null
  if (!options.staticOnly) {
    if (options.input) {
      captured = JSON.parse(await readFile(options.input, 'utf8'))
      if (!Array.isArray(captured?.pages)) fail('capture has no `pages` array')
    } else {
      const routes = options.routes.length
        ? options.routes.map((path) => [path, path])
        : [...(await discoverStaticRoutes()), ...CURATED_DYNAMIC_ROUTES]
      if (routes.length === 0) fail('no route to audit')
      captured = await capture(options, routes)
    }
    if (options.emit) await writeFile(options.emit, `${JSON.stringify(captured, null, 2)}\n`)
  }

  const { ok, fatal } = report({
    captured,
    rawHeadings,
    json: options.json,
    staticOnly: options.staticOnly,
    renderedOnly: options.renderedOnly,
  })
  // A route that never rendered is an operational failure (2), not a clean
  // verdict: the gate did not get to look at the thing it is supposed to judge.
  process.exit(fatal ? 2 : ok ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`check:headings — ${error?.stack ?? error}\n`)
  process.exit(2)
})
